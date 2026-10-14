import type { AccountBundle } from "./types";

// CSV export shaped for sequencer import: the report specifies AI_Subject and
// AI_Body columns so contacts can be pushed to Instantly / Smartlead / Lemlist.

function esc(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  "Company",
  "Domain",
  "Sector",
  "Employees",
  "Location",
  "Signal_Score",
  "Top_Signal",
  "Contact_Name",
  "Contact_Title",
  "Contact_Email",
  "Email_Status",
  "Why_Now",
  "AI_Subject",
  "AI_Body",
  "LinkedIn_Message",
  "Warm_Intro",
] as const;

export function bundlesToCsv(bundles: AccountBundle[]): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];

  for (const b of bundles) {
    const email = b.drafts.find((d) => d.channel === "email");
    const linkedin = b.drafts.find((d) => d.channel === "linkedin");
    const warm = b.drafts.find((d) => d.channel === "warm_intro");
    const contacts = b.contacts.length ? b.contacts : [null];

    for (const c of contacts) {
      rows.push(
        [
          b.account.name,
          b.account.domain,
          b.account.sector,
          b.account.employees,
          b.account.location,
          b.score?.score ?? "",
          b.signals[0]?.summary ?? "",
          c?.name ?? "",
          c?.title ?? "",
          c?.email ?? "",
          c?.emailStatus ?? "",
          b.brief?.whyNow ?? "",
          email?.subject ?? "",
          email?.body ?? "",
          linkedin?.body ?? "",
          warm?.body ?? "",
        ]
          .map(esc)
          .join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}
