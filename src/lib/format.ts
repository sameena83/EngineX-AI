import type { ScoredAccount, SignalType, Vocabulary } from "./types";
import { humaniseType } from "./vocab";

export const TIER_LABEL: Record<ScoredAccount["tier"], string> = {
  very_strong: "Very strong",
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

export const TIER_CLASS: Record<ScoredAccount["tier"], string> = {
  very_strong: "bg-emerald-100 text-emerald-800",
  strong: "bg-sky-100 text-sky-800",
  moderate: "bg-amber-100 text-amber-800",
  weak: "bg-slate-100 text-slate-600",
};

/** Colours for the signal keys the default niche uses. */
const SIGNAL_CLASS: Record<SignalType, string> = {
  new_data_leader: "bg-violet-100 text-violet-800",
  data_hiring_no_leadership: "bg-sky-100 text-sky-800",
  public_rfp: "bg-rose-100 text-rose-800",
  funding_ma: "bg-amber-100 text-amber-800",
  platform_adoption: "bg-teal-100 text-teal-800",
};

/**
 * A stable colour per signal key.
 *
 * A tenant can define a signal this build has never seen, so the palette is
 * chosen by hashing the key rather than by a lookup that can miss — the same key
 * always gets the same colour, and an unknown one still reads as a distinct chip.
 */
const SIGNAL_PALETTE = [
  "bg-violet-100 text-violet-800",
  "bg-sky-100 text-sky-800",
  "bg-rose-100 text-rose-800",
  "bg-amber-100 text-amber-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
  "bg-lime-100 text-lime-800",
  "bg-fuchsia-100 text-fuchsia-800",
];

export function signalClass(type: SignalType): string {
  const known = SIGNAL_CLASS[type];
  if (known) return known;
  let hash = 0;
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SIGNAL_PALETTE[hash % SIGNAL_PALETTE.length];
}

/**
 * A signal's short label, from the tenant's own vocabulary.
 *
 * Falls back to the raw key when the vocabulary is still loading or the signal
 * was stored under a vocabulary the tenant has since replaced — a chip that says
 * "security_technology_adoption" is worse than one that says "Security tooling",
 * but far better than one that says nothing.
 */
export function signalLabel(type: SignalType, vocabulary?: Vocabulary): string {
  const def = vocabulary?.find((d) => d.type === type);
  return def?.shortLabel ?? humaniseType(type);
}

export const STATUS_CLASS: Record<string, string> = {
  new: "bg-slate-100 text-slate-600",
  approved: "bg-emerald-100 text-emerald-800",
  dismissed: "bg-rose-100 text-rose-700",
  draft: "bg-amber-100 text-amber-800",
};

export function employees(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 35) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
