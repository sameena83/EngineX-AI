import { computeFit, fitPenalties, fitReasons } from "./match";
import type {
  Account,
  Profile,
  ScoredAccount,
  Signal,
  SignalDefinition,
  SignalType,
  Vocabulary,
} from "./types";
import { definitionFor } from "./vocab";

/**
 * The tenant's definition of a signal, or a neutral stand-in for one stored
 * under a vocabulary they have since replaced.
 */
export function signalDefinition(type: SignalType, vocabulary: Vocabulary = []): SignalDefinition {
  return definitionFor(vocabulary, type);
}

/**
 * How old the event is, in days. Measured from the event's own date, not from
 * when we noticed it: a tender published three weeks ago that we only just
 * picked up is not a fresh opportunity.
 */
export function eventAgeDays(signal: Signal, now = Date.now()): number {
  const at = signal.eventAt ?? signal.detectedAt;
  return Math.max(0, (now - new Date(at).getTime()) / 86_400_000);
}

/** How long ago we first saw it — a different fact, shown alongside. */
export function detectionAgeDays(signal: Signal, now = Date.now()): number {
  return Math.max(0, (now - new Date(signal.detectedAt).getTime()) / 86_400_000);
}

/**
 * Recency decay: an event from today counts at full strength, and its influence
 * halves every `halfLifeDays`. Consultancies act on fresh signals, so stale
 * evidence must not keep an account at the top of the feed.
 *
 * The half-life is per-niche configuration, because it genuinely differs: an
 * outage or a platform migration is old news in a month, while a certification
 * deadline or an ERP programme stays relevant for a quarter.
 */
function recencyFactor(eventAt: string, halfLifeDays = 45, now = Date.now()): number {
  const halfLife = halfLifeDays > 0 ? halfLifeDays : 45;
  const days = Math.max(0, (now - new Date(eventAt).getTime()) / 86_400_000);
  return Math.exp((-days * Math.LN2) / halfLife);
}

/** A staleness threshold expressed in the niche's own terms. */
function staleAfterDays(halfLifeDays: number): number {
  return Math.max(14, Math.round((halfLifeDays > 0 ? halfLifeDays : 45) * (4 / 3)));
}

/** Freshness label for the UI, relative to the event date. */
export function freshness(signal: Signal, now = Date.now()): string {
  return label(eventAgeDays(signal, now));
}

export function detectedAgo(signal: Signal, now = Date.now()): string {
  return label(detectionAgeDays(signal, now));
}

