import { connection } from "next/server";
import { lastIngestReport, runIngestion, type IngestReport } from "@/lib/ingest";
import { hasPullSource, sourceStatuses, type RawCandidate } from "@/lib/sources";
import type { SignalType } from "@/lib/types";

// The write side of EngineX: where real signals come from.
//
// GET  /api/ingest                  → source status + the last run's report
// POST /api/ingest                  → pull every configured source
// POST /api/ingest?dry=1            → fetch and classify, write nothing
// POST /api/ingest?source=webz      → run one source
// POST /api/ingest {candidates:[…]} → push mode, for scrapers and Zapier/Make
//                                    (pushes only; call without a body to pull)
//
// Push mode is what makes a source with no API of its own usable: a scraper, a
// spreadsheet script or an automation platform posts normalised candidates here.
// Set INGEST_SECRET to require the x-ingest-secret header (or Bearer form).

const SIGNAL_TYPES = [
  "data_hiring_no_leadership",
  "new_data_leader",
  "platform_adoption",
  "funding_ma",
  "public_rfp",
] as const;

function authorised(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  if (request.headers.get("x-ingest-secret") === secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET() {
  await connection();
  return Response.json({
    sources: sourceStatuses(),
    pullConfigured: hasPullSource(),
    // The UI cannot send the header, so it says so instead of failing with a 401.
    secretRequired: Boolean(process.env.INGEST_SECRET),
    lastRun: lastIngestReport(),
  });
}

/** Coerce a pushed item into a candidate, rejecting anything without a company and text. */
function toCandidate(input: unknown): RawCandidate | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const companyName = typeof raw.companyName === "string" ? raw.companyName.trim() : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!companyName || !text) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const employees = Number(raw.employees);
  const hint =
    typeof raw.hint === "string" && (SIGNAL_TYPES as readonly string[]).includes(raw.hint)
      ? (raw.hint as SignalType)
      : null;
  return {
    companyName,
    text,
    source: str(raw.source) ?? "Push API",
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
  const candidates = rawCandidates.map(toCandidate).filter((c): c is RawCandidate => c !== null);
  const rejected = rawCandidates.length - candidates.length;

  let report: IngestReport;
  try {
    report = await runIngestion({
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
