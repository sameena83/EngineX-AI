"use client";

// The niche profile editor: the configuration that decides what "a signal" means
// for this workspace.
//
// Three things live here, and they are deliberately separate:
//
//   1. the market  — switch preset and the config and vocabulary are replaced together,
//   2. the config  — buyers, exclusions, scoring, source queries, the pitch,
//   3. the signals — the vocabulary itself: per signal, its label, weight, the
//      regex patterns the offline classifier compiles, and the service keywords
//      the fit matcher reads.
//
// All of it is per tenant and edited over HTTP, so retargeting the app at another
// market is configuration rather than a release. The market switches in one call;
// the vocabulary has its own save because it is the part a customer iterates on.

import { useState } from "react";
import { Card } from "@/components/ui";
import { CHANNELS, channelLabel } from "@/lib/channels";
import { listNiches } from "@/lib/niches";
import type { NicheConfig, Profile, SignalDefinition, Vocabulary } from "@/lib/types";
import { clearVocabularyCache, loadVocabulary, useVocabulary } from "@/lib/use-vocabulary";

// The preset list is static data, so it is read directly rather than over the
// network: the market picker still works when the vocabulary request fails, and
// it renders in the server HTML instead of appearing a moment later.

const csvList = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const toCsv = (values: string[]): string => values.join(", ");

const toLines = (values: string[]): string => values.join("\n");

const fromLines = (value: string): string[] =>
  value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

