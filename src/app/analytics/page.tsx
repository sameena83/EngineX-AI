"use client";

import { useEffect, useState } from "react";
import { Card, Empty, PageHeader, Spinner } from "@/components/ui";
import type { Granularity, WonAnalytics, WonBucket } from "@/lib/analytics";

type AnalyticsResponse = {
  weekly?: WonAnalytics;
  monthly?: WonAnalytics;
  yearly?: WonAnalytics;
  hasData?: boolean;
  generatedAt?: string;
};

const TABS: { id: Granularity; label: string; hint: string }[] = [
  { id: "weekly", label: "Weekly", hint: "The last 12 weeks" },
  { id: "monthly", label: "Monthly", hint: "The last 12 months" },
  { id: "yearly", label: "All time", hint: "Every year with activity" },
];

/** Won is the bar; meetings ride alongside it as context for the same period. */
function BarChart({ buckets }: { buckets: WonBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.won, b.meetings)));
  const pct = (n: number) => `${(n / max) * 100}%`;
  return (
    <div
      role="img"
      aria-label={`Accounts won per period across ${buckets.length} periods`}
      className="mt-2"
    >
      <div className="flex items-end gap-1.5 sm:gap-2">
        {buckets.map((b) => (
          <div
            key={b.key}
            className="flex min-w-0 flex-1 flex-col items-center"
            title={`${b.label}: ${b.won} won · ${b.meetings} meeting${b.meetings === 1 ? "" : "s"}`}
          >
            <div className="h-4 text-[10px] font-medium text-slate-700">{b.won || ""}</div>
            <div className="flex h-40 w-full items-end justify-center gap-0.5">
              <div
                className={`w-1/2 max-w-[18px] rounded-t-sm ${b.won ? "bg-slate-900" : "bg-slate-200"}`}
                style={{ height: b.won ? pct(b.won) : "2px" }}
              />
              <div
                className={`w-1/2 max-w-[18px] rounded-t-sm ${b.meetings ? "bg-sky-300" : "bg-sky-50"}`}
                style={{ height: b.meetings ? pct(b.meetings) : "2px" }}
              />
            </div>
            <div className="mt-1 h-8 w-full truncate text-center text-[10px] leading-tight text-slate-400">
              {b.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-900" /> Accounts won
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-300" /> Meetings
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </Card>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [tab, setTab] = useState<Granularity>("weekly");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analytics")
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({}))
      .then((d: AnalyticsResponse) => {
        if (cancelled) return;
        if (!d.weekly) {
          setError("Could not load analytics. Reload to try again.");
          setData({});
          return;
        }
        setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <Spinner label="Loading analytics…" />;

  const view = data[tab];
  const tabHint = TABS.find((t) => t.id === tab)?.hint ?? "";
  const periodName = tab === "weekly" ? "week" : tab === "monthly" ? "month" : "year";

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="What the signals actually produced. Every figure here comes from the outcomes you log on an account."
      />

      {error ? <p className="mb-4 text-xs text-rose-600">{error}</p> : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Accounts won"
          value={String(view?.totals.won ?? 0)}
          sub="All time, counted once per account"
        />
        <Stat
          label={`Won this ${periodName}`}
          value={String(view?.current.won ?? 0)}
          sub={
            view
              ? `${view.current.change >= 0 ? "+" : ""}${view.current.change} vs previous ${periodName}`
              : undefined
          }
        />
        <Stat
          label="Meetings"
          value={String(view?.totals.meetings ?? 0)}
          sub="Accounts that reached a meeting or a win"
        />
        <Stat
          label="Win rate"
          value={`${Math.round((view?.totals.winRate ?? 0) * 100)}%`}
          sub={`${view?.totals.won ?? 0} won of ${view?.totals.contacted ?? 0} contacted`}
        />
      </div>

      <Card className="mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Accounts won over time</h2>
            <p className="mt-0.5 text-xs text-slate-500">{tabHint}</p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!data.hasData ? (
          <Empty
            title="No outcomes logged yet"
            hint="Log a meeting, a reply or a win on an account and the trend appears here."
          />
        ) : view && view.buckets.some((b) => b.won || b.meetings) ? (
          <BarChart buckets={view.buckets} />
        ) : (
          <p className="text-sm text-slate-500">
            Nothing in this window. Try another period, or log a win to start the trend.
          </p>
        )}
      </Card>

      {view && data.hasData ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Period detail</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Won</th>
                  <th className="py-2 pr-4 font-medium">Meetings</th>
                  <th className="py-2 pr-4 font-medium">Replies</th>
                  <th className="py-2 font-medium">Won to date</th>
                </tr>
              </thead>
              <tbody>
                {[...view.buckets].reverse().map((b) => (
                  <tr key={b.key} className="border-t border-slate-100">
                    <td className="py-2 pr-4 text-slate-600">{b.label}</td>
                    <td className="py-2 pr-4 font-medium text-slate-900">{b.won}</td>
                    <td className="py-2 pr-4 text-slate-600">{b.meetings}</td>
                    <td className="py-2 pr-4 text-slate-600">{b.replies}</td>
                    <td className="py-2 text-slate-500">{b.cumulative}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            A win counts in the period it closed in and is never counted twice, so a re-logged win
            does not inflate the trend. Contact volume is tracked per account, not per period.
            {data.generatedAt
              ? ` Generated ${new Date(data.generatedAt).toLocaleString()}.`
              : ""}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
