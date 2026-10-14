// Ingestion: pull raw candidates from the configured sources, classify them,
// attach them to an account and store the signals the scorer already reads.
//
// This is the write side of the product. Everything downstream — the feed,
// briefs, drafts, digests and alerts — was already real; until now the only way
// a signal could enter the database was the sample seed.
//
// The rules that keep a live feed trustworthy:
//   - nothing is written in a dry run,
//   - an item we cannot attribute to a company is counted, not guessed at,
//   - an item we cannot classify to a tracked signal type is dropped before it can
//     create an account, so the feed never gains a signal-less company,
//   - re-polling a source is a no-op thanks to the signal dedupe key,
//   - a source that errors is reported and skipped; the others still run.

import { classify } from "./classify";
import {
  enrichAccount,
  insertAccount,
  insertSignalIfNew,
  listAccounts,
  setState,
  getState,
} from "./db";
import { pullSources, sampleSource, type RawCandidate } from "./sources";
import type { Signal, SignalType } from "./types";

export interface IngestSourceResult {
  id: string;
  label: string;
  fetched: number;
  error: string | null;
}

export interface IngestSample {
  accountName: string;
  type: SignalType | null;
  summary: string;
  action: "added" | "duplicate" | "unclassified" | "unattributed";
  url: string | null;
}

export interface IngestReport {
  mode: "live" | "dry_run";
  ranAt: string;
  note: string | null;
  sources: IngestSourceResult[];
  candidates: number;
  accountsCreated: number;
  accountsMatched: number;
  signalsAdded: number;
  duplicates: number;
  unclassified: number;
  unattributed: number;
  samples: IngestSample[];
}

/** Company-name matching is deliberately forgiving: sources write "Kestrel Analytics Ltd". */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|plc|gmbh|bv|nv|sa|ag|oy|ab|pty|corp|corporation|co|company|group|holdings)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normaliseDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function domainFrom(name: string): string {
  const slug = normaliseName(name).replace(/\s+/g, "");
  return slug ? `${slug}.example` : "unknown.example";
}