function label(days: number): string {
  const d = Math.round(days);
  if (d <= 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/**
 * Split a signal's stored evidence back into the raw source text and the trail
 * that justified the classification. The ingestion path appends that trail as
 * `[rules: …]` or `[llm: …]`; seeded signals have none.
 */
export function parseEvidence(evidence: string): {
  text: string;
  classifiedBy: "llm" | "rules" | null;
  matches: string[];
} {
  // Anchored on the last marker rather than a bracketed group: the trail can
  // itself contain "]" (a rule pattern like `series [a-e]\b`), so a character
  // class would stop early and fail to match.
  const start = Math.max(
    evidence.lastIndexOf(" [rules: "),
    evidence.lastIndexOf(" [llm: "),
  );
  if (start === -1) return { text: evidence.trim(), classifiedBy: null, matches: [] };
  const trail = evidence.slice(start).trim();
  const parsed = trail.match(/^\[(llm|rules):\s*([\s\S]*)\]$/i);
  if (!parsed) return { text: evidence.trim(), classifiedBy: null, matches: [] };
  return {
    text: evidence.slice(0, start).trim(),
    classifiedBy: parsed[1].toLowerCase() === "llm" ? "llm" : "rules",
    matches: parsed[2]
      .split(", ")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function scoreTier(score: number): ScoredAccount["tier"] {
  if (score >= 80) return "very_strong";
  if (score >= 60) return "strong";
  if (score >= 40) return "moderate";
  return "weak";
}

/* ---------------------------- duplicate detection ------------------------ */

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Overlap between two summaries, as a share of the shorter one. */
function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.min(A.size, B.size);
}

/**
 * Collapse the same event reported by several sources with different wording.
 *
 * The database unique key only catches an identical summary, so this is what
 * stops two outlets covering one funding round from scoring it twice.
 *
 * Deliberately NOT scoped to a signal type. Testing showed the same posting
 * classified as "data hiring" from one source and "platform adoption" from
 * another — same event, two types — and a type-scoped check let both score.
 * Wording similarity is the real evidence that it is one event; two genuinely
 * different events at one company rarely share 60% of their words.
 *
 * Signals are compared strongest-first so the merge keeps the best evidence
 * rather than whichever happened to be returned first.
 */
export function dedupeSignals(signals: Signal[]): {
  kept: Signal[];
  duplicates: Signal[];
} {
  const ordered = [...signals].sort(
    (a, b) =>
      b.strength - a.strength ||
      new Date(b.eventAt ?? b.detectedAt).getTime() -
        new Date(a.eventAt ?? a.detectedAt).getTime(),
  );
  const kept: Signal[] = [];
  const duplicates: Signal[] = [];
  for (const s of ordered) {
    const isDuplicate = kept.some((k) => similarity(k.summary, s.summary) >= 0.6);
    if (isDuplicate) duplicates.push(s);
    else kept.push(s);
  }
  return { kept, duplicates };
}

/* -------------------------------- scoring -------------------------------- */

/**
 * Combine an account's signals into one 0-100 score, with market fit folded in.
 *
 * Signal strength: each signal contributes `weight * strength * recency`, and
 * independent signals combine as `1 - Π(1 - p)` so several moderate signals beat
 * a single weak one.
 *
 * Market fit: adds up to `nicheConfig.scoring.fitPoints` (25 by default). Without
 * it, a strong signal on a company the consultancy cannot serve would outrank a
 * good match — which is the whole reason the feed exists.
 */
export function scoreAccount(
  account: Account,
  signals: Signal[],
  vocabulary: Vocabulary,
  profile: Profile,
  now = Date.now(),
): ScoredAccount {
  const { kept, duplicates } = dedupeSignals(signals);
  const halfLife = profile.nicheConfig?.scoring?.halfLifeDays ?? 30;

  const contributions = kept
    .map((s) => {
      const def = signalDefinition(s.type, vocabulary);
      const p = Math.min(
        0.99,
        def.weight * s.strength * recencyFactor(s.eventAt ?? s.detectedAt, halfLife, now),
      );
      return { type: s.type, label: def.shortLabel, points: p };
    })
    .sort((a, b) => b.points - a.points);

  const residual = contributions.reduce((acc, c) => acc * (1 - c.points), 1);
  const signalScore = (1 - residual) * 100;

  const fit = computeFit(profile, account, signals, vocabulary);
  const fitPoints = Math.round(fit.score * (profile.nicheConfig?.scoring?.fitPoints ?? 25));
  const score = Math.max(0, Math.min(100, Math.round(signalScore + fitPoints)));

  const topSignal =
    [...kept].sort(
      (a, b) =>
        b.strength * recencyFactor(b.eventAt ?? b.detectedAt, halfLife, now) -
        a.strength * recencyFactor(a.eventAt ?? a.detectedAt, halfLife, now),
    )[0] ?? null;

  /* Why it ranks here. Order matters: fit first, then the strongest evidence. */
  const reasons: string[] = fitReasons(fit);
  if (topSignal) {
    const def = signalDefinition(topSignal.type, vocabulary);
    const age = freshness(topSignal, now);
    reasons.push(`${def.shortLabel} — evidence from ${age}.`);
  }
  if (kept.length > 1) {
    reasons.push(`${kept.length} independent signals on this account.`);
  }

  /* What held it back. */
  const penalties = fitPenalties(fit);
  if (duplicates.length > 0) {
    penalties.push(
      `${duplicates.length} near-duplicate signal${duplicates.length === 1 ? "" : "s"} from other sources ignored.`,
    );
  }
  const weak = kept.filter((s) => s.strength < 0.5);
  if (weak.length > 0) {
    penalties.push(`${weak.length} signal${weak.length === 1 ? "" : "s"} based on weak evidence.`);
  }
  const newestEventDays =
    kept.length > 0 ? Math.min(...kept.map((s) => eventAgeDays(s, now))) : null;
  if (newestEventDays !== null && newestEventDays > staleAfterDays(halfLife)) {
    penalties.push(
      `Newest evidence is ${Math.round(newestEventDays)} days old — the window may have passed.`,
    );
  }

  return {
    account,
    score,
    tier: scoreTier(score),
    signals,
    contributions: contributions.map((c) => ({
      ...c,
      points: Math.round(c.points * 100),
    })),
    topSignal,
    fit,
    fitPoints,
    reasons,
    penalties,
  };
}

export interface RankedFeed {
  /** Opportunities worth acting on, best first. */
  opportunities: ScoredAccount[];
  /** Clear mismatches, kept so a hidden account is never a mystery. */
  excluded: ScoredAccount[];
}

/** Rank every account and split out the ones that clearly are not a fit. */
export function rankFeed(
  accounts: Account[],
  signals: Signal[],
  vocabulary: Vocabulary,
  profile: Profile,
  now = Date.now(),
): RankedFeed {
  const byAccount = new Map<number, Signal[]>();
  for (const s of signals) {
    const list = byAccount.get(s.accountId) ?? [];
    list.push(s);
    byAccount.set(s.accountId, list);
  }
  const scored = accounts
    .map((a) => scoreAccount(a, byAccount.get(a.id) ?? [], vocabulary, profile, now))
    .sort((a, b) => b.score - a.score);

  return {
    opportunities: scored.filter((s) => s.fit.gate !== "out"),
    excluded: scored.filter((s) => s.fit.gate === "out"),
  };
}

/** Account ids in ranked order. Used by the CSV export and the digest. */
export function buildFeed(
  accounts: Account[],
  signals: Signal[],
  vocabulary: Vocabulary,
  profile: Profile,
  now = Date.now(),
): ScoredAccount[] {
  const { opportunities, excluded } = rankFeed(accounts, signals, vocabulary, profile, now);
  return [...opportunities, ...excluded];
}
