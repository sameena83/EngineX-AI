import { SIGNAL_DEFINITIONS } from "./seed-data";
import type { ScoredAccount, SignalType } from "./types";

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

export const SIGNAL_CLASS: Record<SignalType, string> = {
  new_data_leader: "bg-violet-100 text-violet-800",
  data_hiring_no_leadership: "bg-sky-100 text-sky-800",
  public_rfp: "bg-rose-100 text-rose-800",
  funding_ma: "bg-amber-100 text-amber-800",
  platform_adoption: "bg-teal-100 text-teal-800",
};

export function signalLabel(type: SignalType): string {
  return SIGNAL_DEFINITIONS[type]?.shortLabel ?? type;
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