function dedupeKey(accountId: number, type: SignalType, summary: string): string {
  // Keyed on the account, the type and the summarised event, so polling the same
  // feed twice is a no-op while a *new* event for the same account is stored.
  const text = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${accountId}|${type}|${text}`;
}

function detectedAt(postedAt: string | null | undefined, now: number): string {
  if (!postedAt) return new Date(now).toISOString();
  const ts = new Date(postedAt).getTime();
  // Sources occasionally send a date in the future; clamp it to now.
  if (!Number.isFinite(ts) || ts > now) return new Date(now).toISOString();
  return new Date(ts).toISOString();
}

export function lastIngestReport(): IngestReport | null {
  const raw = getState("last_ingest_report");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IngestReport;
  } catch {
    return null;
  }
}

export interface IngestOptions {
  /** Fetch and classify, but write nothing. */
  dryRun?: boolean;
  /** Restrict a run to these source ids. */
  sourceIds?: string[];
  /** Candidates supplied through the push API instead of a pull. */
  pushed?: RawCandidate[];
  /**
   * Whether to poll the configured pull sources as well. A push-only run leaves
   * this false so a scraper posting one candidate never triggers a full sweep of
   * every other source.
   */
  includePull?: boolean;
}

/**
 * Run ingestion. Never throws: a failing source is reported alongside the ones
 * that worked, because a partly-successful run is still useful.
 */
export async function runIngestion(options: IngestOptions = {}): Promise<IngestReport> {
  const dryRun = options.dryRun ?? false;
  const now = Date.now();
  const pushed = options.pushed ?? [];

  const adapters =
    dryRun
      ? [sampleSource()]
      : options.includePull === false
        ? []
        : pullSources().filter(
            (s) => !options.sourceIds?.length || options.sourceIds.includes(s.id),
          );

  const report: IngestReport = {
    mode: dryRun ? "dry_run" : "live",
    ranAt: new Date(now).toISOString(),
    note: null,
    sources: [],
    candidates: pushed.length,
    accountsCreated: 0,
    accountsMatched: 0,
    signalsAdded: 0,
    duplicates: 0,
    unclassified: 0,
    unattributed: 0,
    samples: [],
  };

  const candidates: RawCandidate[] = [...pushed];
  for (const adapter of adapters) {
    try {
      const fetched = await adapter.fetch();
      report.sources.push({
        id: adapter.id,
        label: adapter.label,
        fetched: fetched.length,
        error: null,
      });
      candidates.push(...fetched);
      report.candidates += fetched.length;
    } catch (err) {
      report.sources.push({
        id: adapter.id,
        label: adapter.label,
        fetched: 0,
        error: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  if (!dryRun && adapters.length === 0 && pushed.length === 0) {
    report.note = "No pull sources configured — set a source's env vars, or push candidates in.";
  }

  // One pass over the accounts builds the lookup maps, so account resolution
  // stays O(1) per candidate no matter how many arrive.
  const byDomain = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const account of listAccounts()) {
    if (account.domain) byDomain.set(normaliseDomain(account.domain), account.id);
    byName.set(normaliseName(account.name), account.id);
  }

  for (const candidate of candidates) {
    const name = candidate.companyName?.trim();
    if (!name) {
      report.unattributed += 1;
      continue;
    }

    // Classify before touching the workspace: an item that is not evidence of a
    // tracked need must not create an account that then sits signal-less in the
    // feed. This is also what keeps an off-topic article from adding noise.
    const result = await classify(candidate.text);
    if (!result) {
      report.unclassified += 1;
      pushSample(report, {
        accountName: name,
        type: null,
        summary: candidate.text,
        action: "unclassified",
        url: candidate.url ?? null,
      });
      continue;
    }
    const domain = candidate.domain ? normaliseDomain(candidate.domain) : "";
    const nameKey = normaliseName(name);

    let accountId = (domain && byDomain.get(domain)) || byName.get(nameKey) || null;
    if (accountId === null) {
      if (dryRun) {
        // Nothing is created in a dry run; the sample accounts are illustrative.
        accountId = -1;
        report.accountsCreated += 1;
      } else {
        const account = insertAccount({
          name,
          domain: domain || domainFrom(name),
          sector: candidate.sector?.trim() || "Unknown",
          employees: candidate.employees ?? 0,
          location: candidate.location?.trim() || "Unknown",
          description: `Discovered by ${candidate.source}.`,
        });
        accountId = account.id;
        byName.set(nameKey, account.id);
        byDomain.set(normaliseDomain(account.domain), account.id);
        report.accountsCreated += 1;
      }
    } else {
      report.accountsMatched += 1;
      if (!dryRun) {
        enrichAccount(accountId, {
          domain: domain || undefined,
          sector: candidate.sector ?? undefined,
          employees: candidate.employees ?? undefined,
          location: candidate.location ?? undefined,
        });
      }
    }

    if (dryRun) {
      pushSample(report, {
        accountName: name,
        type: result.type,
        summary: result.summary,
        action: "added",
        url: candidate.url ?? null,
      });
      continue;
    }

    const signal: Signal | null = insertSignalIfNew({
      accountId,
      type: candidate.hint ?? result.type,
      summary: result.summary,
      evidence: result.evidence.length
        ? `${candidate.text} [${result.by}: ${result.evidence.join(", ")}]`
        : candidate.text,
      source: candidate.source,
      sourceUrl: candidate.url ?? null,
      detectedAt: detectedAt(candidate.postedAt, now),
      strength: result.strength,
      dedupeKey: dedupeKey(accountId, candidate.hint ?? result.type, result.summary),
    });

    if (signal) {
      report.signalsAdded += 1;
      pushSample(report, {
        accountName: name,
        type: signal.type,
        summary: signal.summary,
        action: "added",
        url: signal.sourceUrl,
      });
    } else {
      report.duplicates += 1;
      pushSample(report, {
        accountName: name,
        type: result.type,
        summary: result.summary,
        action: "duplicate",
        url: candidate.url ?? null,
      });
    }

  }

  if (!dryRun) {
    setState("last_ingest_at", report.ranAt);
    setState("last_ingest_report", JSON.stringify(report));
  }
  return report;
}

function pushSample(report: IngestReport, sample: IngestSample) {
  if (report.samples.length < 12) report.samples.push(sample);
}
