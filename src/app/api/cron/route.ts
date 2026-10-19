import {
  getBriefForAccount,
  getProfile,
  getState,
  getVocabulary,
  listAccounts,
  listSignals,
  listTenants,
  setState,
} from "@/lib/db";
import { runIngestion } from "@/lib/ingest";
import { hasPullSource } from "@/lib/sources";
import {
  accountCardFromScored,
  dispatch,
  type DigestData,
  type DispatchResult,
} from "@/lib/integrations";
import { buildFeed } from "@/lib/signals";
import { errorResponse } from "@/lib/errors";
import { currentTenantId } from "@/lib/tenant";
import type { Profile } from "@/lib/types";

// One endpoint does the scheduled delivery work, so it can be driven by whatever
// scheduler you already have (system cron, Vercel Cron, a Make/Zapier schedule).
//
// It sends two different things:
//   - the digest: a scheduled summary of the strongest accounts (weekly/daily)
//   - strong-signal alerts: one card per account crossing the alert threshold,
//     sent once per account so the channel isn't spammed
//
// It also pulls new signals first when a source is configured, so the digest is
// built from the current market rather than the last thing a human typed in.
//
// Three ways in, and the difference matters once more than one customer shares a
// deployment:
//
//   POST /api/cron                 → the signed-in user's own workspace, running
//                                    only what is due. This is the /integrations
//                                    "Run now" button.
//   POST /api/cron?tenantId=7      → one named workspace. Requires CRON_SECRET.
//   POST /api/cron  (with secret)  → every workspace, because a scheduler fires
//                                    once and midnight is midnight for all of
//                                    them. Requires CRON_SECRET, so an
//                                    anonymous caller can never walk the
//                                    customer list.
//
// Header x-cron-secret must match CRON_SECRET when that env var is set; the
// Bearer form is what Vercel Cron sends.

const HOUR = 3_600_000;

function digestIsDue(
  cadence: Profile["delivery"]["digestCadence"],
  lastRun: string | null,
  now: number,
) {
  if (cadence === "off") return false;
  if (!lastRun) return true;
  const age = now - new Date(lastRun).getTime();
  return cadence === "daily" ? age >= 20 * HOUR : age >= 6 * 24 * HOUR;
}

/**
 * Whether the caller presented the cron secret.
 *
 * Distinct from "may this request proceed": a signed-in user running their own
 * workspace is legitimate without it (see POST below), but only this bit decides
 * whether the request may name a tenant or walk all of them.
 */
function presentedSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    request.headers.get("x-cron-secret") === secret ||
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}

/** Whether a secret-shaped credential was offered and did not match. */
function offeredWrongSecret(request: Request): boolean {
  return Boolean(
    process.env.CRON_SECRET &&
      (request.headers.get("x-cron-secret") ?? request.headers.get("authorization")),
  );
}

