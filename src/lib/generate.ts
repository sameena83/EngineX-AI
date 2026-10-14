import { chatJSON } from "./llm";
import { signalDefinition } from "./signals";
import type { Account, Brief, Contact, Draft, Profile, Signal } from "./types";

type Generated = "llm" | "template";

const BRIEF_SYSTEM =
  "You are a B2B research analyst for a boutique data & AI consultancy. " +
  "You write short, specific, factual account briefs for a partner who will act in minutes. " +
  "Never invent facts beyond the signals provided. Output only valid JSON.";

const DRAFT_SYSTEM =
  "You are a careful B2B outreach writer for a boutique data & AI consultancy. " +
  "Write low-volume, personalised, non-spammy messages. " +
  "Reference only the supplied signals and case studies. Output only valid JSON.";

/** Lowercase only the first character, preserving proper nouns like Snowflake. */
function decap(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function signalLines(signals: Signal[]): string {
  return signals
    .map((s) => {
      const d = signalDefinition(s.type);
      return `- [${d.label}] ${s.summary}. Evidence: ${s.evidence} (source: ${s.source}, detected ${s.detectedAt.slice(0, 10)}, strength ${s.strength.toFixed(2)})`;
    })
    .join("\n");
}

function profileLines(profile: Profile, contacts: Contact[]): string {
  return [
    `Consultancy: ${profile.companyName} (${profile.headcount} people, ${profile.region}).`,
    `Services: ${profile.services.map((s) => s.name).join("; ")}.`,
    `Ideal client: ${profile.idealClient.description}`,
    `Case studies:\n${profile.caseStudies
      .map((c) => `  - ${c.sector}: ${c.problem} -> ${c.outcome}`)
      .join("\n")}`,
    contacts.length
      ? `Known contacts:\n${contacts
          .map((c) => `  - ${c.name}, ${c.title}${c.isDecisionMaker ? " (decision-maker)" : ""}`)
          .join("\n")}`
      : "Known contacts: none.",
  ].join("\n");
}

/* ------------------------------- briefs --------------------------------- */

export async function generateBrief(
  profile: Profile,
  account: Account,
  signals: Signal[],
  contacts: Contact[],
): Promise<Omit<Brief, "id" | "accountId" | "createdAt">> {
  const fromLlm = await chatJSON<{
    whyNow: string;
    likelyPain: string;
    caseStudyAngle: string;
    whoToContact: string;
  }>(
    BRIEF_SYSTEM,
    `Write a one-page account brief.

${profileLines(profile, contacts)}

Account: ${account.name} (${account.sector}, ${account.employees} employees, ${account.location}).
Description: ${account.description}

Signals:
${signalLines(signals)}

Return JSON with keys:
"whyNow" (2-3 sentences: why this account needs us this month, grounded in the signals),
"likelyPain" (2-3 sentences: the concrete pain the signals imply),
"caseStudyAngle" (1-2 sentences: which of our case studies to lead with and why),
"whoToContact" (1-2 sentences: the role(s) to approach first and the hook).`,
  );

  if (fromLlm && fromLlm.whyNow && fromLlm.likelyPain) {
    return { ...fromLlm, generatedBy: "llm" as Generated };
  }
  return { ...templateBrief(profile, account, signals, contacts), generatedBy: "template" as Generated };
}

function templateBrief(
  profile: Profile,
  account: Account,
  signals: Signal[],
  contacts: Contact[],
): Omit<Brief, "id" | "accountId" | "createdAt" | "generatedBy"> {
  const primary = pickPrimary(signals);
  const def = primary ? signalDefinition(primary.type) : null;

  const whyNow = primary
    ? `${account.name} is showing a live need right now: ${primary.summary}. ${
        def ? def.why : ""
      } Detected ${primary.detectedAt.slice(0, 10)} from ${primary.source}.`.trim()
    : `${account.name} matches the ideal client profile but no fresh signal is recorded yet.`;

  const likelyPain =
    primary?.type === "new_data_leader"
      ? `A new data leader usually inherits fragmented platforms, unclear ownership and impatient stakeholders. Expect pressure to show a credible plan and early wins within the first quarter, with too small a team to deliver it alone.`
      : primary?.type === "data_hiring_no_leadership"
        ? `The company is investing in data skills without senior data leadership to direct them. That typically means duplicated effort, platform decisions made ad hoc, and no clear roadmap the new hires can execute against.`
        : primary?.type === "public_rfp"
          ? `A live tender signals a funded, time-boxed programme with an internal owner and an approved budget. The pain is a deadline combined with limited internal delivery capacity.`
          : primary?.type === "funding_ma"
            ? `New capital or an acquisition creates immediate integration and reporting pressure that the existing team cannot absorb while running the business.`
            : `Emerging platform work without the internal experience to sequence it usually stalls at the first hard migration or governance decision.`;

  const matchedCase =
    profile.caseStudies.find(
      (c) =>
        c.sector.toLowerCase() === account.sector.toLowerCase() ||
        (primary?.type === "data_hiring_no_leadership" &&
          c.serviceLineId === "svc-platform") ||
        (primary?.type === "new_data_leader" && c.serviceLineId === "svc-governance"),
    ) ?? profile.caseStudies[0];

  const caseStudyAngle = matchedCase
    ? `Lead with the ${matchedCase.sector.toLowerCase()} engagement — ${decap(matchedCase.problem)} Outcome: ${matchedCase.outcome}`
    : `Lead with our closest platform engagement and the measurable reporting improvement we delivered.`;

  const dm = contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
  const whoToContact = dm
    ? `Approach ${dm.name} (${dm.title}) first — ${
        primary ? `open on the "${primary.summary}" signal` : "open on their data roadmap"
      } and keep the ask to a short working session, not a pitch.`
    : `Identify the data or operations leader before outreach; no decision-maker is on file yet.`;

  return { whyNow, likelyPain, caseStudyAngle, whoToContact };
}

function pickPrimary(signals: Signal[]): Signal | null {
  return (
    [...signals].sort((a, b) => {
      const wa = signalDefinition(a.type).weight * a.strength;
      const wb = signalDefinition(b.type).weight * b.strength;
      if (wb !== wa) return wb - wa;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    })[0] ?? null
  );
}

/* ------------------------------- drafts --------------------------------- */

function lengthGuidance(length: Profile["length"]): string {
  return length === "short"
    ? "3-5 sentences maximum"
    : length === "long"
      ? "about 150 words"
      : "about 90 words";
}

export async function generateDrafts(
  profile: Profile,
  account: Account,
  signals: Signal[],
  brief: Omit<Brief, "id" | "accountId" | "createdAt"> | null,
  contacts: Contact[],
): Promise<Omit<Draft, "id" | "accountId" | "createdAt">[]> {
  const dm = contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
  const fromLlm = await chatJSON<{
    emailSubject: string;
    emailBody: string;
    linkedinMessage: string;
    warmIntro: string;
  }>(
    DRAFT_SYSTEM,
    `Write outreach for one account.

${profileLines(profile, contacts)}

Account: ${account.name} (${account.sector}, ${account.employees} employees, ${account.location}).
Signals:
${signalLines(signals)}
${brief ? `Brief we just wrote — why now: ${brief.whyNow} Pain: ${brief.likelyPain} Angle: ${brief.caseStudyAngle}` : ""}

Tone: ${profile.tone}. Email length: ${lengthGuidance(profile.length)}.
Address the email to ${dm ? `${dm.name} (${dm.title})` : "the data or operations leader"}.

Return JSON with keys:
"emailSubject" (lowercase, specific, no hype),
"emailBody" (plain text, no markdown, one clear low-friction ask),
"linkedinMessage" (max 60 words, no email pitch, reference the signal),
"warmIntro" (a short note asking a mutual connection to introduce us, or "" if none is plausible).`,
  );

  if (fromLlm && fromLlm.emailBody) {
    return [
      {
        channel: "email",
        subject: fromLlm.emailSubject || templateSubject(account, signals),
        body: fromLlm.emailBody,
        tone: profile.tone,
        length: profile.length,
        status: "draft",
        generatedBy: "llm",
      },
      {
        channel: "linkedin",
        subject: null,
        body: fromLlm.linkedinMessage || templateLinkedIn(account, signals),
        tone: profile.tone,
        length: "short",
        status: "draft",
        generatedBy: "llm",
      },
      ...(fromLlm.warmIntro
        ? [
            {
              channel: "warm_intro" as const,
              subject: null,
              body: fromLlm.warmIntro,
              tone: profile.tone,
              length: "short",
              status: "draft" as const,
              generatedBy: "llm" as const,
            },
          ]
        : []),
    ];
  }

  return templateDrafts(profile, account, signals, dm);
}

function templateLinkedIn(account: Account, signals: Signal[]): string {
  const primary = pickPrimary(signals);
  return (
    `Hi — a signal at ${account.name} caught my eye: ${
      primary ? primary.summary : "an investment in data"
    }. ` +
    `We help ${account.sector.toLowerCase()} teams get a platform and reporting layer live in weeks, not quarters. ` +
    `Open to a brief chat?`
  );
}

function templateSubject(account: Account, signals: Signal[]): string {
  const primary = pickPrimary(signals);
  if (primary?.type === "new_data_leader")
    return `congrats on the new data role at ${account.name}`;
  if (primary?.type === "public_rfp")
    return `${account.name} data programme — partner support`;
  if (primary?.type === "data_hiring_no_leadership")
    return `a thought on ${account.name}'s data hiring`;
  if (primary?.type === "funding_ma")
    return `data integration after ${account.name}'s latest move`;
  return `a quick idea for ${account.name}'s data platform`;
}

function templateDrafts(
  profile: Profile,
  account: Account,
  signals: Signal[],
  dm: Contact | undefined,
): Omit<Draft, "id" | "accountId" | "createdAt">[] {
  const primary = pickPrimary(signals);
  const def = primary ? signalDefinition(primary.type) : null;
  const matched =
    profile.caseStudies.find((c) => c.sector.toLowerCase() === account.sector.toLowerCase()) ??
    profile.caseStudies[0];
  const greeting = dm ? `Hi ${dm.name.split(" ")[0]},` : "Hi,";
  const opening = primary
    ? `One signal I picked up on ${account.name}: ${primary.summary}.`
    : `I've been following ${account.name}'s data work.`;
  const hc = profile.headcount.trim();
  const article = /^[aeiou]/i.test(hc) || /^(8|11|18)/.test(hc) ? "an" : "a";

  const emailBody = [
    greeting,
    "",
    opening,
    "",
    def
      ? `Why that matters: ${def.why}`
      : `Why that matters: it usually points to a platform and reporting push.`,
    matched
      ? `We're ${article} ${profile.headcount}-person ${profile.services[0]?.name.toLowerCase()} team. For a ${matched.sector.toLowerCase()} client in a similar spot: ${matched.outcome}`
      : `We're ${article} ${profile.headcount}-person ${profile.services[0]?.name.toLowerCase()} team focused on exactly this kind of work.`,
    "",
    profile.tone === "direct"
      ? `Worth a 20-minute call next week to see if it's relevant?`
      : `If it's useful, I'm happy to share how we'd sequence the first 90 days — no pitch, just a short working session.`,
    "",
    `— ${profile.companyName}`,
  ].join("\n");

  const linkedinBody =
    `Hi ${dm ? dm.name.split(" ")[0] : "there"} — a signal at ${account.name} caught my eye: ${
      primary ? primary.summary : "an investment in data"
    }. ` +
    `We help ${account.sector.toLowerCase()} teams get a platform and reporting layer live in weeks, not quarters. ` +
    `Open to a brief chat?`;

  const drafts: Omit<Draft, "id" | "accountId" | "createdAt">[] = [
    {
      channel: "email",
      subject: templateSubject(account, signals),
      body: emailBody,
      tone: profile.tone,
      length: profile.length,
      status: "draft",
      generatedBy: "template",
    },
    {
      channel: "linkedin",
      subject: null,
      body: linkedinBody,
      tone: profile.tone,
      length: "short",
      status: "draft",
      generatedBy: "template",
    },
    {
      channel: "warm_intro",
      subject: null,
      body: `Ask a mutual connection (investor, platform partner or former colleague) for a short introduction to ${
        dm ? `${dm.name} (${dm.title})` : "the data leader"
      } at ${account.name}. Suggested line: "You both care about getting data foundations right — worth comparing notes for 20 minutes."`,
      tone: profile.tone,
      length: "short",
      status: "draft",
      generatedBy: "template",
    },
  ];
  return drafts;
}
