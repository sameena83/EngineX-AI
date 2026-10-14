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
import { employees, relativeDate, signalLabel } from "@/lib/format";
import { SIGNAL_DEFINITIONS } from "@/lib/seed-data";
import type { ScoredAccount, SignalType } from "@/lib/types";

const SIGNAL_TYPES = Object.keys(SIGNAL_DEFINITIONS) as SignalType[];

export default function SignalsPage() {
  const [feed, setFeed] = useState<ScoredAccount[] | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [type, setType] = useState<SignalType | "all">("all");
  const [status, setStatus] = useState<"all" | "new" | "approved" | "dismissed">("all");
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => setFeed(d.feed));

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
        subtitle="Ranked by combined signal strength and recency. Approve the accounts you want to work; dismiss the rest."
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
              {SIGNAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {signalLabel(t)}
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
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {s.account.sector} · {employees(s.account.employees)} employees ·{" "}
                    {s.account.location} · {s.account.domain}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{s.account.description}</p>

                  <ul className="mt-3 space-y-2">
                    {s.signals.map((sig) => (
                      <li key={sig.id} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <SignalChip type={sig.type} />
                          <span className="text-xs text-slate-400">
                            {relativeDate(sig.detectedAt)} · {sig.source}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-800">{sig.summary}</div>
                        <div className="text-xs text-slate-500">{sig.evidence}</div>
                      </li>
                    ))}
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
    </div>
  );
}
