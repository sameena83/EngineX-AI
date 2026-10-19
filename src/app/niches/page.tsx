"use client";

// The niche explorer: choose a market and see the configuration EngineX would
// use for it.
//
// This is the read-only twin of the niche editor on the profile page. The editor
// answers "what is my workspace set to?"; this answers the question a prospect
// asks first — "what would this do for *my* market, and what would change if I
// switched?" — so it shows the whole profile rather than the current values:
// services, targeting, the positive signal rules with their weights, the noise
// rules that veto them, scoring, and the queries that feed collection.
//
// The presets are compiled into the app (see `../lib/niches`), so they are read
// directly rather than fetched: the picker renders in the server HTML, works
// before any request resolves, and cannot half-load. Only the workspace's own
// state — which niche is active, and what a switch would replace — comes from
// the network.

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { channelLabel } from "@/lib/channels";
import { NICHE_PRESETS, type NichePreset, type PresetSignal } from "@/lib/niches";
import type { Profile } from "@/lib/types";
import { clearVocabularyCache, loadVocabulary, useVocabulary } from "@/lib/use-vocabulary";

const PRESETS = Object.values(NICHE_PRESETS);

const percent = (weight: number): string => `${Math.round(weight * 100)}%`;

/** A labelled list of short strings, rendered as chips. */
function Chips({ values, tone = "slate" }: { values: string[]; tone?: "slate" | "rose" }) {
  const cls =
    tone === "rose"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
      : "bg-slate-100 text-slate-700";
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className={`badge ${cls}`}>
          {v}
        </span>
      ))}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
          {hint ? <p className="mt-1 max-w-3xl text-xs text-slate-500">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * One signal rule, with its regex sources behind a disclosure.
 *
 * The patterns are the part a developer wants and a buyer does not, so they are
 * collapsed by default rather than omitted — the profile has to be inspectable,
 * and the exact strings are what someone would copy into their own rules.
 */
function SignalRow({ signal, index }: { signal: PresetSignal; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-slate-800">{signal.label}</span>
          <code className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
            {signal.key}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">weight</span>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-800"
              style={{ width: `${Math.round(signal.weight * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-[11px] font-medium text-slate-700">
            {percent(signal.weight)}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{signal.why}</p>
      {/* The channel is the rule's precondition: the pattern can be perfect and
          still never fire if no source feeds the evidence it reads. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-400">reads:</span>
        {signal.sources.length === 0 ? (
          <span className="badge bg-amber-50 text-amber-700">every channel</span>
        ) : (
          signal.sources.map((c) => (
            <span key={c} className="badge bg-slate-100 text-slate-600">
              {channelLabel(c)}
            </span>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 text-[11px] font-medium text-slate-500 hover:text-slate-800"
      >
        {open ? "Hide" : "Show"} {signal.patterns.length} positive rule
        {signal.patterns.length === 1 ? "" : "s"} &amp; matched services
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <div className="label mb-1">Positive rules (regex, case-insensitive)</div>
            <ul className="space-y-0.5">
              {signal.patterns.map((p) => (
                <li key={p} className="truncate font-mono text-[11px] text-slate-600" title={p}>
                  /{p}/
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-1">Services this signal implies</div>
            <Chips values={signal.serviceKeywords} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

interface WorkspaceState {
  niche: string;
  label: string;
  buyerRoles: string[];
  exclusions: string[];
  scoring: { fitPoints: number; halfLifeDays: number };
  sourceQueries: string[];
  negativeRuleCount: number;
  signalKeys: string[];
  services: string[];
  idealClient: Profile["idealClient"] | null;
}

/**
 * What adopting a preset would change in this workspace.
 *
 * Everything is compared against the workspace's *current* values rather than
 * the preset it started from, because a customer may have edited any of them —
 * a diff against the original preset would claim changes that would not happen.
 * Signals are compared by key: the shared keys (funding, tenders, new leaders)
 * are what make performance comparable across markets, so a switch that keeps
 * them says so.
 */
function Diff({ preset, workspace }: { preset: NichePreset; workspace: WorkspaceState | null }) {
  if (!workspace) {
    return <p className="text-xs text-slate-500">Reading this workspace…</p>;
  }
  const presetKeys = preset.signals.map((s) => s.key);
  const kept = presetKeys.filter((k) => workspace.signalKeys.includes(k));
  const added = presetKeys.filter((k) => !workspace.signalKeys.includes(k));
  const dropped = workspace.signalKeys.filter((k) => !presetKeys.includes(k));
  const sameMarket = preset.key === workspace.niche;

  const lines: { label: string; detail: string }[] = [
    {
      label: "Signals collected",
      detail: `${added.length} added (${added.join(", ") || "none"}), ${dropped.length} retired (${
        dropped.join(", ") || "none"
      }), ${kept.length} already shared by key`,
    },
    {
      label: "Services & fit matching",
      detail:
        workspace.services.length > 0
          ? `replaced with ${preset.services.length}: ${preset.services.map((s) => s.name).join(", ")} (was ${workspace.services.join(", ")})`
          : `set to ${preset.services.length}: ${preset.services.map((s) => s.name).join(", ")}`,
    },
    {
      label: "Buyer roles",
      detail: `${workspace.buyerRoles.join(", ") || "none"} → ${preset.buyerRoles.join(", ")}`,
    },
    {
      label: "Scoring",
      detail: `fit up to ${workspace.scoring.fitPoints} → ${preset.scoring.fitPoints} points, freshness half-life ${workspace.scoring.halfLifeDays} → ${preset.scoring.halfLifeDays} days`,
    },
    {
      label: "Exclusions",
      detail: `${workspace.exclusions.join(", ") || "none"} → ${preset.exclusions.join(", ")}`,
    },
    {
      label: "Source queries",
      detail: `replaced with ${preset.sourceQueries.length} queries, e.g. “${preset.sourceQueries[0]}”`,
    },
    {
      label: "Evidence channels",
      detail: `the rules read ${[...new Set(preset.signals.flatMap((s) => s.sources))]
        .map(channelLabel)
        .join(", ")} — a channel with no source behind it means those signals can never fire`,
    },
    {
      label: "Signals already in your feed",
      detail:
        "kept and re-scored against the new service list, never deleted — a key the new market does not define still counts as evidence and keeps its stored meaning",
    },
  ];

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {sameMarket
          ? `This is the market the workspace is on. Below is what the preset holds; your own values win wherever you have edited them.`
          : `Switching from ${workspace.label} to ${preset.label} would make these changes:`}
      </p>
      <dl className="grid gap-2">
        {lines.map((l) => (
          <div key={l.label} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
            <dt className="text-xs font-medium text-slate-700">{l.label}</dt>
            <dd className="text-xs leading-relaxed text-slate-500">{l.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function NichesPage() {
  const data = useVocabulary();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: { profile: Profile }) => setProfile(d.profile))
      .catch(() => undefined);
  }, []);

  const activeKey = data?.niche.key ?? null;
  // Selection follows the workspace until the visitor picks something else, so
  // the page opens on the market they are actually running.
  const selected = PRESETS.find((p) => p.key === (picked ?? activeKey)) ?? PRESETS[0];

  const workspace: WorkspaceState | null = data
    ? {
        niche: data.niche.key,
        label: data.niche.label,
        buyerRoles: data.niche.buyerRoles,
        exclusions: data.niche.exclusions,
        scoring: data.niche.scoring,
        sourceQueries: data.niche.sourceQueries,
        // The vocabulary *is* the workspace's signal list; a preset's signal
        // count is not, which is the difference that matters in the diff.
        signalKeys: data.vocabulary.map((d) => d.type),
        negativeRuleCount: data.niche.negativeRules.length,
        services: profile?.services.map((s) => s.name) ?? [],
        idealClient: profile?.idealClient ?? null,
      }
    : null;

  async function adopt(key: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/niche", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      setBusy(false);
      setMessage(`Could not switch market (HTTP ${res.status}).`);
      return;
    }
    const body = (await res.json()) as { profile: Profile };
    setProfile(body.profile);
    setPicked(key);
    // Every chip, filter and heading reads the shared vocabulary cache, so it is
    // dropped and re-read rather than left showing the previous market's labels.
    clearVocabularyCache();
    await loadVocabulary().catch(() => null);
    setBusy(false);
    setMessage(`This workspace now runs the ${body.profile.nicheConfig.label} profile.`);
  }

  const isActive = selected.key === activeKey;

  return (
    <div>
      <PageHeader
        title="Niche explorer"
        subtitle="One engine, different configuration. Pick a market to see the profile EngineX would run for it — services, targeting, signal rules, guardrails and scoring — and what adopting it would change here."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESETS.map((p) => {
          const chosen = p.key === selected.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setPicked(p.key);
                setMessage(null);
              }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                chosen
                  ? "border-slate-900 bg-white shadow-sm"
                  : "border-slate-200 bg-white/60 hover:border-slate-400"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                {p.key === activeKey ? (
                  <span className="badge bg-emerald-50 text-emerald-700">in use</span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{p.description}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                {p.signals.length} signal rules · {p.services.length} services
              </p>
            </button>
          );
        })}
      </div>

      <Card className="mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {selected.label} profile
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{selected.description}</p>
          </div>
          <div className="flex items-center gap-2">
            {isActive ? (
              <span className="badge bg-emerald-50 text-emerald-700">Running here</span>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !activeKey}
                onClick={() => adopt(selected.key)}
              >
                {busy ? "Switching…" : "Use this niche"}
              </button>
            )}
          </div>
        </div>
        {message ? <div className="mb-4 text-xs text-slate-600">{message}</div> : null}

        <div className="grid gap-5">
          <Section
            title="Who it sells to"
            hint="Starting points for a new workspace, not validated filters. Your own ideal-client numbers override them."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="label mb-1">Company size</div>
                <div className="text-sm text-slate-700">{selected.targeting.employees} employees</div>
              </div>
              <div>
                <div className="label mb-1">Industries</div>
                <Chips values={selected.targeting.industries} />
              </div>
              <div>
                <div className="label mb-1">Geographies</div>
                <Chips values={selected.targeting.geographies} />
              </div>
            </div>
          </Section>

          <Section
            title="Services and problems solved"
            hint="The list the fit matcher reads: a signal only scores well if one of the consultancy's services answers it."
          >
            <ul className="grid gap-2 sm:grid-cols-2">
              {selected.services.map((s) => (
                <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-800">{s.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.description}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Signal rules (positive)"
            hint="Ordered: earlier rules win a tie, which is why a live tender or a named appointment sits above a general technology mention."
            right={
              <span className="text-[11px] text-slate-400">
                {selected.signals.length} rules · weights are 0–100% of a signal&apos;s strength
              </span>
            }
          >
            <ol className="grid gap-2">
              {selected.signals.map((s, i) => (
                <SignalRow key={s.key} signal={s} index={i} />
              ))}
            </ol>
          </Section>

          <Section
            title="Guardrails (negative)"
            hint="What stops the keywords from filling the feed. “AI” and “security” on their own match a lot of a vendor's own marketing, so a vendor announcement, an award or a listicle is vetoed whatever the positive rules found."
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {selected.negativeRules.map((r) => (
                <div key={r.label} className="rounded-lg border border-rose-100 bg-rose-50/40 p-3">
                  <div className="text-xs font-medium text-rose-800">{r.label}</div>
                  <p className="mt-1 text-[11px] text-rose-700/80">{r.patterns.length} patterns</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="label mb-1">Company exclusions</div>
              <Chips values={selected.exclusions} tone="rose" />
              <p className="mt-1 text-[11px] text-slate-500">
                A company matching any of these is hidden from the feed whatever its signals say —
                consultancies sell to buyers, not to other consultancies.
              </p>
            </div>
          </Section>

          <Section
            title="Buyers, angle and scoring"
            hint="How the market is approached once a signal fires, and how hard fit and freshness push the score."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Buyer roles</div>
                <Chips values={selected.buyerRoles} />
              </div>
              <div>
                <div className="label mb-1">Outreach angle</div>
                <p className="text-xs leading-relaxed text-slate-600">{selected.outreachAngle}</p>
              </div>
              <div>
                <div className="label mb-1">Scoring weights</div>
                <p className="text-xs text-slate-600">
                  Fit contributes up to {selected.scoring.fitPoints} points of the 0–100 score.
                </p>
              </div>
              <div>
                <div className="label mb-1">Freshness threshold</div>
                <p className="text-xs text-slate-600">
                  A signal&apos;s influence halves every {selected.scoring.halfLifeDays} days — a
                  platform migration goes stale sooner than a quarterly ERP programme.
                </p>
              </div>
            </div>
          </Section>

          <Section
            title="Where signals come from"
            hint="Each rule reads a kind of evidence — a tender portal, a job board, press coverage — and the queries below are what collection runs until a workspace overrides them. Point the sources at the right channel on the Integrations page."
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {[...new Set(selected.signals.flatMap((s) => s.sources))].map((c) => (
                <span key={c} className="badge bg-slate-100 text-slate-700">
                  {channelLabel(c)}
                  <span className="text-slate-400">
                    {
                      selected.signals.filter((s) => s.sources.includes(c)).length
                    }{" "}
                    rules
                  </span>
                </span>
              ))}
            </div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {selected.sourceQueries.map((q) => (
                <li key={q} className="text-xs text-slate-600">
                  <span className="text-slate-300">▸ </span>
                  {q}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            What {isActive ? "this profile configures" : "switching would change"}
          </h2>
          {workspace && !isActive ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => adopt(selected.key)}
            >
              {busy ? "Switching…" : `Switch to ${selected.label}`}
            </button>
          ) : null}
        </div>
        <p className="mb-4 max-w-3xl text-xs text-slate-500">
          The vocabulary, the config and the service list move together — retargeting is one call,
          not a release. Signals already collected are kept and re-scored, so a change of direction
          reinterprets history rather than erasing it.
        </p>
        <Diff preset={selected} workspace={workspace} />
        {workspace && !isActive ? (
          <p className="mt-4 text-[11px] text-slate-400">
            Signals only exist in the vocabulary of the market that defines them: switch back and the
            previous rules are reinstated from the preset, so it is safe to try a market and change
            your mind.
          </p>
        ) : null}
        {workspace && workspace.idealClient ? (
          <p className="mt-2 text-[11px] text-slate-400">
            Your ideal client ({workspace.idealClient.sector || "sector unset"},{" "}
            {workspace.idealClient.sizeMin}–{workspace.idealClient.sizeMax} employees,{" "}
            {workspace.idealClient.region || "region unset"}) is workspace-level and is not changed by
            a switch.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
