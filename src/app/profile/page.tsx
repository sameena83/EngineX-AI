"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { NicheEditor } from "@/components/NicheEditor";
import type { CaseStudy, Profile, ServiceLine } from "@/lib/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => setProfile(d.profile));
  }, []);

  if (!profile) return <Spinner label="Loading profile…" />;

  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setStatus("idle");
  };

  const updateService = (id: string, patch: Partial<ServiceLine>) =>
    update(
      "services",
      profile.services.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const updateCase = (id: string, patch: Partial<CaseStudy>) =>
    update(
      "caseStudies",
      profile.caseStudies.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );

  async function save() {
    if (!profile) return;
    setStatus("saving");
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setStatus("saved");
  }

  return (
    <div>
      <PageHeader
        title="Service profile"
        subtitle="Describe your services, ideal client and case studies once, and set the niche those services belong to. Signals, briefs and drafts are generated against this profile."
        actions={
          <button className="btn-primary" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save profile"}
          </button>
        }
      />

      {/* The niche comes first: it decides which signals exist at all, so it is
          the most consequential thing on this page. */}
      <div className="mb-6">
        <NicheEditor profile={profile} onProfile={setProfile} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Consultancy</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={profile.companyName}
                onChange={(e) => update("companyName", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Website</label>
              <input
                className="input"
                value={profile.website}
                onChange={(e) => update("website", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Headcount</label>
              <input
                className="input"
                value={profile.headcount}
                onChange={(e) => update("headcount", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Region</label>
              <input
                className="input"
                value={profile.region}
                onChange={(e) => update("region", e.target.value)}
              />
            </div>
          </div>

          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Outreach style
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Tone</label>
              <select
                className="input"
                value={profile.tone}
                onChange={(e) => update("tone", e.target.value as Profile["tone"])}
              >
                <option value="concise">Concise</option>
                <option value="consultative">Consultative</option>
                <option value="direct">Direct</option>
              </select>
            </div>
            <div>
              <label className="label">Length</label>
              <select
                className="input"
                value={profile.length}
                onChange={(e) => update("length", e.target.value as Profile["length"])}
              >
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={profile.digestIncludesContacts}
              onChange={(e) => update("digestIncludesContacts", e.target.checked)}
            />
            Include contact details in chat digests (otherwise company-level only)
          </label>

          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sender identity
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Used when sending a draft directly. EngineX does not send by default.
          </p>
          <div className="grid gap-4">
            <div>
              <label className="label">From name</label>
              <input
                className="input"
                value={profile.sender.name}
                onChange={(e) => update("sender", { ...profile.sender, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">From email</label>
              <input
                className="input"
                value={profile.sender.email}
                onChange={(e) => update("sender", { ...profile.sender, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Reply-to</label>
              <input
                className="input"
                value={profile.sender.replyTo}
                onChange={(e) => update("sender", { ...profile.sender, replyTo: e.target.value })}
              />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Ideal client</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Sector</label>
              <input
                className="input"
                value={profile.idealClient.sector}
                onChange={(e) =>
                  update("idealClient", { ...profile.idealClient, sector: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">Min employees</label>
              <input
                type="number"
                className="input"
                value={profile.idealClient.sizeMin}
                onChange={(e) =>
                  update("idealClient", {
                    ...profile.idealClient,
                    sizeMin: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="label">Max employees</label>
              <input
                type="number"
                className="input"
                value={profile.idealClient.sizeMax}
                onChange={(e) =>
                  update("idealClient", {
                    ...profile.idealClient,
                    sizeMax: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Region</label>
              <input
                className="input"
                value={profile.idealClient.region}
                onChange={(e) =>
                  update("idealClient", { ...profile.idealClient, region: e.target.value })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea
                className="input h-24"
                value={profile.idealClient.description}
                onChange={(e) =>
                  update("idealClient", { ...profile.idealClient, description: e.target.value })
                }
              />
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Service lines</h2>
            <button
              className="btn-ghost"
              onClick={() =>
                update("services", [
                  ...profile.services,
                  { id: `svc-${Date.now()}`, name: "New service", description: "" },
                ])
              }
            >
              + Add service
            </button>
          </div>
          <div className="space-y-4">
            {profile.services.map((s) => (
              <div key={s.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_2fr_auto]">
                <input
                  className="input"
                  value={s.name}
                  onChange={(e) => updateService(s.id, { name: e.target.value })}
                />
                <input
                  className="input"
                  value={s.description}
                  onChange={(e) => updateService(s.id, { description: e.target.value })}
                />
                <button
                  className="btn-danger"
                  onClick={() =>
                    update(
                      "services",
                      profile.services.filter((x) => x.id !== s.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Case studies</h2>
            <button
              className="btn-ghost"
              onClick={() =>
                update("caseStudies", [
                  ...profile.caseStudies,
                  {
                    id: `cs-${Date.now()}`,
                    client: "New client",
                    sector: "",
                    problem: "",
                    outcome: "",
                    serviceLineId: profile.services[0]?.id ?? "",
                  },
                ])
              }
            >
              + Add case study
            </button>
          </div>
          <div className="space-y-4">
            {profile.caseStudies.map((c) => (
              <div key={c.id} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label">Client</label>
                    <input
                      className="input"
                      value={c.client}
                      onChange={(e) => updateCase(c.id, { client: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Sector</label>
                    <input
                      className="input"
                      value={c.sector}
                      onChange={(e) => updateCase(c.id, { sector: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Service line</label>
                    <select
                      className="input"
                      value={c.serviceLineId}
                      onChange={(e) => updateCase(c.id, { serviceLineId: e.target.value })}
                    >
                      {profile.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Problem</label>
                  <textarea
                    className="input h-16"
                    value={c.problem}
                    onChange={(e) => updateCase(c.id, { problem: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Outcome</label>
                  <textarea
                    className="input h-16"
                    value={c.outcome}
                    onChange={(e) => updateCase(c.id, { outcome: e.target.value })}
                  />
                </div>
                <button
                  className="btn-danger"
                  onClick={() =>
                    update(
                      "caseStudies",
                      profile.caseStudies.filter((x) => x.id !== c.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
