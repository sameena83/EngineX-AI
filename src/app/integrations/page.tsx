"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader, Spinner, StatusChip } from "@/components/ui";
import type { IngestReport } from "@/lib/ingest";
import type { SourceStatus } from "@/lib/sources";
import type { Integration, IntegrationKind, Profile, SendRecord } from "@/lib/types";

type Meta = Record<
  IntegrationKind,
  { label: string; hint: string; setup: string[]; steps: string[]; urlHint: string; docs: string }
>;

function describeReport(r: IngestReport): string {
  const parts = [
    `${r.signalsAdded} new signal${r.signalsAdded === 1 ? "" : "s"}`,
    `${r.accountsCreated} new account${r.accountsCreated === 1 ? "" : "s"}`,
  ];
  if (r.accountsMatched) parts.push(`${r.accountsMatched} matched`);
  if (r.duplicates) parts.push(`${r.duplicates} already known`);
  if (r.unclassified) parts.push(`${r.unclassified} not a tracked signal`);
  const errors = r.sources.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`);
  const prefix = r.mode === "dry_run" ? "Dry run — nothing written. " : "";
  return `${prefix}${r.candidates} candidate${r.candidates === 1 ? "" : "s"} · ${parts.join(" · ")}${
    errors.length ? ` — ${errors.join("; ")}` : ""
  }`;
}

interface DraftState {
  url: string;
  enabled: boolean;
  label: string;
  events: string[];
}

// An endpoint that fails can return an empty body, which would throw out of
// res.json(). Settling each read on its own keeps one bad card from blanking the
// rest of the page.
const readJson = (res: Response) => res.json().catch(() => ({}));

const EVENT_LABELS: { id: string; label: string; hint: string }[] = [
  { id: "digest", label: "Scheduled digest", hint: "The top accounts, sent on your cadence (weekly or daily)" },
  { id: "account_card", label: "Strong-signal alerts", hint: "One account, the moment it qualifies" },
  { id: "send_log", label: "Send log", hint: "When an outreach email is sent" },
];

const ALL_EVENTS = EVENT_LABELS.map((e) => e.id);

export default function IntegrationsPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [saved, setSaved] = useState<Record<string, Integration>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [sends, setSends] = useState<(SendRecord & { accountName: string })[]>([]);
  const [provider, setProvider] = useState("");
  const [policy, setPolicy] = useState<Profile["delivery"] | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [cronResult, setCronResult] = useState("");
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [secretRequired, setSecretRequired] = useState(false);
  const [lastRun, setLastRun] = useState<IngestReport | null>(null);
  const [ingestResult, setIngestResult] = useState("");
  const [ingestBusy, setIngestBusy] = useState<"run" | "dry" | null>(null);
  const [digest, setDigest] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/integrations");
      const data = await readJson(res);
      if (cancelled) return;
      if (!data.meta) return;
      setMeta(data.meta);
      const byKind: Record<string, Integration> = {};
      for (const i of data.integrations as Integration[]) byKind[i.kind] = i;
      setSaved(byKind);
      setDrafts((prev) => {
        const next: Record<string, DraftState> = {};
        for (const kind of Object.keys(data.meta) as IntegrationKind[]) {
          const existing = byKind[kind];
          next[kind] = prev[kind] ?? {
            url: existing?.url ?? "",
            enabled: existing?.enabled ?? true,
            label: existing?.label ?? data.meta[kind].label,
            events: existing?.events ?? ALL_EVENTS,
          };
        }
        return next;
      });
      // Each read is settled on its own: one failing endpoint must not blank the
      // cards belonging to the others.
      const [s, profRes, ingestRes] = await Promise.all([
        fetch("/api/sends").then(readJson),
        fetch("/api/profile").then(readJson),
        fetch("/api/ingest").then(readJson),
      ]);
      if (cancelled) return;
      setSends(s.sends);
      setProvider(s.provider);
      setPolicy(profRes.profile?.delivery ?? null);
      setSources((ingestRes.sources as SourceStatus[]) ?? []);
      setSecretRequired(Boolean(ingestRes.secretRequired));
      setLastRun((ingestRes.lastRun as IngestReport) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setDraft(kind: string, patch: Partial<DraftState>) {
    setDrafts((p) => ({ ...p, [kind]: { ...p[kind], ...patch } }));
  }

  async function save(kind: IntegrationKind) {
    const d = drafts[kind];
    if (!d?.url) return;
    setBusy(kind);
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        url: d.url,
        enabled: d.enabled,
        label: d.label,
        events: d.events,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.error) {
      setTestResult((p) => ({ ...p, [kind]: `Error: ${data.error}` }));
      return;
    }
    setSaved((p) => ({ ...p, [kind]: data.integration }));
    setTestResult((p) => ({ ...p, [kind]: "Saved." }));
  }

  async function remove(kind: IntegrationKind, id: number) {
    setBusy(kind);
    await fetch(`/api/integrations?id=${id}`, { method: "DELETE" });
    setBusy(null);
    setSaved((p) => {
      const next = { ...p };
      delete next[kind];
      return next;
    });
    setDraft(kind, { url: "", enabled: true, events: ALL_EVENTS });
    setTestResult((p) => ({ ...p, [kind]: "Removed." }));
  }

  async function runIngest(dry: boolean) {
    setIngestBusy(dry ? "dry" : "run");
    setIngestResult("");
    const res = await fetch(`/api/ingest${dry ? "?dry=1" : ""}`, { method: "POST" });
    const data = (await readJson(res)) as IngestReport & { error?: string };
    setIngestBusy(null);
    if (data.error) {
      setIngestResult(`Error: ${data.error}`);
      return;
    }
    setIngestResult(describeReport(data));
    if (!dry) setLastRun(data);
  }

  async function togglePreview(kind: IntegrationKind) {
    if (preview[kind]) {
      setPreview((p) => {
        const next = { ...p };
        delete next[kind];
        return next;
      });
      return;
    }
    const res = await fetch(`/api/integrations/preview?kind=${kind}`);
    const data = await res.json();
    setPreview((p) => ({ ...p, [kind]: JSON.stringify(data.payload, null, 2) }));
  }

  async function test(kind: IntegrationKind) {
    setBusy(kind);
    const res = await fetch("/api/integrations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url: drafts[kind]?.url }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.error) {
      setTestResult((p) => ({ ...p, [kind]: `Error: ${data.error}` }));
      return;
    }
    const r = data.result as { ok: boolean; status: number | null; error: string | null };
    setTestResult((p) => ({
      ...p,
      [kind]: r.ok ? "Test delivered ✓" : `Failed: ${r.error ?? r.status}`,
    }));
  }

  async function savePolicy() {
    if (!policy) return;
    setPolicyBusy(true);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivery: policy }),
    });
    setPolicyBusy(false);
    setCronResult("Delivery policy saved.");
  }

  async function runScheduled() {
    setPolicyBusy(true);
    const res = await fetch("/api/cron?force=1", { method: "POST" });
    const data = await res.json();
    setPolicyBusy(false);
    if (data.error) {
      setCronResult(`Error: ${data.error}`);
      return;
    }
    setCronResult(
      `Digest delivered to ${data.digest.delivered}/${data.digest.attempted} destinations · ${data.alerts.sent} alert(s) sent.`,
    );
  }

  async function sendDigest() {
    setBusy("digest");
    const res = await fetch("/api/integrations/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "digest", limit: 8 }),
    });
    const data = await res.json();
    setBusy(null);
    setDigest(
      data.attempted === 0
        ? "No enabled destinations subscribe to the digest yet."
        : `Delivered to ${data.delivered}/${data.attempted} destinations.`,
    );
  }

  if (!meta) return <Spinner label="Loading integrations…" />;

  const kinds = Object.keys(meta) as IntegrationKind[];

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Deliver accounts where your partners already work. All four targets are inbound webhooks — EngineX POSTs JSON to the URL you paste."
        actions={
          <button className="btn-primary" disabled={busy === "digest"} onClick={sendDigest}>
            Send digest now
          </button>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-medium text-slate-800">Outbound email sending</div>
          <div className="text-xs text-slate-500">
            {provider === "dry-run"
              ? "Not configured — sends are simulated. Set EMAIL_PROVIDER + EMAIL_API_KEY to send for real."
              : `Sending via ${provider}.`}
          </div>
        </div>
        {digest ? <div className="text-xs text-slate-600">{digest}</div> : null}
      </Card>

      <Card className="mb-5 p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">Signal sources</div>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary"
              disabled={ingestBusy !== null || secretRequired}
              onClick={() => runIngest(false)}
            >
              {ingestBusy === "run" ? "Running…" : "Run ingestion now"}
            </button>
            <button
              className="btn-ghost"
              disabled={ingestBusy !== null || secretRequired}
              onClick={() => runIngest(true)}
            >
              {ingestBusy === "dry" ? "Checking…" : "Dry run"}
            </button>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Where accounts come from. EngineX pulls every configured source on the same schedule as
          the digest, classifies what it finds and keeps the evidence. Unconfigured sources are
          skipped; anything else can push candidates to <code>POST /api/ingest</code>.
        </p>
        {sources.length ? (
          <ul className="space-y-2">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800">{s.label}</span>
                    <span
                      className={`badge ${
                        !s.pull
                          ? "bg-sky-100 text-sky-800"
                          : s.configured
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {!s.pull ? "Push" : s.configured ? "Live" : "Needs key"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.notes}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {s.envVars.length ? (
                      <>
                        Env:{" "}
                        {s.envVars.map((v) => (
                          <code key={v} className="mr-1">
                            {v}
                          </code>
                        ))}
                      </>
                    ) : (
                      "No configuration needed"
                    )}
                  </div>
                </div>
                <a
                  className="shrink-0 text-[11px] text-slate-500 underline"
                  href={s.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Docs
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {secretRequired ? (
          <div className="mt-3 text-[11px] text-amber-700">
            <code>INGEST_SECRET</code> is set, so these buttons can’t authenticate — ingest from
            your scheduler or <code>curl</code> with the <code>x-ingest-secret</code> header.
          </div>
        ) : null}
        {ingestResult ? <div className="mt-3 text-xs text-slate-600">{ingestResult}</div> : null}
        {lastRun && !ingestResult ? (
          <div className="mt-3 text-[11px] text-slate-500">
            Last run {new Date(lastRun.ranAt).toLocaleString()} — {describeReport(lastRun)}
          </div>
        ) : null}
      </Card>

      {policy ? (
        <Card className="mb-5 p-5">
          <div className="mb-1 text-sm font-semibold text-slate-900">Delivery policy</div>
          <p className="mb-4 text-xs text-slate-500">
            Two different urgency levels. The <strong>digest</strong> is a scheduled summary of your
            best accounts; a <strong>strong-signal alert</strong> is one account, sent the first time
            it scores at or above your threshold. Each destination chooses what it receives above.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="label">Digest cadence</span>
              <select
                className="input"
                value={policy.digestCadence}
                onChange={(e) =>
                  setPolicy({ ...policy, digestCadence: e.target.value as Profile["delivery"]["digestCadence"] })
                }
              >
                <option value="off">Off — only alerts</option>
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Alert threshold (score)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={policy.alertMinScore}
                onChange={(e) => setPolicy({ ...policy, alertMinScore: Number(e.target.value) })}
              />
              <span className="mt-1 block text-[11px] text-slate-500">0 turns alerts off.</span>
            </label>
            <label className="block">
              <span className="label">Accounts per digest</span>
              <input
                type="number"
                min={1}
                max={25}
                className="input"
                value={policy.digestSize}
                onChange={(e) => setPolicy({ ...policy, digestSize: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={policyBusy} onClick={savePolicy}>
              Save policy
            </button>
            <button className="btn-ghost" disabled={policyBusy} onClick={runScheduled}>
              Run scheduled delivery now
            </button>
            {cronResult ? <span className="text-xs text-slate-600">{cronResult}</span> : null}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Nothing runs on its own yet — point a scheduler at <code>POST /api/cron</code> (once an
            hour is plenty; it only sends what is actually due). See the README for a crontab and a
            Vercel Cron example.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => {
          const m = meta[kind];
          const d =
            drafts[kind] ?? { url: "", enabled: true, label: m.label, events: ALL_EVENTS };
          const existing = saved[kind];
          return (
            <Card key={kind} className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{m.label}</h2>
                {existing ? (
                  <StatusChip status={existing.enabled ? "approved" : "dismissed"} />
                ) : null}
              </div>
              <p className="mb-3 text-xs text-slate-500">{m.hint}</p>

              <ol className="mb-4 space-y-1">
                {m.setup.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-600">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>

              <label className="label">Webhook URL</label>
              <input
                className="input font-mono text-xs"
                placeholder={m.urlHint}
                value={d.url}
                onChange={(e) => setDraft(kind, { url: e.target.value })}
              />
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDraft(kind, { enabled: e.target.checked })}
                />
                Enabled
              </label>

              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Send this destination
                </div>
                <div className="space-y-1.5">
                  {EVENT_LABELS.map((ev) => (
                    <label key={ev.id} className="flex items-start gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={d.events.includes(ev.id)}
                        onChange={(e) =>
                          setDraft(kind, {
                            events: e.target.checked
                              ? [...d.events, ev.id]
                              : d.events.filter((x) => x !== ev.id),
                          })
                        }
                      />
                      <span>
                        <span className="font-medium">{ev.label}</span>
                        <span className="block text-slate-500">{ev.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="btn-primary"
                  disabled={busy === kind || !d.url}
                  onClick={() => save(kind)}
                >
                  Save
                </button>
                <button
                  className="btn-ghost"
                  disabled={busy === kind || !d.url}
                  onClick={() => test(kind)}
                >
                  Send test
                </button>
                {existing ? (
                  <button
                    className="btn-danger"
                    disabled={busy === kind}
                    onClick={() => remove(kind, existing.id)}
                  >
                    Remove
                  </button>
                ) : null}
                {testResult[kind] ? (
                  <span className="text-xs text-slate-600">{testResult[kind]}</span>
                ) : null}
              </div>

              <details className="mt-3 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">
                  Show me exactly how — {m.steps.length} steps
                </summary>
                <ol className="mt-2 space-y-1.5">
                  {m.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                      <span className="font-semibold text-slate-400">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                <a
                  className="mt-2 inline-block text-xs text-sky-700 underline"
                  href={m.docs}
                  target="_blank"
                  rel="noreferrer"
                >
                  Official setup guide ↗
                </a>
              </details>

              <button className="btn-ghost mt-3" onClick={() => togglePreview(kind)}>
                {preview[kind] ? "Hide payload" : "Preview payload"}
              </button>
              {preview[kind] ? (
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                  {preview[kind]}
                </pre>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Recent sends</h2>
        {sends.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing sent yet. Approve a draft on an account and use “Send email”.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sends.slice(0, 12).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <StatusChip status={s.status === "sent" ? "approved" : s.status === "failed" ? "dismissed" : "draft"} />
                <span className="font-medium text-slate-800">{s.accountName}</span>
                <span className="text-slate-500">{s.toEmail}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{s.subject}</span>
                <span className="text-xs text-slate-400">
                  {s.status} · {s.provider}
                  {s.error ? ` · ${s.error.slice(0, 60)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
