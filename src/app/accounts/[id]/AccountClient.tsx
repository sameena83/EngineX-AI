"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Card,
  CopyButton,
  PageHeader,
  ScoreBadge,
  SignalChip,
  Spinner,
  StatusChip,
} from "@/components/ui";
import { relativeDate } from "@/lib/format";
import { detectedAgo, freshness, parseEvidence } from "@/lib/signals";
import type {
  AccountBundle,
  Draft,
  Outcome,
  Profile,
  SignalCorrection,
} from "@/lib/types";

const CHANNEL_LABEL: Record<Draft["channel"], string> = {
  email: "Email",
  linkedin: "LinkedIn message",
  warm_intro: "Warm intro",
};

const OUTCOME_LABEL: Record<Outcome["kind"], string> = {
  reply: "Replied",
  meeting: "Meeting booked",
  won: "Won",
  no_response: "No response",
};

type DraftReview = {
  issues: string[];
  revisedSubject: string | null;
  revisedBody: string;
  rationale: string;
  generatedBy: "llm" | "template";
};

export function AccountClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [bundle, setBundle] = useState<AccountBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tone, setTone] = useState<Profile["tone"]>("consultative");
  const [length, setLength] = useState<Profile["length"]>("medium");
  const [reviews, setReviews] = useState<Record<number, DraftReview>>({});
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState<number | null>(null);
  const [sendForm, setSendForm] = useState<{ to: string; subject: string; body: string } | null>(
    null,
  );
  // Editing happens on the draft itself, not only inside the send sheet: a
  // correction you made while sending used to vanish with the panel.
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ subject: string; body: string }>({
    subject: "",
    body: "",
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editResult, setEditResult] = useState("");
  const [sendResult, setSendResult] = useState("");
  const [sending, setSending] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState("");
  const [sender, setSender] = useState({ name: "", email: "", replyTo: "" });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [corrections, setCorrections] = useState<SignalCorrection[]>([]);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, prof, outs, cors] = await Promise.all([
          fetch(`/api/accounts/${id}`).then((r) => r.json()),
          fetch("/api/profile").then((r) => r.json()),
          fetch(`/api/outcomes?accountId=${id}`).then((r) => r.json()),
          fetch(`/api/signals/corrections?accountId=${id}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setBundle(res.bundle ?? null);
        setSender(prof.profile?.sender ?? { name: "", email: "", replyTo: "" });
        setOutcomes(outs.outcomes ?? []);
        setCorrections(cors.corrections ?? []);
      } catch {
        // A dropped request must not strand the page on a spinner.
        if (cancelled) return;
        setBundle(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function patchAccount(status: "new" | "approved" | "dismissed") {
    setBusy("status");
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBundle((p) => (p ? { ...p, account: { ...p.account, status } } : p));
    setBusy(null);
  }

  async function generateBrief() {
    setBusy("brief");
    const res = await fetch(`/api/accounts/${id}/brief`, { method: "POST" });
    const data = await res.json();
    setBundle((p) => (p ? { ...p, brief: data.brief } : p));
    setBusy(null);
  }

  async function generateDrafts() {
    setBusy("drafts");
    const res = await fetch(`/api/accounts/${id}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone, length }),
    });
    const data = await res.json();
    setBundle((p) => (p ? { ...p, drafts: data.drafts } : p));
    setBusy(null);
  }

  async function setDraftStatus(draftId: number, status: Draft["status"]) {
    await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBundle((p) =>
      p
        ? {
            ...p,
            drafts: p.drafts.map((d) => (d.id === draftId ? { ...d, status } : d)),
          }
        : p,
    );
  }

  async function runReview(draftId: number) {
    setReviewBusy(draftId);
    const res = await fetch(`/api/drafts/${draftId}/review`, { method: "POST" });
    const data = await res.json();
    setReviewBusy(null);
    if (data.error) return;
    setReviews((p) => ({ ...p, [draftId]: data.review }));
  }

  async function applyReview(draftId: number) {
    const r = reviews[draftId];
    if (!r) return;
    const res = await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // A review that proposes no subject (a LinkedIn or warm-intro draft) must
      // not clear the one the draft already has.
      body: JSON.stringify({ subject: r.revisedSubject ?? undefined, body: r.revisedBody }),
    });
    const data = await res.json();
    setBundle((p) =>
      p ? { ...p, drafts: p.drafts.map((d) => (d.id === draftId ? data.draft : d)) } : p,
    );
    setReviews((p) => {
      const next = { ...p };
      delete next[draftId];
      return next;
    });
  }

  function openSend(d: Draft) {
    if (!bundle) return;
    const dm = bundle.contacts.find((c) => c.isDecisionMaker) ?? bundle.contacts[0];
    setSendResult("");
    setSendOpen(d.id);
    setSendForm({ to: dm?.email ?? "", subject: d.subject ?? "", body: d.body });
  }

  function openEdit(d: Draft) {
    setEditResult("");
    setEditing(d.id);
    setSendOpen(null);
    setEditForm({ subject: d.subject ?? "", body: d.body });
  }

  async function saveEdit(draftId: number) {
    if (!editForm.body.trim()) {
      setEditResult("The draft cannot be empty.");
      return;
    }
    setEditBusy(true);
    const res = await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: editForm.subject.trim() ? editForm.subject : null,
        body: editForm.body,
      }),
    });
    const data = await res.json();
    setEditBusy(false);
    if (data.error) {
      setEditResult(`Error: ${data.error}`);
      return;
    }
    const saved = data.draft as Draft;
    setBundle((p) =>
      p ? { ...p, drafts: p.drafts.map((x) => (x.id === draftId ? saved : x)) } : p,
    );
    // Close the panel so the body below is the saved text, not a second copy.
    setEditing(null);
    setEditResult("Saved.");
  }

  async function doSend(draftId: number) {
    if (!sendForm) return;
    setSending(true);
    const res = await fetch(`/api/drafts/${draftId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...sendForm,
        fromName: sender.name,
        fromEmail: sender.email,
        replyTo: sender.replyTo,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.error) {
      setSendResult(`Error: ${data.error}`);
      return;
    }
    const r = data.result as { ok: boolean; provider: string; status: string; error: string | null };
    setSendResult(
      r.ok
        ? r.status === "dry_run"
          ? "Simulated send (dry-run). Set EMAIL_PROVIDER + EMAIL_API_KEY to send for real."
          : `Sent via ${r.provider}.`
        : `Failed: ${r.error}`,
    );
    if (r.ok) {
      setBundle((p) =>
        p
          ? {
              ...p,
              drafts: p.drafts.map((x) =>
                x.id === draftId ? { ...x, status: "approved" as const } : x,
              ),
            }
          : p,
      );
    }
  }

  async function logOutcome(kind: Outcome["kind"]) {
    setOutcomeBusy(true);
    const res = await fetch("/api/outcomes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: Number(id), kind }),
    });
    const data = await res.json();
    setOutcomeBusy(false);
    if (data.outcome) setOutcomes((p) => [data.outcome as Outcome, ...p]);
  }

  async function removeOutcome(outcomeId: number) {
    await fetch(`/api/outcomes?id=${outcomeId}`, { method: "DELETE" });
    setOutcomes((p) => p.filter((o) => o.id !== outcomeId));
  }

  /**
   * The "this is wrong" verdict: the server records the claim and removes the
   * signal, then hands back the recomputed bundle so the score drops here too.
   */
  async function rejectSignal(signalId: number) {
    setRejecting(signalId);
    setRejectNote("");
    const res = await fetch(`/api/signals/${signalId}/reject`, { method: "POST" });
    const data = await res.json();
    setRejecting(null);
    if (data.error) {
      setRejectNote(`Error: ${data.error}`);
      return;
    }
    if (data.bundle) setBundle(data.bundle as AccountBundle);
    if (data.correction) {
      setCorrections((p) => [data.correction as SignalCorrection, ...p]);
    }
    setRejectNote("Removed and recorded — the score above already excludes it.");
  }

  async function pushToChat() {
    setPushBusy(true);
    const res = await fetch("/api/integrations/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "account_card", accountId: Number(id) }),
    });
    const data = await res.json();
    setPushBusy(false);
    setPushResult(
      data.attempted === 0
        ? "No chat destinations configured yet."
        : `Delivered to ${data.delivered}/${data.attempted}.`,
    );
  }

  if (loading) return <Spinner label="Loading account…" />;
  if (!bundle) return <p className="text-sm text-slate-500">Account not found.</p>;

  const { account, signals, contacts, brief, drafts, score } = bundle;

  return (
    <div>
      <div className="mb-4">
        <Link href="/signals" className="text-xs font-medium text-slate-500 hover:text-slate-900">
          ← Back to signal feed
        </Link>
      </div>

      <PageHeader
        title={account.name}
        subtitle={`${account.sector} · ${account.employees.toLocaleString()} employees · ${account.location} · ${account.domain}`}
        actions={
          <>
            <StatusChip status={account.status} />
            {pushResult ? (
              <span className="text-xs text-slate-500">{pushResult}</span>
            ) : null}
            <button className="btn-ghost" disabled={pushBusy} onClick={pushToChat}>
              Push to chat
            </button>
            <button
              className="btn-ghost"
              disabled={busy === "status" || account.status === "approved"}
              onClick={() => patchAccount("approved")}
            >
              Approve
            </button>
            <button
              className="btn-danger"
              disabled={busy === "status" || account.status === "dismissed"}
              onClick={() => patchAccount("dismissed")}
            >
              Dismiss
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Account brief</h2>
              <div className="flex items-center gap-2">
                {brief ? (
                  <span className="text-[11px] text-slate-400">
                    {brief.generatedBy === "llm" ? "LLM" : "Template"} ·{" "}
                    {relativeDate(brief.createdAt)}
                  </span>
                ) : null}
                <button className="btn-primary" disabled={busy === "brief"} onClick={generateBrief}>
                  {brief ? "Regenerate" : "Generate brief"}
                </button>
              </div>
            </div>

            {!brief ? (
              <p className="text-sm text-slate-500">
                Generate a one-page brief: why now, likely pain, the matching case-study angle
                and who to contact.
              </p>
            ) : (
              <dl className="space-y-4">
                <Field label="Why now" value={brief.whyNow} />
                <Field label="Likely pain" value={brief.likelyPain} />
                <Field label="Case-study angle" value={brief.caseStudyAngle} />
                <Field label="Who to contact" value={brief.whoToContact} />
              </dl>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Outreach drafts</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-36">
                  <select
                    className="input"
                    value={tone}
                    onChange={(e) => setTone(e.target.value as Profile["tone"])}
                  >
                    <option value="concise">Concise</option>
                    <option value="consultative">Consultative</option>
                    <option value="direct">Direct</option>
                  </select>
                </div>
                <div className="w-32">
                  <select
                    className="input"
                    value={length}
                    onChange={(e) => setLength(e.target.value as Profile["length"])}
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </div>
                <button className="btn-primary" disabled={busy === "drafts"} onClick={generateDrafts}>
                  {drafts.length ? "Regenerate" : "Generate drafts"}
                </button>
              </div>
            </div>

            {drafts.length === 0 ? (
              <p className="text-sm text-slate-500">
                Generate an email, a LinkedIn message and a warm-intro suggestion. Copy them into
                your sequencer or CRM, or review and send the email directly.
              </p>
            ) : (
              <div className="space-y-4">
                {drafts.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {CHANNEL_LABEL[d.channel]}
                        </span>
                        <StatusChip status={d.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyButton text={d.subject ? `${d.subject}\n\n${d.body}` : d.body} />
                        <button className="btn-ghost" onClick={() => openEdit(d)}>
                          {editing === d.id ? "Editing" : "Edit"}
                        </button>
                        <button
                          className="btn-ghost"
                          disabled={reviewBusy === d.id}
                          onClick={() => runReview(d.id)}
                        >
                          {reviewBusy === d.id ? "Reviewing…" : "Review with agent"}
                        </button>
                        {d.channel === "email" ? (
                          <button className="btn-ghost" onClick={() => openSend(d)}>
                            Send email
                          </button>
                        ) : null}
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            setDraftStatus(d.id, d.status === "approved" ? "draft" : "approved")
                          }
                        >
                          {d.status === "approved" ? "Unapprove" : "Approve"}
                        </button>
                        <button
                          className="btn-danger"
                          onClick={() => setDraftStatus(d.id, "dismissed")}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    {editing === d.id ? (
                      <div className="mt-1 grid gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
                        {d.subject !== null ? (
                          <div>
                            <label className="label">Subject</label>
                            <input
                              className="input"
                              value={editForm.subject}
                              onChange={(e) =>
                                setEditForm({ ...editForm, subject: e.target.value })
                              }
                            />
                          </div>
                        ) : null}
                        <div>
                          <label className="label">Body</label>
                          <textarea
                            className="input h-64"
                            value={editForm.body}
                            onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="btn-primary"
                            disabled={editBusy}
                            onClick={() => saveEdit(d.id)}
                          >
                            {editBusy ? "Saving…" : "Save changes"}
                          </button>
                          <button className="btn-ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          {d.channel === "email" ? (
                            <button
                              className="btn-ghost"
                              disabled={editBusy}
                              onClick={() => {
                                // Send what is on screen, not what was saved: the
                                // person editing is usually about to send it.
                                const next = {
                                  subject: editForm.subject,
                                  body: editForm.body,
                                };
                                setSendResult("");
                                setEditing(null);
                                setSendOpen(d.id);
                                const dm =
                                  bundle?.contacts.find((c) => c.isDecisionMaker) ??
                                  bundle?.contacts[0];
                                setSendForm({ to: dm?.email ?? "", ...next });
                              }}
                            >
                              Save and send…
                            </button>
                          ) : null}
                          {editResult ? (
                            <span className="text-xs text-slate-600">{editResult}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <>
                        {d.subject ? (
                          <div className="mb-1 text-sm font-medium text-slate-800">{d.subject}</div>
                        ) : null}
                        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-600">
                          {d.body}
                        </pre>
                      </>
                    )}
                    {editResult && editing !== d.id ? (
                      <div className="mt-1 text-xs text-slate-500">{editResult}</div>
                    ) : null}

                    {reviews[d.id] ? (
                      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                          Agent review {reviews[d.id].generatedBy === "llm" ? "(LLM)" : "(checks)"}
                        </div>
                        {reviews[d.id].issues.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                            {reviews[d.id].issues.map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-slate-600">No issues found.</p>
                        )}
                        <p className="mt-2 text-xs text-slate-500">{reviews[d.id].rationale}</p>
                        <div className="mt-3 rounded-md bg-white p-3">
                          {reviews[d.id].revisedSubject ? (
                            <div className="mb-1 text-sm font-medium text-slate-800">
                              {reviews[d.id].revisedSubject}
                            </div>
                          ) : null}
                          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-600">
                            {reviews[d.id].revisedBody}
                          </pre>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button className="btn-primary" onClick={() => applyReview(d.id)}>
                            Apply correction
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setReviews((p) => {
                                const next = { ...p };
                                delete next[d.id];
                                return next;
                              })
                            }
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {sendOpen === d.id && sendForm ? (
                      <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Send this email
                        </div>
                        <div className="mt-2 grid gap-2">
                          <div>
                            <label className="label">To</label>
                            <input
                              className="input"
                              value={sendForm.to}
                              onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">From</label>
                            <input className="input bg-slate-100" value={sender.email} readOnly />
                          </div>
                          <div>
                            <label className="label">Subject</label>
                            <input
                              className="input"
                              value={sendForm.subject}
                              onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">Body</label>
                            <textarea
                              className="input h-40"
                              value={sendForm.body}
                              onChange={(e) => setSendForm({ ...sendForm, body: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            className="btn-primary"
                            disabled={sending}
                            onClick={() => doSend(d.id)}
                          >
                            {sending ? "Sending…" : "Send email"}
                          </button>
                          <button className="btn-ghost" onClick={() => setSendOpen(null)}>
                            Close
                          </button>
                          {sendResult ? (
                            <span className="text-xs text-slate-600">{sendResult}</span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          With no email provider configured this send is simulated (dry-run).
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Signals</h2>
              {score ? <ScoreBadge score={score.score} tier={score.tier} /> : null}
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Every signal, with the evidence it was read from and where it came from. If one is
              wrong, say so — it is removed from the score and kept as a correction.
            </p>
            {score ? (
              <div className="mb-4 rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Why this ranks {score.score}
                </div>
                {score.fit.summary ? (
                  <div className="mt-1 text-xs text-slate-600">{score.fit.summary}</div>
                ) : null}
                <ul className="mt-2 space-y-0.5">
                  {score.contributions.map((c) => (
                    <li key={c.type} className="flex justify-between text-[11px] text-slate-600">
                      <span>{c.label}</span>
                      <span className="text-slate-400">+{c.points}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-slate-100 pt-1 text-[11px] text-slate-600">
                    <span>Fit with your market</span>
                    <span className="text-slate-400">+{score.fitPoints}</span>
                  </li>
                </ul>
                {score.penalties.length ? (
                  <ul className="mt-2 space-y-0.5">
                    {score.penalties.map((p) => (
                      <li key={p} className="text-[11px] text-amber-700">
                        − {p}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {signals.length === 0 ? (
              <p className="text-sm text-slate-500">No signals on file for this account.</p>
            ) : null}
            <ul className="space-y-3">
              {signals.map((s) => {
                const ev = parseEvidence(s.evidence);
                return (
                  <li key={s.id} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SignalChip type={s.type} />
                        <span className="text-xs text-slate-400">
                          event {freshness(s)} · detected {detectedAgo(s)}
                        </span>
                      </div>
                      <button
                        className="btn-ghost"
                        disabled={rejecting === s.id}
                        onClick={() => rejectSignal(s.id)}
                      >
                        {rejecting === s.id ? "Removing…" : "This is wrong"}
                      </button>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{s.summary}</div>

                    <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Raw evidence
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{ev.text}</p>
                    </div>

                    <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                      <div>
                        Source: <span className="text-slate-500">{s.source}</span>
                        {s.sourceUrl ? (
                          <>
                            {" · "}
                            <a
                              className="underline"
                              href={s.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {s.sourceUrl}
                            </a>
                          </>
                        ) : (
                          " · no source URL"
                        )}
                      </div>
                      <div>
                        Event {new Date(s.eventAt).toLocaleDateString()} · detected{" "}
                        {new Date(s.detectedAt).toLocaleString()}
                      </div>
                      <div>
                        Evidence strength {s.strength}
                        {ev.classifiedBy
                          ? ` · classified by ${ev.classifiedBy === "llm" ? "LLM" : "rules"}`
                          : ""}
                      </div>
                      {ev.matches.length ? (
                        <div>Matched: {ev.matches.join(", ")}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {rejectNote ? <p className="mt-3 text-xs text-slate-600">{rejectNote}</p> : null}
          </Card>

          {corrections.length ? (
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-slate-900">Rejected signals</h2>
              <p className="mb-3 text-xs text-slate-500">
                Signals marked as wrong. They no longer count towards the score — the evidence is
                kept so you can see what the engine got wrong.
              </p>
              <ul className="space-y-2">
                {corrections.map((c) => (
                  <li key={c.id} className="rounded-lg border border-rose-200 bg-rose-50/50 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <SignalChip type={c.type} />
                      <span className="text-[11px] text-slate-400">
                        rejected {relativeDate(c.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-700">{c.summary}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {c.source}
                      {c.reason ? ` · ${c.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Contacts</h2>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">
                No contacts on file. Connect a licensed contact-data provider to enrich this account.
              </p>
            ) : (
              <ul className="space-y-3">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-800">
                        {c.name}
                        {c.isDecisionMaker ? (
                          <span className="ml-2 badge bg-violet-100 text-violet-800">
                            decision-maker
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">{c.title}</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-600">{c.email}</div>
                      <div className="text-[11px] text-slate-400">
                        {c.emailStatus} · {c.provider}
                      </div>
                    </div>
                    <CopyButton text={c.email} label="Copy email" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Results</h2>
            <p className="mb-3 text-[11px] text-slate-500">
              What came of this account. Logging outcomes is what turns the feed into a measured
              meeting rate.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost"
                disabled={outcomeBusy}
                onClick={() => logOutcome("reply")}
              >
                Replied
              </button>
              <button
                className="btn-primary"
                disabled={outcomeBusy}
                onClick={() => logOutcome("meeting")}
              >
                Meeting booked
              </button>
              <button
                className="btn-ghost"
                disabled={outcomeBusy}
                onClick={() => logOutcome("won")}
              >
                Won
              </button>
              <button
                className="btn-ghost"
                disabled={outcomeBusy}
                onClick={() => logOutcome("no_response")}
              >
                No response
              </button>
            </div>
            {outcomes.length ? (
              <ul className="mt-4 space-y-2">
                {outcomes.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <StatusChip
                        status={
                          o.kind === "won"
                            ? "approved"
                            : o.kind === "no_response"
                              ? "dismissed"
                              : "draft"
                        }
                      />
                      <span className="font-medium text-slate-800">{OUTCOME_LABEL[o.kind]}</span>
                      <span className="text-xs text-slate-400">
                        {relativeDate(o.occurredAt)}
                      </span>
                    </span>
                    <button
                      className="text-xs text-slate-400 hover:text-rose-600"
                      onClick={() => removeOutcome(o.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No outcomes logged yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-slate-700">{value}</dd>
    </div>
  );
}