export function NicheEditor({
  profile,
  onProfile,
}: {
  profile: Profile;
  onProfile: (next: Profile) => void;
}) {
  const data = useVocabulary();
  const [vocabStatus, setVocabStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edits are held as a draft keyed to the vocabulary they were made against.
  // When a new copy arrives — after a save, or after switching market — the key
  // no longer matches and the draft is discarded by derivation, so there is no
  // effect syncing two sources of truth.
  const source = data?.vocabulary ?? null;
  const [draft, setDraft] = useState<{ source: Vocabulary; edited: Vocabulary } | null>(null);
  const vocab = draft && draft.source === source ? draft.edited : source;

  const edit = (next: Vocabulary) => {
    if (source) setDraft({ source, edited: next });
    setVocabStatus("idle");
  };

  const cfg: NicheConfig = profile.nicheConfig;

  const patchConfig = (next: Partial<NicheConfig>) =>
    onProfile({ ...profile, nicheConfig: { ...cfg, ...next } });

  const patchSignal = (index: number, next: Partial<SignalDefinition>) =>
    edit((vocab ?? []).map((d, i) => (i === index ? { ...d, ...next } : d)));

  const removeSignal = (index: number) => edit((vocab ?? []).filter((_, i) => i !== index));

  const addSignal = () =>
    edit([
      ...(vocab ?? []),
      {
        type: `new_signal_${(vocab?.length ?? 0) + 1}`,
        label: "New signal",
        shortLabel: "New signal",
        weight: 0.7,
        why: "",
        patterns: [],
        serviceKeywords: [],
        sources: [],
      },
    ]);

  async function saveVocabulary() {
    if (!vocab) return;
    setVocabStatus("saving");
    setMessage(null);
    const res = await fetch("/api/vocabulary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vocabulary: vocab }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setVocabStatus("error");
      setMessage(body.error ?? `Save failed (HTTP ${res.status})`);
      return;
    }
    setVocabStatus("saved");
    // Every chip and filter reads the shared cache, so it has to be invalidated
    // and re-fetched rather than left showing the pre-save labels. That also
    // retires the local draft, which is why the response body is not needed.
    clearVocabularyCache();
    await loadVocabulary().catch(() => undefined);
  }

  /**
   * Switching market is one call: the vocabulary, the config and (by default) the
   * service list are replaced together. Existing signals are kept — they were
   * real evidence when collected, and the scorer still counts them.
   */
  async function applyPreset(key: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/niche", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      setBusy(false);
      setMessage(`Could not switch niche (HTTP ${res.status})`);
      return;
    }
    const body = (await res.json()) as { profile: Profile };
    onProfile(body.profile);
    clearVocabularyCache();
    await loadVocabulary().catch(() => null);
    setBusy(false);
    setMessage(`Switched to ${body.profile.nicheConfig.label}. Save the profile to keep it.`);
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Niche profile</h2>
        <span className="badge bg-slate-100 text-slate-600">{cfg.label}</span>
      </div>
      <p className="mb-4 max-w-3xl text-xs text-slate-500">
        What this workspace sells and what counts as a buying signal in its market. Switching market
        replaces the signal vocabulary, the buyer roles, the noise rules and the source queries
        together; signals already collected are kept and re-scored against the new services.
      </p>

      {/* ---------------------------- market ---------------------------- */}
      <div className="mb-5">
        <label className="label">Market</label>
        <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {listNiches().map((n) => (
            <button
              key={n.key}
              disabled={busy}
              onClick={() => applyPreset(n.key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                n.key === profile.niche
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-400"
              } disabled:opacity-50`}
            >
              <div className="text-xs font-semibold text-slate-800">{n.label}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{n.description}</div>
              <div className="mt-1 text-[11px] text-slate-400">{n.signals} signals</div>
            </button>
          ))}
        </div>
        {message ? <div className="mt-2 text-xs text-slate-600">{message}</div> : null}
      </div>

      {/* ---------------------------- config ---------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Buyer roles to approach</label>
          <input
            className="input"
            value={toCsv(cfg.buyerRoles)}
            onChange={(e) => patchConfig({ buyerRoles: csvList(e.target.value) })}
            placeholder="CISO, Head of Security, CTO"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Used in briefs and drafts when no contact is on file.
          </span>
        </div>
        <div>
          <label className="label">Exclusions (competitors, non-buyers)</label>
          <input
            className="input"
            value={toCsv(cfg.exclusions)}
            onChange={(e) => patchConfig({ exclusions: csvList(e.target.value) })}
            placeholder="consultancy, agency, recruitment"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            A company matching any of these is hidden from the feed whatever its signals say.
          </span>
        </div>
        <div>
          <label className="label">Freshness half-life (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            className="input"
            value={cfg.scoring.halfLifeDays}
            onChange={(e) =>
              patchConfig({
                scoring: { ...cfg.scoring, halfLifeDays: Number(e.target.value) || 1 },
              })
            }
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            A signal&apos;s influence halves every this many days. Lower is stricter.
          </span>
        </div>
        <div>
          <label className="label">Fit weight (points of 100)</label>
          <input
            type="number"
            min={0}
            max={80}
            className="input"
            value={cfg.scoring.fitPoints}
            onChange={(e) =>
              patchConfig({ scoring: { ...cfg.scoring, fitPoints: Number(e.target.value) || 0 } })
            }
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            How much a perfect market fit adds to a score, against signal strength.
          </span>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Outreach angle</label>
          <input
            className="input"
            value={cfg.outreachAngle}
            onChange={(e) => patchConfig({ outreachAngle: e.target.value })}
            placeholder="Meet a specific security or compliance requirement."
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Source queries (one per line)</label>
          <textarea
            className="input h-24 font-mono text-[11px]"
            value={cfg.sourceQueries.join("\n")}
            onChange={(e) => patchConfig({ sourceQueries: fromLines(e.target.value) })}
            placeholder={"company appoints chief information security officer\ncompany data breach notification filed"}
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            What the news source searches for. A niche with different buying moments needs different
            queries — this is usually the first thing to tune.
          </span>
        </div>
      </div>

      {/* ---------------------------- noise rules ---------------------------- */}
      <div className="mt-5">
        <label className="label">Negative rules — always noise, in any market</label>
        <div className="mt-1 space-y-3">
          {cfg.negativeRules.map((rule, i) => (
            <div key={rule.label} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input w-56"
                  value={rule.label}
                  onChange={(e) =>
                    patchConfig({
                      negativeRules: cfg.negativeRules.map((r, idx) =>
                        idx === i ? { ...r, label: e.target.value } : r,
                      ),
                    })
                  }
                />
                <span className="text-[11px] text-slate-500">
                  {rule.patterns.length} pattern{rule.patterns.length === 1 ? "" : "s"}
                </span>
                <button
                  className="btn-ghost ml-auto"
                  onClick={() =>
                    patchConfig({
                      negativeRules: cfg.negativeRules.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  Remove
                </button>
              </div>
              <textarea
                className="input mt-2 h-20 font-mono text-[11px]"
                value={toLines(rule.patterns)}
                onChange={(e) =>
                  patchConfig({
                    negativeRules: cfg.negativeRules.map((r, idx) =>
                      idx === i ? { ...r, patterns: fromLines(e.target.value) } : r,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            className="btn-ghost"
            onClick={() =>
              patchConfig({
                negativeRules: [...cfg.negativeRules, { label: "New rule", patterns: [] }],
              })
            }
          >
            Add negative rule
          </button>
        </div>
        <span className="mt-1 block text-[11px] text-slate-500">
          An item matching one of these is dropped before classification, and counted separately in
          the ingestion report as &ldquo;suppressed as noise&rdquo;. This is the counterweight to
          broad keywords like &ldquo;AI&rdquo; or &ldquo;security&rdquo;.
        </span>
      </div>

      {/* ---------------------------- vocabulary ---------------------------- */}
      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Signal vocabulary{ vocab ? ` (${vocab.length})` : "" }
          </h3>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={addSignal}>
              Add signal
            </button>
            <button
              className="btn-primary"
              onClick={saveVocabulary}
              disabled={vocabStatus === "saving" || !vocab}
            >
              {vocabStatus === "saving"
                ? "Saving…"
                : vocabStatus === "saved"
                  ? "Saved"
                  : "Save vocabulary"}
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Each signal is a key, a weight (how much it alone implies a live need), the evidence
          channels it reads, and the patterns the offline classifier compiles. Patterns are regular
          expressions matched case-insensitively against a source item; a malformed one is skipped
          rather than breaking ingestion. A rule is only run against items from the channels it
          declares, so a tender pattern stays out of press coverage. Signal order is the tie-break,
          so list the narrow, urgent ones first.
        </p>
        {vocabStatus === "error" && message ? (
          <div className="mb-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{message}</div>
        ) : null}

        <div className="space-y-3">
          {(vocab ?? []).map((sig, i) => (
            <details key={`${sig.type}-${i}`} className="rounded-lg border border-slate-200 p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">{sig.label}</span>
                <code className="text-[11px] text-slate-400">{sig.type}</code>
                <span className="badge bg-slate-100 text-slate-600">weight {sig.weight}</span>
                <span className="text-[11px] text-slate-400">
                  {sig.patterns.length} pattern{sig.patterns.length === 1 ? "" : "s"}
                </span>
                <span className="text-[11px] text-slate-400">
                  {sig.sources.length === 0
                    ? "any channel"
                    : sig.sources.map(channelLabel).join(" + ")}
                  {/* Written before channels existed and never edited: the routing
                      shown is the one the presets declare for this rule key. */}
                  {sig.sourcesExplicit === false && sig.sources.length > 0 ? " · preset default" : ""}
                </span>
              </summary>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Key</label>
                  <input
                    className="input font-mono text-[11px]"
                    value={sig.type}
                    onChange={(e) => patchSignal(i, { type: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Label</label>
                  <input
                    className="input"
                    value={sig.label}
                    onChange={(e) => patchSignal(i, { label: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Short label</label>
                  <input
                    className="input"
                    value={sig.shortLabel}
                    onChange={(e) => patchSignal(i, { shortLabel: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Weight (0–1)</label>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    className="input"
                    value={sig.weight}
                    onChange={(e) => patchSignal(i, { weight: Number(e.target.value) })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Why it matters</label>
                  <input
                    className="input"
                    value={sig.why}
                    onChange={(e) => patchSignal(i, { why: e.target.value })}
                    placeholder="A live tender is an explicit statement of need."
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Patterns (one regex per line)</label>
                  <textarea
                    className="input h-28 font-mono text-[11px]"
                    value={toLines(sig.patterns)}
                    onChange={(e) => patchSignal(i, { patterns: fromLines(e.target.value) })}
                    placeholder={"\\btender\\b\nrequest for (proposals?|information)"}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Evidence channels this rule reads</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CHANNELS.map((c) => {
                      const on = sig.sources.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title={c.reads}
                          onClick={() =>
                            patchSignal(i, {
                              sources: on
                                ? sig.sources.filter((s) => s !== c.id)
                                : [...sig.sources, c.id],
                              // Toggling a channel is a decision, so the rule stops
                              // following the preset for its key — including when
                              // the last channel is removed, which then means
                              // "any channel" on purpose rather than by default.
                              sourcesExplicit: true,
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            on
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
                          }`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {sig.sources.length === 0
                      ? "No channel selected: the rule is run against every source, which is the tolerant default but the fastest way to match a tender phrase inside a press release."
                      : sig.sourcesExplicit === false
                        ? "This rule predates channels, so it follows the preset routing for its key. Toggle one to make the choice yours."
                        : "The rule is only matched against items from these channels, so it can only fire on evidence of the right kind."}
                  </span>
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Service keywords (comma separated)</label>
                  <input
                    className="input"
                    value={toCsv(sig.serviceKeywords)}
                    onChange={(e) => patchSignal(i, { serviceKeywords: csvList(e.target.value) })}
                    placeholder="assurance, compliance, testing"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">
                    Matched against your service names and descriptions. A signal matching none of
                    them makes an account a poor fit however strong the evidence is.
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Changing a key orphans signals already stored under the old one.
                </span>
                <button className="btn-danger" onClick={() => removeSignal(i)}>
                  Remove signal
                </button>
              </div>
            </details>
          ))}
        </div>
      </div>
    </Card>
  );
}
