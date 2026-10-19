import { chatJSON, llmEnabled } from "./llm";
import type { Account, Brief, Contact, Draft, Profile, Signal, Vocabulary } from "./types";
import { signalDefinition } from "./signals";

// The review agent sits between generation and sending: it checks a draft
// against the lead and the consultancy's voice, lists concrete problems, and
// returns a corrected version. It never sends on its own — a human approves.

export interface DraftReview {
  issues: string[];
  revisedSubject: string | null;
  revisedBody: string;
  rationale: string;
  generatedBy: "llm" | "template";
}

const SPAM_WORDS = [
  "guarantee",
  "guaranteed",
  "risk-free",
  "act now",
  "limited time",
  "click here",
  "free consultation",
  "best-in-class",
  "world-class",
  "synergy",
  "cutting-edge",
  "revolutionary",
  "game-changing",
];

const PLACEHOLDER = /\{\{[^}]+\}\}|\[(name|company|first name|title)\]/i;

export async function reviewDraft(
  profile: Profile,
  account: Account,
  signals: Signal[],
  brief: Brief | null,
  draft: Draft,
  contacts: Contact[],
  vocabulary: Vocabulary = [],
): Promise<DraftReview> {
  if (llmEnabled()) {
    const dm = contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
    const fromLlm = await chatJSON<{
      issues: string[];
      revisedSubject: string;
      revisedBody: string;
      rationale: string;
    }>(
      "You are a meticulous B2B outreach editor. You review a drafted message against the " +
        "recipient, the buying signals and the sender's voice. You are terse and concrete, " +
        "you never invent facts, and you preserve the original intent and length. Output JSON only.",
      `Review this ${draft.channel} draft before it is sent.

Sender: ${profile.companyName} (${profile.headcount} people). Tone: ${profile.tone}. Length: ${profile.length}.
Recipient: ${dm ? `${dm.name}, ${dm.title}` : "unknown"} at ${account.name} (${account.sector}, ${account.employees} employees, ${account.location}).
Signals:
${signals.map((s) => `- ${signalDefinition(s.type, vocabulary).label}: ${s.summary}`).join("\n")}
${brief ? `Brief why-now: ${brief.whyNow}` : ""}

Subject: ${draft.subject ?? "(none)"}
Body:
${draft.body}

Return JSON with keys:
"issues" (array of short, specific problems; empty if none),
"revisedSubject" (corrected subject, or reproduce the original),
"revisedBody" (the corrected body — only change what the issues describe),
"rationale" (one sentence on the main change).`,
    );
    if (fromLlm && fromLlm.revisedBody) {
      return {
        issues: Array.isArray(fromLlm.issues) ? fromLlm.issues : [],
        revisedSubject: fromLlm.revisedSubject ?? draft.subject,
        revisedBody: fromLlm.revisedBody,
        rationale: fromLlm.rationale ?? "",
        generatedBy: "llm",
      };
    }
  }
  return templateReview(profile, account, draft, contacts);
}

/** Deterministic checks and safe corrections, used with no LLM configured. */
export function templateReview(
  profile: Profile,
  account: Account,
  draft: Draft,
  contacts: Contact[],
): DraftReview {
  const issues: string[] = [];
  const dm = contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
  const first = dm?.name.split(" ")[0];

  let body = draft.body;
  let subject = draft.subject;

  if (PLACEHOLDER.test(body) || (subject && PLACEHOLDER.test(subject))) {
    issues.push("Contains an unfilled placeholder — replace it with a real detail.");
    body = body
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/\[(name|company|first name|title)\]/gi, account.name);
  }

  const words = body.trim().split(/\s+/).length;
  const target = profile.length === "short" ? 60 : profile.length === "long" ? 180 : 120;
  if (words > target + 40) {
    issues.push(`Too long for a first touch (${words} words vs ~${target}). Cut the middle.`);
  }
  if (words < 30) {
    issues.push(`Too short to be useful (${words} words) — add one concrete detail.`);
  }

  if (!body.includes("?")) {
    issues.push("No clear ask — end with one low-friction question.");
    body = `${body.trimEnd()}\n\nWorth a short call next week?`;
  }

  const found = SPAM_WORDS.filter((w) => body.toLowerCase().includes(w));
  if (found.length) {
    issues.push(`Spam-trigger phrasing: ${found.join(", ")}. Removed.`);
    for (const w of found) {
      body = body.replace(new RegExp(w, "gi"), "");
    }
    body = body.replace(/[ \t]{2,}/g, " ").replace(/ ,/g, ",");
  }

  if ((body.match(/!/g) ?? []).length > 1) {
    issues.push("Too many exclamation marks — it reads like a blast.");
    body = body.replace(/!/g, ".");
  }

  if (first) {
    const greetingOk = new RegExp(`\\b${first}\\b`, "i").test(body);
    if (!greetingOk) {
      issues.push(`Does not name the recipient (${first}) — personalise the greeting.`);
      body = `Hi ${first},\n\n${body.trimStart()}`;
    }
  }

  if (subject) {
    if (subject.length > 60) {
      issues.push(`Subject is ${subject.length} characters — keep it under 60.`);
      subject = subject.slice(0, 57).trimEnd() + "…";
    }
    if (/[A-Z]{4,}/.test(subject)) {
      issues.push("Subject has shouting capitals — soften it.");
      subject = subject.replace(/\b[A-Z]{4,}\b/g, (m) => m[0] + m.slice(1).toLowerCase());
    }
  }

  if (profile.tone === "concise" && words > 90) {
    issues.push("Tone is set to concise but the draft runs long.");
  }

  return {
    issues,
    revisedSubject: subject,
    revisedBody: body.replace(/\n{3,}/g, "\n\n").trim(),
    rationale: issues.length
      ? `Applied ${issues.length} correction${issues.length === 1 ? "" : "s"}; intent and personalisation preserved.`
      : "No issues found — the draft is clean and ready to review.",
    generatedBy: "template",
  };
}
