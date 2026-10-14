"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { CSV_COLUMNS } from "@/lib/csv";
import type { ScoredAccount } from "@/lib/types";

export default function ExportPage() {
  const [feed, setFeed] = useState<ScoredAccount[] | null>(null);
  const [mode, setMode] = useState<"approved" | "all" | "selected">("approved");
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<string>("");
  const [rows, setRows] = useState(0);

  useEffect(() => {
    fetch("/api/feed")
      .then((r) => r.json())
      .then((d) => setFeed(d.feed));
  }, []);

  const query = useMemo(() => {
    if (mode === "approved") return "?status=approved";
    if (mode === "selected") return `?ids=${selected.join(",")}`;
    return "";
  }, [mode, selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode === "selected" && selected.length === 0) {
        if (!cancelled) {
          setPreview("");
          setRows(0);
        }
        return;
      }
      const res = await fetch(`/api/export${query}`);
      const count = Number(res.headers.get("X-Row-Count") ?? 0);
      const text = await res.text();
      if (!cancelled) {
        setPreview(text);
        setRows(count);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, mode, selected]);

  function toggle(id: number) {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const canDownload = mode !== "selected" || selected.length > 0;

  return (
    <div>
      <PageHeader
        title="Export"
        subtitle="Hand accounts to where partners already work. The CSV carries AI_Subject and AI_Body columns for sequencer import."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">What to export</h2>
          <div className="space-y-3">
            {(
              [
                ["approved", "Approved accounts", "Accounts you approved in the feed"],
                ["all", "All accounts", "Every account with its drafts"],
                ["selected", "Selected accounts", "Pick accounts below"],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  className="mt-1"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === "selected" ? (
            <div className="mt-4 max-h-64 space-y-1 overflow-auto">
              {!feed ? (
                <Spinner />
              ) : (
                feed.map((s) => (
                  <label
                    key={s.account.id}
                    className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(s.account.id)}
                      onChange={() => toggle(s.account.id)}
                    />
                    <span className="truncate">{s.account.name}</span>
                  </label>
                ))
              )}
            </div>
          ) : null}

          <a
            href={`/api/export${query}`}
            className={`mt-5 w-full ${canDownload ? "btn-primary" : "btn-primary opacity-50 pointer-events-none"}`}
            download
          >
            Download CSV
          </a>
          <p className="mt-2 text-[11px] text-slate-500">
            {mode === "selected"
              ? selected.length
                ? `${selected.length} accounts selected`
                : "Select at least one account"
              : "Includes briefs, contacts and drafts"}
          </p>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Columns
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {CSV_COLUMNS.map((c) => (
                <span key={c} className="badge bg-slate-100 text-slate-600">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
            <span className="text-xs text-slate-500">
              {rows ? `${rows} rows` : "no rows"}
            </span>
          </div>
          {preview ? (
            <pre className="max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
              {preview}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              Nothing to export yet. Approve accounts in the signal feed, then generate briefs and
              drafts.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
