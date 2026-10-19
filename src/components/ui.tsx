"use client";

import { useState, type ReactNode } from "react";
import {
  STATUS_CLASS,
  TIER_CLASS,
  TIER_LABEL,
  signalClass,
  signalLabel,
} from "@/lib/format";
import type { ScoredAccount, SignalType } from "@/lib/types";
import { useVocabulary } from "@/lib/use-vocabulary";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function ScoreBadge({ score, tier }: { score: number; tier: ScoredAccount["tier"] }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${TIER_CLASS[tier]}`}
      >
        {score}
      </span>
      <span className="text-xs font-medium text-slate-500">{TIER_LABEL[tier]}</span>
    </div>
  );
}

/**
 * A signal's chip, labelled from the tenant's vocabulary.
 *
 * The label is read here rather than passed in because every caller wants the
 * same thing and the hook is cached per session — a page does not have to plumb
 * the vocabulary down to each chip to have them read correctly.
 */
export function SignalChip({ type }: { type: SignalType }) {
  const data = useVocabulary();
  return (
    <span className={`badge ${signalClass(type)}`}>{signalLabel(type, data?.vocabulary)}</span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_CLASS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label ?? "Loading…"}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
