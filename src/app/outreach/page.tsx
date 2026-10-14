"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CopyButton, Empty, PageHeader, Spinner, StatusChip } from "@/components/ui";
import type { Draft } from "@/lib/types";

type DraftRow = Draft & { accountName: string; accountDomain: string };

const CHANNEL_LABEL: Record<Draft["channel"], string> = {
  email: "Email",
  linkedin: "LinkedIn",
  warm_intro: "Warm intro",
};

export default function OutreachPage() {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | "draft" | "approved" | "dismissed">("all");

  useEffect(() => {
    fetch("/api/drafts")
      .then((r) => r.json())
      .then((d) => setDrafts(d.drafts));
  }, []);

  async function setStatus(id: number, status: Draft["status"]) {
    await fetch(`/api/drafts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setDrafts((p) => (p ? p.map((d) => (d.id === id ? { ...d, status } : d)) : p));
  }

  const filtered = useMemo(
    () => (drafts ? drafts.filter((d) => (filter === "all" ? true : d.status === filter)) : null),
    [drafts, filter],
  );

  const approvedCount = drafts?.filter((d) => d.status === "approved").length ?? 0;

  return (
    <div>
      <PageHeader
        title="Outreach"
        subtitle="Review every draft in one place. Approve what you will use, then export it to your sequencer."
        actions={
          <Link href="/export" className="btn-primary">
            Export approved
          </Link>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-4 p-4">
        <div>
          <label className="label">Show</label>
          <div className="w-40">
            <select
              className="input"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">All drafts</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>
        <div className="ml-auto text-xs text-slate-500">
          {drafts ? `${drafts.length} drafts · ${approvedCount} approved` : ""}
        </div>
      </Card>

      {!filtered ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Empty
          title="No drafts here yet"
          hint="Open an account from the signal feed and generate drafts."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/accounts/${d.accountId}`}
                    className="text-sm font-semibold text-slate-900 hover:underline"
                  >
                    {d.accountName}
                  </Link>
                  <span className="badge bg-slate-100 text-slate-600">
                    {CHANNEL_LABEL[d.channel]}
                  </span>
                  <StatusChip status={d.status} />
                </div>
              </div>
              {d.subject ? (
                <div className="mb-1 text-sm font-medium text-slate-800">{d.subject}</div>
              ) : null}
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-sans text-sm text-slate-600">
                {d.body}
              </pre>
              <div className="mt-3 flex items-center gap-2">
                <CopyButton text={d.subject ? `${d.subject}\n\n${d.body}` : d.body} />
                <button
                  className="btn-ghost"
                  onClick={() => setStatus(d.id, d.status === "approved" ? "draft" : "approved")}
                >
                  {d.status === "approved" ? "Unapprove" : "Approve"}
                </button>
                <button className="btn-danger" onClick={() => setStatus(d.id, "dismissed")}>
                  Dismiss
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
