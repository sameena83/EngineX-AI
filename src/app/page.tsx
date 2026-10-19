"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, PageHeader, ScoreBadge, SignalChip, Spinner } from "@/components/ui";
import type { Draft, Profile, ScoredAccount } from "@/lib/types";
import type { PerformanceSummary } from "@/lib/stats";

type DraftRow = Draft & { accountName: string; accountDomain: string };

const STEPS = [
  { n: 1, t: "Service profile", d: "Describe services, ideal client and case studies once." },
  { n: 2, t: "Signal feed", d: "Companies showing need-signals now, ranked by strength." },
  { n: 3, t: "Account brief", d: "Why now, likely pain, matching case-study angle, who to contact." },
  { n: 4, t: "Contact finder", d: "Decision-makers and verified emails from a licensed provider." },
  { n: 5, t: "Outreach drafts", d: "Email, LinkedIn message and warm-intro suggestion." },
  { n: 6, t: "Export", d: "CSV with AI_Subject / AI_Body, or push to your CRM or sequencer." },
];

export default function DashboardPage() {
  const [feed, setFeed] = useState<ScoredAccount[] | null>(null);
  const [excluded, setExcluded] = useState<ScoredAccount[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [perf, setPerf] = useState<PerformanceSummary | null>(null);

  useEffect(() => {
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => {
        setFeed(d.feed);
        setExcluded(d.excluded ?? []);
      });
    fetch("/api/drafts").then((r) => r.json()).then((d) => setDrafts(d.drafts));
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.profile);
        setProvider(d.llmProvider);
      });
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setPerf(d));
  }, []);

  const strong = feed?.filter((f) => f.score >= 60).length ?? 0;
  const approved = feed?.filter((f) => f.account.status === "approved").length ?? 0;
  // Counted exactly as the tile's link filters, or the number and the list it
  // opens disagree — "Drafts ready: 3" opening an empty view is worse than no tile.
  const draftsReady = drafts.filter((d) => d.status === "draft").length;

  return (
    <div>
      <PageHeader
        title="Signal feed"
        subtitle={`Companies showing a need for ${profile?.nicheConfig.label.toLowerCase() ?? "your services"} right now, ranked by signal strength and how well they fit the work you sell. Refreshed weekly.`}
        actions={
          <Link href="/signals" className="btn-primary">
            Open feed
          </Link>
        }
      />

      {/* Each tile opens the view it is counting, already filtered. A number a
          reader cannot act on is a decoration; the link is what makes it a
          control. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Accounts tracked"
          value={feed?.length ?? "—"}
          tone="slate"
          href="/signals"
          hint="Everything in the feed"
        />
        <Stat
          label="Strong signals"
          value={feed ? strong : "—"}
          tone="sky"
          href="/signals?minScore=60"
          hint="Score 60 and above"
        />
        <Stat
          label="Approved accounts"
          value={feed ? approved : "—"}
          tone="emerald"
          href="/signals?status=approved"
          hint="Marked approved"
        />
        <Stat
          label="Drafts ready"
          value={draftsReady}
          tone="amber"
          href="/outreach?status=draft"
          hint="Waiting to approve or send"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Top accounts this week</h2>
            <Link href="/signals" className="text-xs font-medium text-slate-500 hover:text-slate-900">
              View all →
            </Link>
          </div>
          {!feed ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-slate-100">
              {feed.slice(0, 6).map((s) => (
                <li key={s.account.id} className="flex items-center gap-4 py-3">
                  <ScoreBadge score={s.score} tier={s.tier} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/accounts/${s.account.id}`}
                      className="truncate text-sm font-medium text-slate-900 hover:underline"
                    >
                      {s.account.name}
                    </Link>
                    <div className="truncate text-xs text-slate-500">
                      {s.account.sector} · {s.account.employees.toLocaleString()} employees ·{" "}
                      {s.account.location}
                    </div>
                  </div>
                  {s.topSignal ? (
                    <div className="hidden sm:block">
                      <SignalChip type={s.topSignal.type} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {feed && feed.length > 0 ? (
            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
              Ranked by evidence strength plus how well each account fits your target industries,
              size and services.
              {excluded.length > 0
                ? ` ${excluded.length} account${excluded.length === 1 ? " is" : "s are"} hidden as a clear mismatch with your market — open the feed to see which.`
                : ""}
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">
            {profile?.companyName ?? "Your consultancy"}
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            {profile?.headcount ? `${profile.headcount} people · ` : ""}
            Ideal client: {profile?.idealClient.sizeMin}–{profile?.idealClient.sizeMax} employees
          </p>

          <div className="mb-4 rounded-lg bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Outreach generation
            </div>
            <div className="mt-0.5 text-sm font-medium text-slate-800">{provider || "—"}</div>
            <p className="mt-1 text-[11px] text-slate-500">
              {provider === "Template engine"
                ? "Set OPENLLM_API_KEY (or OPENAI_API_KEY) to upgrade briefs and drafts to an LLM."
                : "Briefs and drafts are generated by the configured LLM."}
            </p>
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            How it works
          </h3>
          <ol className="space-y-2">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                  {s.n}
                </span>
                <div>
                  <div className="text-xs font-medium text-slate-800">{s.t}</div>
                  <div className="text-[11px] text-slate-500">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {perf ? (
        <Card className="mt-6 p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Signal performance</h2>
            <span className="text-xs text-slate-500">
              {perf.totals.contacted} contacted · {perf.totals.replies} replied ·{" "}
              {perf.totals.meetings} meetings · {perf.totals.meetingsPer50} meetings / 50 accounts
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Which signals actually turn into conversations. Log outcomes on an account to feed this.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-semibold">Signal</th>
                  <th className="py-2 pr-4 font-semibold">Accounts</th>
                  <th className="py-2 pr-4 font-semibold">Contacted</th>
                  <th className="py-2 pr-4 font-semibold">Replies</th>
                  <th className="py-2 pr-4 font-semibold">Meetings</th>
                  <th className="py-2 font-semibold">Meetings / 50</th>
                </tr>
              </thead>
              <tbody>
                {perf.bySignal.map((s) => (
                  <tr key={s.type} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4">
                      <SignalChip type={s.type} />
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{s.accounts}</td>
                    <td className="py-2 pr-4 text-slate-700">{s.contacted}</td>
                    <td className="py-2 pr-4 text-slate-700">{s.replies}</td>
                    <td className="py-2 pr-4 text-slate-700">{s.meetings}</td>
                    <td className="py-2 font-medium text-slate-900">{s.meetingsPer50}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <p className="mt-6 text-xs text-slate-400">
        Sample market data is fictional and for demonstration. Sending is opt-in: with no email
        provider configured, “Send email” runs in dry-run mode.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  tone: "slate" | "sky" | "emerald" | "amber";
  /** Where the count lives, so the tile can open it filtered. */
  href: string;
  hint: string;
}) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    sky: "text-sky-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  };
  return (
    <Link
      href={href}
      title={`${label}: ${hint}`}
      className="group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <Card className="p-4 transition group-hover:border-slate-300 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <span
            aria-hidden
            className="text-xs text-slate-300 transition-colors group-hover:text-slate-900"
          >
            →
          </span>
        </div>
        <div className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
        <div className="mt-1 text-[11px] text-slate-400 group-hover:text-slate-500">{hint}</div>
      </Card>
    </Link>
  );
}
