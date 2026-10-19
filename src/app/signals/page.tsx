"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Empty,
  PageHeader,
  ScoreBadge,
  SignalChip,
  Spinner,
  StatusChip,
} from "@/components/ui";
import { employees } from "@/lib/format";
import { detectedAgo, freshness, parseEvidence } from "@/lib/signals";
import type { ScoredAccount, SignalType } from "@/lib/types";
import { useVocabulary } from "@/lib/use-vocabulary";

/** Fit reads as a short badge so a mismatch is obvious before opening a card. */
function FitChip({ fit }: { fit: ScoredAccount["fit"] }) {
  const [cls, label] =
    fit.gate === "out"
      ? ["bg-rose-100 text-rose-800", "Outside your market"]
      : fit.gate === "in"
        ? ["bg-emerald-100 text-emerald-800", "Fits your practice"]
        : ["bg-amber-100 text-amber-800", "Partial fit"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function SignalsPage() {
  // The filter list is the tenant's own vocabulary: a security practice filters
  // by "Compliance audit", not by five data & AI keys it does not track.
  const vocab = useVocabulary();
  const [feed, setFeed] = useState<ScoredAccount[] | null>(null);
  const [excluded, setExcluded] = useState<ScoredAccount[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [type, setType] = useState<SignalType | "all">("all");
  const [status, setStatus] = useState<"all" | "new" | "approved" | "dismissed">("all");
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => {
        setFeed(d.feed);
        setExcluded(d.excluded ?? []);
      });

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!feed) return null;
    return feed.filter((s) => {
      if (s.score < minScore) return false;
      if (status !== "all" && s.account.status !== status) return false;
      if (type !== "all" && !s.signals.some((sig) => sig.type === type)) return false;
      return true;
    });
  }, [feed, minScore, type, status]);

  async function setAccount(accountId: number, next: "new" | "approved" | "dismissed") {
    setBusy(accountId);
    await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setFeed((prev) =>
      prev
        ? prev.map((s) =>
            s.account.id === accountId ? { ...s, account: { ...s.account, status: next } } : s,
          )
        : prev,
    );
    setBusy(null);
  }

  return (
    <div>
      <PageHeader
        title="Signal feed"
        subtitle="Ranked by evidence strength, recency and how well each account fits your target industries, size and services. Approve the accounts you want to work; dismiss the rest."
      />

      <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
        <div>
          <label className="label">Min score</label>
          <input
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-40"
          />
          <div className="text-xs text-slate-500">{minScore}+</div>
        </div>
        <div>
          <label className="label">Signal type</label>
          <div className="w-52">
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as SignalType | "all")}
            >
              <option value="all">All signals</option>
              {(vocab?.vocabulary ?? []).map((d) => (
                <option key={d.type} value={d.type}>
                  {d.shortLabel}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Status</label>
          <div className="w-40">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="approved">Approved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>
        <div className="ml-auto text-xs text-slate-500">
          {filtered ? `${filtered.length} accounts` : ""}
        </div>
      </Card>

      {!filtered ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Empty title="No accounts match these filters" hint="Lower the minimum score or widen the signal type." />
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.account.id} className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <ScoreBadge score={s.score} tier={s.tier} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/accounts/${s.account.id}`}
                      className="text-base font-semibold text-slate-900 hover:underline"
                    >
                      {s.account.name}
                    </Link>
                    <StatusChip status={s.account.status} />
                    <FitChip fit={s.fit} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {s.account.sector} · {employees(s.account.employees)} employees ·{" "}
                    {s.account.location} · {s.account.domain}
                  </div>
                  {s.fit.summary ? (
                    <div className="mt-1 text-[11px] text-slate-500">{s.fit.summary}</div>
                  ) : null}

                  {/* Why it ranks here, then what held it back — never a black box. */}
                  {s.reasons.length > 0 || s.penalties.length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-800">
                        Why this ranks here
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {s.reasons.map((r) => (
                          <li key={r} className="text-[11px] text-emerald-700">+ {r}</li>
                        ))}
                        {s.penalties.map((p) => (
                          <li key={p} className="text-[11px] text-amber-700">− {p}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  <ul className="mt-3 space-y-2">
                    {s.signals.map((sig) => {
                      const parsed = parseEvidence(sig.evidence);
                      return (
                        <li key={sig.id} className="rounded-lg bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <SignalChip type={sig.type} />
                            <span className="text-xs text-slate-400">
                              event {freshness(sig)} · detected {detectedAgo(sig)} · {sig.source}
                            </span>
                          </div>
                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {sig.summary}
                          </div>
                          <div className="text-xs text-slate-500">{parsed.text}</div>
                          {sig.sourceUrl ? (
                            <a
                              href={sig.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-[11px] text-slate-500 underline"
                            >
                              {sig.sourceUrl}
                            </a>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="flex w-full flex-col items-stretch gap-2 sm:w-44">
                  <Link href={`/accounts/${s.account.id}`} className="btn-primary">
                    Research &amp; draft
                  </Link>
                  <button
                    className="btn-ghost"
                    disabled={busy === s.account.id || s.account.status === "approved"}
                    onClick={() => setAccount(s.account.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-danger"
                    disabled={busy === s.account.id || s.account.status === "dismissed"}
                    onClick={() => setAccount(s.account.id, "dismissed")}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Excluded accounts stay visible on request: hiding them silently would
          make the ranking feel arbitrary. */}
      {excluded.length > 0 ? (
        <Card className="mt-5 p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowExcluded((v) => !v)}
          >
            <span className="text-sm font-semibold text-slate-900">
              {excluded.length} account{excluded.length === 1 ? "" : "s"} outside your market
            </span>
            <span className="text-xs text-slate-500">{showExcluded ? "Hide" : "Show"}</span>
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            Hidden from the feed because they fall outside both your target industries and your
            size range — not because the evidence was weak.
          </p>
          {showExcluded ? (
            <ul className="mt-3 space-y-2">
              {excluded.map((s) => (
                <li
                  key={s.account.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/accounts/${s.account.id}`}
                      className="text-sm font-medium text-slate-800 hover:underline"
                    >
                      {s.account.name}
                    </Link>
                    <div className="text-[11px] text-slate-500">{s.fit.summary}</div>
                    {s.fit.industry.reason ? (
                      <div className="text-[11px] text-amber-700">− {s.fit.industry.reason}</div>
                    ) : null}
                    {s.fit.size.reason ? (
                      <div className="text-[11px] text-amber-700">− {s.fit.size.reason}</div>
                    ) : null}
                  </div>
                  <span className="text-xs text-slate-500">score {s.score}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
