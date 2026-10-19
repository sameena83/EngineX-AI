import { connection } from "next/server";
import { CHANNELS, isChannel, uncoveredChannels } from "@/lib/channels";
import { getVocabulary } from "@/lib/db";
import { INGEST_PUSH_GUARD, secretGuard } from "@/lib/guards";
import { lastIngestReport, runIngestion, type IngestReport } from "@/lib/ingest";
import { hasPullSource, sourceStatuses, type RawCandidate } from "@/lib/sources";
import { currentTenantId } from "@/lib/tenant";
import type { SignalType } from "@/lib/types";
import { channelsRead, unconstrainedTypes } from "@/lib/vocab";

// The write side of EngineX: where real signals come from.
//
// GET  /api/ingest                  → source status + the last run's report
// POST /api/ingest                  → pull every configured source
// POST /api/ingest?dry=1            → fetch and classify, write nothing
// POST /api/ingest?source=webz      → run one source
// POST /api/ingest {candidates:[…]} → push mode, for scrapers and Zapier/Make
//                                    (pushes only; call without a body to pull)
//
// A pushed candidate may declare `channel` — "tender", "job_board", "news",
// "people", "funding". Rules only see evidence from the channels they read, so a
// scraper that says what it scraped gets its items routed correctly; one that
// says nothing gets them read by every rule.
//
// Push mode is what makes a source with no API of its own usable: a scraper, a
// spreadsheet script or an automation platform posts normalised candidates here.
// Set INGEST_SECRET to require the x-ingest-secret header (or Bearer form).
//
// Everything written lands in the calling tenant's workspace, so two customers
// polling the same feed do not see each other's accounts.

function authorised(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  if (request.headers.get("x-ingest-secret") === secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  const vocabulary = await getVocabulary(tenantId);
  const statuses = sourceStatuses();
  // Every configured source's channels, plus "all channels" for the pipes (push,
  // sample) so they count as feeding whatever a rule reads.
  const fed = statuses
    .filter((s) => s.configured && s.pull)
    .flatMap((s) => s.channels ?? CHANNELS.map((c) => c.id));
  return Response.json({
    sources: statuses,
    channels: CHANNELS,
    // Which channels the tenant's rules read that no configured source feeds: a
    // rule reading tender evidence cannot fire if the only source is a news feed,
    // and that is worth saying before someone wonders why the feed is empty.
    uncovered: uncoveredChannels(channelsRead(vocabulary), fed),
    // Rules still reading every channel. The other half of the same question: a
    // channel no source feeds cannot fire, and a rule with no channel can fire on
    // the wrong evidence, which is harder to notice.
    unconstrained: unconstrainedTypes(vocabulary),
    pullConfigured: hasPullSource(),
    // The UI cannot send the header, so it says so instead of failing with a 401.
    secretRequired: Boolean(process.env.INGEST_SECRET),
    lastRun: await lastIngestReport(tenantId),
  });
}

/**
 * Coerce a pushed item into a candidate, rejecting anything without a company and
 * text.
 *
 * A `hint` is only honoured when it names a signal this tenant actually tracks.
 * It used to be checked against a hardcoded list of the five data & AI keys, so
 * a scraper pushing `compliance_audit` to a security workspace had its hint
 * silently dropped.
 */
function toCandidate(input: unknown, vocabulary: Set<string>): RawCandidate | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const companyName = typeof raw.companyName === "string" ? raw.companyName.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!companyName || !text) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const employees = Number(raw.employees);
  const hint =
    typeof raw.hint === "string" && vocabulary.has(raw.hint) ? (raw.hint as SignalType) : null;
  return {
    companyName,
    text,
    source: str(raw.source) ?? "Push API",
    // Absent means "read by every rule": the caller is asserting relevance, and
    // routing an undeclared item away from every rule would discard it silently.
    channel: isChannel(raw.channel) ? raw.channel : null,
    domain: str(raw.domain),
    sector: str(raw.sector),
    location: str(raw.location),
    url: str(raw.url),
    postedAt: str(raw.postedAt),
    employees: Number.isFinite(employees) && employees > 0 ? employees : null,
    hint,
  };
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Bad or missing x-ingest-secret" }, { status: 401 });
  }

  const tenantId = await currentTenantId();
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry") === "1";
  const sourceId = params.get("source");

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // A pull run has no body; that is not an error.
  }

  const rawCandidates = Array.isArray((body as { candidates?: unknown })?.candidates)
    ? ((body as { candidates: unknown[] }).candidates)
    : [];

  // A pull or a dry run is something the operator's own dashboard does, and the
  // caller above is already checked against INGEST_SECRET when one is set. A
  // push is different: it puts items into the feed that are then ranked as
  // evidence, so on a deployment that has no secret configured it is closed
  // rather than left open to whoever finds the URL.
  if (rawCandidates.length > 0) {
    const blocked = secretGuard(request, INGEST_PUSH_GUARD);
    if (blocked) return blocked;
  }
  const vocabulary = new Set((await getVocabulary(tenantId)).map((d) => d.type));
  const candidates = rawCandidates
    .map((c) => toCandidate(c, vocabulary))
    .filter((c): c is RawCandidate => c !== null);
  const rejected = rawCandidates.length - candidates.length;

  let report: IngestReport;
  try {
    report = await runIngestion(tenantId, {
      dryRun,
      sourceIds: sourceId ? [sourceId] : undefined,
      pushed: candidates,
      // A body carrying candidates is a push: ingest those and nothing else.
      includePull: candidates.length === 0,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "ingestion failed" },
      { status: 500 },
    );
  }

  if (candidates.length === 0 && rejected > 0) {
    return Response.json(
      { error: "Every pushed candidate needs a companyName and text", rejected },
      { status: 400 },
    );
  }

  return Response.json({ rejected, ...report });
}
