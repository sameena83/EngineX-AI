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

import { classify, classifyWithRules, suppression } from "./classify";
import {
  enrichAccount,
  insertAccount,
  insertSignalIfNew,
  listAccounts,
  setState,
  getState,
  getProfile,
  getVocabulary,
} from "./db";
import { intermediaryPhrase } from "./intermediary";
import { pullSources, sampleSource, type RawCandidate } from "./sources";
import type { Channel, NicheConfig, Signal, SignalType, Vocabulary } from "./types";
import { channelLabel } from "./channels";
import { vocabularyForChannel } from "./vocab";

export interface IngestSourceResult {
  id: string;
  label: string;
  /** Channels this source feeds. Null when it feeds all of them. */
  channels: Channel[] | null;
  fetched: number;
  error: string | null;
}

export interface IngestSample {
  accountName: string;
  type: SignalType | null;
  summary: string;
  action:
    | "added"
    | "duplicate"
    | "unclassified"
    | "unattributed"
    | "suppressed"
    | "off_channel";
  /** Why an item was dropped, when it was dropped for a reason other than noise. */
  note?: string;
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
  /**
   * Recruiter and staffing adverts: a real vacancy, posted on behalf of a company
   * the advert does not name.
   *
   * Separate from `unattributed` because it is not a broken source — it is a
   * source working exactly as advertised, and the number is what tells a customer
   * their job feed needs a buyer-name filter rather than a keyword tweak.
   */
  intermediary: number;
  /** Dropped by a negative rule — vendor marketing, awards, promotional filler. */
  suppressed: number;
  /**
   * Items a rule matched but could not be counted for, because that rule does not
   * read the channel the item arrived on.
   *
   * Counted separately from `unclassified` on purpose: "nothing we track" and "we
   * track this, but not from here" are different problems, and the second is what
   * tells a customer their configured sources do not cover the signals they asked
   * for.
   */
  offChannel: number;
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

/**
 * When the event happened. Falls back to now when the source gives no date, and
 * clamps a future timestamp (sources do occasionally send one) to now so a bad
 * date cannot make a stale event look fresh forever.
 */
function eventDate(postedAt: string | null | undefined, now: number): string {
  if (!postedAt) return new Date(now).toISOString();
  const ts = new Date(postedAt).getTime();
  if (!Number.isFinite(ts) || ts > now) return new Date(now).toISOString();
  return new Date(ts).toISOString();
}

export async function lastIngestReport(tenantId: number): Promise<IngestReport | null> {
  const raw = await getState(tenantId, "last_ingest_report");
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
export async function runIngestion(
  tenantId: number,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const dryRun = options.dryRun ?? false;
  const now = Date.now();
  const pushed = options.pushed ?? [];

  // The vocabulary and niche config are read once per run, not per candidate:
  // classification is the hot path and these are the same for every item.
  const profile = await getProfile(tenantId);
  const vocabulary: Vocabulary = await getVocabulary(tenantId);
  const config: NicheConfig = profile.nicheConfig;

  // A run that was handed candidates reads nothing else: a dry run of a push has
  // to preview that push, not the bundled sample feed. Mixing both made a
  // preview report five fictional accounts alongside the one real candidate,
  // which reads as if the push had invented them.
  const adapters =
    pushed.length > 0
      ? []
      : dryRun
        ? [sampleSource()]
        : options.includePull === false
          ? []
          : pullSources(config.sourceQueries).filter(
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
    intermediary: 0,
    suppressed: 0,
    offChannel: 0,
    samples: [],
  };

  const candidates: RawCandidate[] = [...pushed];
  for (const adapter of adapters) {
    try {
      const fetched = await adapter.fetch();
      report.sources.push({
        id: adapter.id,
        label: adapter.label,
        channels: adapter.channels,
        fetched: fetched.length,
        error: null,
      });
      candidates.push(...fetched);
      report.candidates += fetched.length;
    } catch (err) {
      report.sources.push({
        id: adapter.id,
        label: adapter.label,
        channels: adapter.channels,
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
  for (const account of await listAccounts(tenantId)) {
    if (account.domain) byDomain.set(normaliseDomain(account.domain), account.id);
    byName.set(normaliseName(account.name), account.id);
  }

  for (const candidate of candidates) {
    const name = candidate.companyName?.trim();
    if (!name) {
      report.unattributed += 1;
      continue;
    }

    // Negative rules first: a vendor's own launch announcement is noise whether
    // or not it happens to contain a word we look for. Counting it separately
    // from "unclassified" is what makes a mistuned keyword visible.
    const veto = suppression(candidate.text, config);
    if (veto) {
      report.suppressed += 1;
      pushSample(report, {
        accountName: name,
        type: null,
        summary: candidate.text,
        action: "suppressed",
        note: `${veto.rule} ("${veto.phrase}")`,
        url: candidate.url ?? null,
      });
      continue;
    }

    // A recruiter advertising someone else's vacancy is not an account. Checked
    // before classification so the item cannot create a company record: the named
    // employer is the poster, and the buyer stays unnamed.
    const intermediary = intermediaryPhrase(candidate.text);
    if (intermediary) {
      report.intermediary += 1;
      pushSample(report, {
        accountName: name,
        type: null,
        summary: candidate.text,
        action: "unattributed",
        note: `recruiter advert ("${intermediary}") — the buyer is not named`,
        url: candidate.url ?? null,
      });
      continue;
    }

    // Routing: only the rules that read this item's channel are run against it.
    // A tender pattern matched against press coverage invents opportunities, and
    // a hiring pattern says nothing unless it is looking at a job board.
    const channel = candidate.channel ?? null;
    const readable = vocabularyForChannel(vocabulary, channel);

    // Classify before touching the workspace: an item that is not evidence of a
    // tracked need must not create an account that then sits signal-less in the
    // feed. This is also what keeps an off-topic article from adding noise.
    const result = readable.length
      ? await classify(candidate.text, readable, config, tenantId)
      : null;

    if (!result && channel && readable.length < vocabulary.length) {
      // It may still have matched a rule that reads a different channel. Rules
      // only, and only on the miss path: the explanation is worth a second local
      // regex pass but never a second model call.
      const elsewhere = classifyWithRules(
        candidate.text,
        vocabulary.filter((def) => !readable.includes(def)),
      );
      if (elsewhere) {
        const def = vocabulary.find((d) => d.type === elsewhere.type);
        const reads = def ? def.sources.map(channelLabel).join(" / ") : "another channel";
        report.offChannel += 1;
        pushSample(report, {
          accountName: name,
          type: null,
          summary: candidate.text,
          action: "off_channel",
          note: `matches "${def?.label ?? elsewhere.type}", which reads ${reads} — this item arrived on ${channelLabel(channel)}`,
          url: candidate.url ?? null,
        });
        continue;
      }
    }

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
        const account = await insertAccount(tenantId, {
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
        await enrichAccount(tenantId, accountId, {
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

    const signal: Signal | null = await insertSignalIfNew(tenantId, {
      accountId,
      type: candidate.hint ?? result.type,
      summary: result.summary,
      evidence: result.evidence.length
        ? `${candidate.text} [${result.by}: ${result.evidence.join(", ")}]`
        : candidate.text,
      source: candidate.source,
      sourceUrl: candidate.url ?? null,
      // Two different facts, stored separately: the event's own date and the
      // moment we picked it up.
      eventAt: eventDate(candidate.postedAt, now),
      detectedAt: new Date(now).toISOString(),
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
    await setState(tenantId, "last_ingest_at", report.ranAt);
    await setState(tenantId, "last_ingest_report", JSON.stringify(report));
  }
  return report;
}

function pushSample(report: IngestReport, sample: IngestSample) {
  if (report.samples.length < 12) report.samples.push(sample);
}
