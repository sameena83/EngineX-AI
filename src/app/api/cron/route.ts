import { getBriefForAccount, getProfile, getState, listAccounts, listSignals, setState } from "@/lib/db";
import { runIngestion } from "@/lib/ingest";
import { hasPullSource } from "@/lib/sources";
import {
  accountCardFromScored,
  dispatch,
  type DigestData,
  type DispatchResult,
} from "@/lib/integrations";
import { buildFeed } from "@/lib/signals";
import type { Profile } from "@/lib/types";

// One endpoint does the scheduled delivery work, so it can be driven by whatever
// scheduler you already have (system cron, Vercel Cron, a Make/Zapier schedule).
//
// It sends two different things, matching the report's Slack Phase 1:
//   - the digest: a scheduled summary of the strongest accounts (weekly/daily)
//   - strong-signal alerts: one card per account crossing the alert threshold,
//     sent once per account so the channel isn't spammed
//
// It also pulls new signals first when a source is configured, so the digest is
// built from the current market rather than the last thing a human typed in.
//
// POST /api/cron            → runs only what is due
// POST /api/cron?force=1    → ignores the schedule (for testing)
// Header x-cron-secret must match CRON_SECRET when that env var is set.

const HOUR = 3_600_000;

function digestIsDue(cadence: Profile["delivery"]["digestCadence"], lastRun: string | null, now: number) {
  if (cadence === "off") return false;
  if (!lastRun) return true;
  const age = now - new Date(lastRun).getTime();
  return cadence === "daily" ? age >= 20 * HOUR : age >= 6 * 24 * HOUR;
}

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  // Accept both a plain header (crontab/curl) and the Bearer form Vercel Cron sends.
  if (request.headers.get("x-cron-secret") === secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Bad or missing x-cron-secret" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const profile = getProfile();
  const now = Date.now();

  // Ingestion only runs for a real, configured source: a scheduled job must
  // never fill the workspace with sample data.
  let ingested: { sources: number; accountsCreated: number; signalsAdded: number } | null = null;
  if (hasPullSource()) {
    try {
      const report = await runIngestion({});
      ingested = {
        sources: report.sources.length,
        accountsCreated: report.accountsCreated,
        signalsAdded: report.signalsAdded,
      };
    } catch {
      // A failed pull must not block delivery of what we already know.
      ingested = null;
    }
  }

  const feed = buildFeed(listAccounts(), listSignals(), now);

  const results: DispatchResult[] = [];
  let digestAttempted = 0;
  let digestDelivered = 0;

  // --- scheduled digest -------------------------------------------------
  const lastDigest = getState("last_digest_at");
  const due = digestIsDue(profile.delivery.digestCadence, lastDigest, now);
  if (due || force) {
    const digest: DigestData = {
      accounts: feed.slice(0, profile.delivery.digestSize).map(accountCardFromScored),
      generatedAt: new Date(now).toISOString(),
      cadence: profile.delivery.digestCadence,
    };
    const out = await dispatch("digest", digest);
    results.push(...out);
    digestAttempted = out.length;
    digestDelivered = out.filter((r) => r.ok).length;
    // Only advance the schedule if something actually landed, so a failure is
    // retried on the next run rather than silently skipped for a week.
    if (digestDelivered > 0) setState("last_digest_at", new Date(now).toISOString());
  }

  // --- strong-signal alerts --------------------------------------------
  let alertsSent = 0;
  if (profile.delivery.alertMinScore > 0) {
    const alreadyAlerted = new Set<number>(
      JSON.parse(getState("alerted_account_ids") ?? "[]") as number[],
    );
    const eligible = feed.filter(
      (a) => a.score >= profile.delivery.alertMinScore && !alreadyAlerted.has(a.account.id),
    );
    for (const scored of eligible) {
      const card = accountCardFromScored(scored);
      const out = await dispatch("account_card", {
        ...card,
        whyNow: getBriefForAccount(scored.account.id)?.whyNow,
      });
      results.push(...out);
      if (out.some((r) => r.ok)) {
        alreadyAlerted.add(scored.account.id);
        alertsSent += 1;
      }
    }
    setState("alerted_account_ids", JSON.stringify([...alreadyAlerted]));
  }

  return Response.json({
    ranAt: new Date(now).toISOString(),
    policy: profile.delivery,
    ingested,
    digest: {
      due: due || force,
      cadence: profile.delivery.digestCadence,
      lastRunAt: getState("last_digest_at"),
      attempted: digestAttempted,
      delivered: digestDelivered,
    },
    alerts: {
      minScore: profile.delivery.alertMinScore,
      sent: alertsSent,
    },
    results,
  });
}