/** One workspace's scheduled run: pull first, then deliver what is due. */
async function runForTenant(tenantId: number, force: boolean, now: number) {
  const profile = await getProfile(tenantId);

  // Ingestion only runs for a real, configured source: a scheduled job must
  // never fill the workspace with sample data.
  let ingested: { sources: number; accountsCreated: number; signalsAdded: number } | null = null;
  if (hasPullSource()) {
    try {
      const report = await runIngestion(tenantId, {});
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

  const [accounts, signals, vocabulary] = await Promise.all([
    listAccounts(tenantId),
    listSignals(tenantId),
    getVocabulary(tenantId),
  ]);
  const feed = buildFeed(accounts, signals, vocabulary, profile, now);

  const results: DispatchResult[] = [];
  let digestAttempted = 0;
  let digestDelivered = 0;

  // --- scheduled digest -------------------------------------------------
  const lastDigest = await getState(tenantId, "last_digest_at");
  const due = digestIsDue(profile.delivery.digestCadence, lastDigest, now);
  if (due || force) {
    const digest: DigestData = {
      accounts: feed.slice(0, profile.delivery.digestSize).map(accountCardFromScored),
      generatedAt: new Date(now).toISOString(),
      cadence: profile.delivery.digestCadence,
    };
    const out = await dispatch(tenantId, "digest", digest);
    results.push(...out);
    digestAttempted = out.length;
    digestDelivered = out.filter((r) => r.ok).length;
    // Only advance the schedule if something actually landed, so a failure is
    // retried on the next run rather than silently skipped for a week.
    if (digestDelivered > 0) {
      await setState(tenantId, "last_digest_at", new Date(now).toISOString());
    }
  }

  // --- strong-signal alerts --------------------------------------------
  let alertsSent = 0;
  if (profile.delivery.alertMinScore > 0) {
    const alreadyAlerted = new Set<number>(
      JSON.parse((await getState(tenantId, "alerted_account_ids")) ?? "[]") as number[],
    );
    // Only alert on a genuine fit: an account outside the consultancy's market
    // should not wake anyone up just because the signal was strong.
    const eligible = feed.filter(
      (a) =>
        a.fit.gate !== "out" &&
        a.score >= profile.delivery.alertMinScore &&
        !alreadyAlerted.has(a.account.id),
    );
    for (const scored of eligible) {
      const card = accountCardFromScored(scored);
      const brief = await getBriefForAccount(tenantId, scored.account.id);
      const out = await dispatch(tenantId, "account_card", {
        ...card,
        whyNow: brief?.whyNow,
      });
      results.push(...out);
      if (out.some((r) => r.ok)) {
        alreadyAlerted.add(scored.account.id);
        alertsSent += 1;
      }
    }
    await setState(tenantId, "alerted_account_ids", JSON.stringify([...alreadyAlerted]));
  }

  return {
    ranAt: new Date(now).toISOString(),
    tenantId,
    cadence: profile.delivery.digestCadence,
    ingested,
    digest: {
      due: due || force,
      cadence: profile.delivery.digestCadence,
      lastRunAt: await getState(tenantId, "last_digest_at"),
      attempted: digestAttempted,
      delivered: digestDelivered,
    },
    alerts: {
      minScore: profile.delivery.alertMinScore,
      sent: alertsSent,
    },
    results,
  };
}

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const now = Date.now();

  if (!presentedSecret(request)) {
    if (offeredWrongSecret(request)) {
      return Response.json({ error: "Bad or missing x-cron-secret" }, { status: 401 });
    }
    // No secret offered: this is the app's own button. It runs the caller's
    // workspace and nothing else, so a signed-in user can never trigger another
    // customer's digest — the tenant comes from the session, not the URL.
    try {
      const tenantId = await currentTenantId();
      return Response.json(await runForTenant(tenantId, force, now));
    } catch (err) {
      return errorResponse(err);
    }
  }

  const requested = Number(params.get("tenantId"));
  if (Number.isFinite(requested) && requested > 0) {
    return Response.json(await runForTenant(requested, force, now));
  }

  // The scheduler path: one call, every workspace. Failures are reported per
  // tenant rather than aborting the run, because one customer's broken webhook
  // must not stop everyone else's digest.
  const tenants = await listTenants();
  const runs = [];
  for (const tenant of tenants) {
    try {
      runs.push({ slug: tenant.slug, ...(await runForTenant(tenant.id, force, now)) });
    } catch (err) {
      runs.push({
        slug: tenant.slug,
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : "run failed",
      });
    }
  }

  return Response.json({
    ranAt: new Date(now).toISOString(),
    tenants: runs.length,
    delivered: runs.reduce((n, r) => n + ("digest" in r ? r.digest.delivered : 0), 0),
    alertsSent: runs.reduce((n, r) => n + ("alerts" in r ? r.alerts.sent : 0), 0),
    failures: runs.filter((r) => "error" in r).map((r) => ({ slug: r.slug, error: r.error })),
    runs,
  });
}
