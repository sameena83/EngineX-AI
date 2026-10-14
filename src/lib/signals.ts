import { SIGNAL_DEFINITIONS } from "./seed-data";
import type {
  Account,
  ScoredAccount,
  Signal,
  SignalDefinition,
  SignalType,
} from "./types";

export function signalDefinition(type: SignalType): SignalDefinition {
  const d = SIGNAL_DEFINITIONS[type];
  return { type, ...d };
}

/**
 * Recency decay: a signal fired today counts at full strength; its influence
 * halves roughly every 45 days. Boutique consultancies act on fresh signals,
 * so stale evidence should not keep an account at the top of the feed.
 */
function recencyFactor(detectedAt: string, now = Date.now()): number {
  const days = Math.max(0, (now - new Date(detectedAt).getTime()) / 86_400_000);
  return Math.exp(-days / 45);
}

/** Freshness label for the UI. */
export function freshness(signal: Signal, now = Date.now()): string {
  const days = Math.round(
    Math.max(0, (now - new Date(signal.detectedAt).getTime()) / 86_400_000),
  );
  if (days <= 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
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

/**
 * Combine an account's signals into one 0-100 strength score.
 *
 * Each signal contributes `weight * recency`. Independent signals are combined
 * as `1 - Π(1 - p)` so that several moderate signals on one account correctly
 * outrank a single weak one, while a lone strong signal still scores highly.
 */
export function scoreAccount(
  account: Account,
  signals: Signal[],
  now = Date.now(),
): ScoredAccount {
  const contributions = signals
    .map((s) => {
      const def = signalDefinition(s.type);
      const p = Math.min(0.99, def.weight * s.strength * recencyFactor(s.detectedAt, now));
      return { type: s.type, label: def.shortLabel, points: p };
    })
    .sort((a, b) => b.points - a.points);

  const residual = contributions.reduce((acc, c) => acc * (1 - c.points), 1);
  const score = Math.round((1 - residual) * 100);

  const topSignal =
    [...signals].sort(
      (a, b) =>
        b.strength * recencyFactor(b.detectedAt, now) -
        a.strength * recencyFactor(a.detectedAt, now),
    )[0] ?? null;

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
  };
}

export function buildFeed(
  accounts: Account[],
  signals: Signal[],
  now = Date.now(),
): ScoredAccount[] {
  const byAccount = new Map<number, Signal[]>();
  for (const s of signals) {
    const list = byAccount.get(s.accountId) ?? [];
    list.push(s);
    byAccount.set(s.accountId, list);
  }
  return accounts
    .map((a) => scoreAccount(a, byAccount.get(a.id) ?? [], now))
    .sort((a, b) => b.score - a.score);
}
