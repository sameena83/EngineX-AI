import { chatJSON } from "./llm";
import { signalDefinition } from "./signals";
import type { Account, Brief, Contact, Draft, Profile, Signal, Vocabulary } from "./types";

type Generated = "llm" | "template";

// The prompts used to name a fixed niche ("a boutique data & AI consultancy"),
// which meant a security practice got briefs written for a data practice. They
// are built from the profile now, so the same writer serves every niche.

function nicheVoice(profile: Profile): string {
  const roles = profile.nicheConfig?.buyerRoles ?? [];
  return [
    `${profile.companyName} is a boutique ${profile.nicheConfig?.label ?? "consultancy"} (${profile.headcount} people, ${profile.region}).`,
    `It sells: ${profile.services.map((s) => s.name).join("; ") || "consulting services"}.`,
    roles.length ? `Its buyers are ${roles.join(", ")}.` : "",
    profile.nicheConfig?.outreachAngle ? `Its pitch: ${profile.nicheConfig.outreachAngle}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const BRIEF_SYSTEM =
  "You are a B2B research analyst for a boutique consultancy. " +
  "You write short, specific, factual account briefs for a partner who will act in minutes. " +
  "Never invent facts beyond the signals provided. Output only valid JSON.";

const DRAFT_SYSTEM =
  "You are a careful B2B outreach writer for a boutique consultancy. " +
  "Write low-volume, personalised, non-spammy messages. " +
  "Reference only the supplied signals and case studies. Output only valid JSON.";

/**
 * The recurring shapes, recognised from a signal's key.
 *
 * Niche presets deliberately reuse `public_rfp`, `funding_ma`, `*_leader_hired`
 * and `*_hiring_no_leadership` across markets, so writing concrete template copy
 * for those four is not a data-specific shortcut — everything else falls back to
 * wording built from the tenant's own definition.
 */
type SignalShape = "rfp" | "funding" | "leader" | "hiring" | "other";

function signalShape(type: string): SignalShape {
  if (type === "public_rfp") return "rfp";
  if (type === "funding_ma") return "funding";
  if (/_leader_hired$/.test(type)) return "leader";
  if (/_hiring_no_leadership$/.test(type)) return "hiring";
  return "other";
}

const SHAPE_PAIN: Record<Exclude<SignalShape, "other">, string> = {
  leader:
    "A newly appointed leader usually inherits a fragmented estate, unclear ownership and impatient stakeholders. Expect pressure to show a credible plan and early wins within the first quarter, with too small a team to deliver it alone.",
  hiring:
    "The company is investing in the skills without the senior leadership to direct them. That typically means duplicated effort, ad-hoc tooling decisions, and no clear roadmap the new hires can execute against.",
  rfp: "A live tender signals a funded, time-boxed programme with an internal owner and an approved budget. The pain is a deadline combined with limited internal delivery capacity.",
  funding:
    "New capital or an acquisition creates immediate integration and reporting pressure that the existing team cannot absorb while running the business.",
};

/** Lowercase only the first character, preserving proper nouns like Snowflake. */
function decap(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function signalLines(signals: Signal[], vocabulary: Vocabulary): string {
  return signals
    .map((s) => {
      const d = signalDefinition(s.type, vocabulary);
      return `- [${d.label}] ${s.summary}. Why it matters: ${d.why} Evidence: ${s.evidence} (source: ${s.source}, event ${s.eventAt.slice(0, 10)}, strength ${s.strength.toFixed(2)})`;
    })
    .join("\n");
}

function profileLines(profile: Profile, contacts: Contact[]): string {
  return [
    `Consultancy: ${nicheVoice(profile)}`,
    `Ideal client: ${profile.idealClient.description}`,
    profile.nicheConfig?.buyerRoles?.length
      ? `Approach roles: ${profile.nicheConfig.buyerRoles.join(", ")}.`
      : "",
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
  vocabulary: Vocabulary = [],
  /** Whose spend this call belongs to, for the daily cap (see ./ai-usage.ts). */
  tenantId?: number,
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
${signalLines(signals, vocabulary)}

Return JSON with keys:
"whyNow" (2-3 sentences: why this account needs us this month, grounded in the signals),
"likelyPain" (2-3 sentences: the concrete pain the signals imply),
"caseStudyAngle" (1-2 sentences: which of our case studies to lead with and why),
"whoToContact" (1-2 sentences: the role(s) to approach first and the hook).`,
    { purpose: "brief", tenantId },
  );

  if (fromLlm && fromLlm.whyNow && fromLlm.likelyPain) {
    return { ...fromLlm, generatedBy: "llm" as Generated };
  }
  return {
    ...templateBrief(profile, account, signals, contacts, vocabulary),
    generatedBy: "template" as Generated,
  };
}

function templateBrief(
  profile: Profile,
  account: Account,
  signals: Signal[],
  contacts: Contact[],
  vocabulary: Vocabulary,
): Omit<Brief, "id" | "accountId" | "createdAt" | "generatedBy"> {
  const primary = pickPrimary(signals, vocabulary);
  const def = primary ? signalDefinition(primary.type, vocabulary) : null;

  const whyNow = primary
    ? `${account.name} is showing a live need right now: ${primary.summary}. ${
        def ? def.why : ""
      } Detected ${primary.detectedAt.slice(0, 10)} from ${primary.source}.`.trim()
    : `${account.name} matches the ideal client profile but no fresh signal is recorded yet.`;

  // Concrete copy for the four shapes every niche shares, and wording built from
  // the tenant's own definition for the rest — so a niche-specific signal like
  // "compliance_audit" still produces a real paragraph without a code change.
  const shape = primary ? signalShape(primary.type) : "other";
  const likelyPain =
    shape !== "other"
      ? SHAPE_PAIN[shape]
      : primary && def
        ? `${def.why} In practice that means the mandate arrives before the capacity does: the work lands on people already committed elsewhere, so it stalls at the first hard decision.`
        : `No fresh signal is recorded, so the pain has to be established in conversation rather than assumed.`;

  const matchedCase = pickCaseStudy(profile, account, primary, def);

  const caseStudyAngle = matchedCase
    ? `Lead with the ${matchedCase.sector.toLowerCase()} engagement — ${decap(matchedCase.problem)} Outcome: ${matchedCase.outcome}`
    : `Lead with the closest engagement we have to this account, and the measurable outcome we delivered.`;

  const roles = profile.nicheConfig?.buyerRoles ?? [];
  const dm = contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
  const whoToContact = dm
    ? `Approach ${dm.name} (${dm.title}) first — ${
        primary ? `open on the "${primary.summary}" signal` : "open on their roadmap"
      } and keep the ask to a short working session, not a pitch.`
    : roles.length
      ? `No decision-maker is on file: identify the ${roles.slice(0, 2).join(" or ")} before outreach.`
      : `Identify the relevant leader before outreach; no decision-maker is on file yet.`;

  return { whyNow, likelyPain, caseStudyAngle, whoToContact };
}

/**
 * The case study to lead with: same sector first, then one whose service line
 * overlaps the signal that fired, then whatever we have.
 *
 * The old version keyed on two hardcoded service ids from the data & AI sample
 * profile, which matched nothing in another niche and silently fell through.
 */
function pickCaseStudy(
  profile: Profile,
  account: Account,
  primary: Signal | null,
  def: ReturnType<typeof signalDefinition> | null,
) {
  const studies = profile.caseStudies ?? [];
  if (studies.length === 0) return undefined;

  const sameSector = studies.find((c) => c.sector.toLowerCase() === account.sector.toLowerCase());
  if (sameSector) return sameSector;

  if (primary) {
    const keywords = def?.serviceKeywords ?? [];
    const byService = studies.find((c) => {
      const service = profile.services.find((s) => s.id === c.serviceLineId);
      if (!service) return false;
      const haystack = `${service.name} ${service.description}`.toLowerCase();
      return keywords.some((k) => haystack.includes(k.toLowerCase()));
    });
    if (byService) return byService;
  }
  return studies[0];
}

function pickPrimary(signals: Signal[], vocabulary: Vocabulary = []): Signal | null {
  return (
    [...signals].sort((a, b) => {
      const wa = signalDefinition(a.type, vocabulary).weight * a.strength;
      const wb = signalDefinition(b.type, vocabulary).weight * b.strength;
      if (wb !== wa) return wb - wa;
      return new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime();
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
  vocabulary: Vocabulary = [],
  /** Whose spend this call belongs to, for the daily cap (see ./ai-usage.ts). */
  tenantId?: number,
): Promise<Omit<Draft, "id" | "accountId" | "createdAt">[]> {
  const roles = profile.nicheConfig?.buyerRoles ?? [];
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
${signalLines(signals, vocabulary)}
${brief ? `Brief we just wrote — why now: ${brief.whyNow} Pain: ${brief.likelyPain} Angle: ${brief.caseStudyAngle}` : ""}

Tone: ${profile.tone}. Email length: ${lengthGuidance(profile.length)}.
Address the email to ${dm ? `${dm.name} (${dm.title})` : roles.length ? `the ${roles[0]}` : "the relevant leader"}.

Return JSON with keys:
"emailSubject" (lowercase, specific, no hype),
"emailBody" (plain text, no markdown, one clear low-friction ask),
"linkedinMessage" (max 60 words, no email pitch, reference the signal),
"warmIntro" (a short note asking a mutual connection to introduce us, or "" if none is plausible).`,
    { purpose: "draft", tenantId },
  );

  if (fromLlm && fromLlm.emailBody) {
    return [
      {
        channel: "email",
        subject: fromLlm.emailSubject || templateSubject(account, signals, vocabulary),
        body: fromLlm.emailBody,
        tone: profile.tone,
        length: profile.length,
        status: "draft",
        generatedBy: "llm",
      },
      {
        channel: "linkedin",
        subject: null,
        body: fromLlm.linkedinMessage || templateLinkedIn(profile, account, signals, vocabulary),
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

  return templateDrafts(profile, account, signals, dm, vocabulary);
}

/** What the consultancy does, in a short phrase for template copy. */
function servicePhrase(profile: Profile): string {
  const first = profile.services[0]?.name;
  return first ? first.toLowerCase() : (profile.nicheConfig?.label ?? "consulting").toLowerCase();
}

function templateLinkedIn(
  profile: Profile,
  account: Account,
  signals: Signal[],
  vocabulary: Vocabulary,
): string {
  const primary = pickPrimary(signals, vocabulary);
  return (
    `Hi — a signal at ${account.name} caught my eye: ${
      primary ? primary.summary : "a change in your team's plans"
    }. ` +
    `We help ${account.sector.toLowerCase()} teams with ${servicePhrase(profile)}. ` +
    `Open to a brief chat?`
  );
}

/**
 * Built from the signal's own label rather than a list of known data & AI keys,
 * so a niche signal produces a sensible subject instead of the fallback.
 */
function templateSubject(
  account: Account,
  signals: Signal[],
  vocabulary: Vocabulary,
): string {
  const primary = pickPrimary(signals, vocabulary);
  if (!primary) return `${account.name} — a quick idea`;
  const def = signalDefinition(primary.type, vocabulary);
  switch (signalShape(primary.type)) {
    case "leader":
      return `congrats on the new role at ${account.name}`;
    case "rfp":
      return `${account.name} programme — partner support`;
    case "hiring":
      return `a thought on ${account.name}'s hiring`;
    case "funding":
      return `after ${account.name}'s latest move`;
    default:
      return `${decap(def.shortLabel)} at ${account.name}`;
  }
}

function templateDrafts(
  profile: Profile,
  account: Account,
  signals: Signal[],
  dm: Contact | undefined,
  vocabulary: Vocabulary,
): Omit<Draft, "id" | "accountId" | "createdAt">[] {
  const primary = pickPrimary(signals, vocabulary);
  const def = primary ? signalDefinition(primary.type, vocabulary) : null;
  const matched =
    profile.caseStudies.find((c) => c.sector.toLowerCase() === account.sector.toLowerCase()) ??
    profile.caseStudies[0];
  const roles = profile.nicheConfig?.buyerRoles ?? [];
  const greeting = dm ? `Hi ${dm.name.split(" ")[0]},` : "Hi,";
  const opening = primary
    ? `One signal I picked up on ${account.name}: ${primary.summary}.`
    : `I've been following what ${account.name} is doing.`;
  const hc = profile.headcount.trim();
  const article = /^[aeiou]/i.test(hc) || /^(8|11|18)/.test(hc) ? "an" : "a";

  const emailBody = [
    greeting,
    "",
    opening,
    "",
    def && def.why
      ? `Why that matters: ${def.why}`
      : `Why that matters: it is the kind of change that usually needs outside help to land.`,
    matched
      ? `We're ${article} ${profile.headcount}-person ${servicePhrase(profile)} team. For a ${matched.sector.toLowerCase()} client in a similar spot: ${matched.outcome}`
      : `We're ${article} ${profile.headcount}-person ${servicePhrase(profile)} team focused on exactly this kind of work.`,
    // Spread rather than an empty element: an absent pitch must not leave a
    // stray blank line in the middle of the email.
    ...(profile.nicheConfig?.outreachAngle
      ? [`Our angle: ${profile.nicheConfig.outreachAngle}`]
      : []),
    "",
    profile.tone === "direct"
      ? `Worth a 20-minute call next week to see if it's relevant?`
      : `If it's useful, I'm happy to share how we'd sequence the first 90 days — no pitch, just a short working session.`,
    "",
    `— ${profile.companyName}`,
  ].join("\n");

  const linkedinBody =
    `Hi ${dm ? dm.name.split(" ")[0] : "there"} — a signal at ${account.name} caught my eye: ${
      primary ? primary.summary : "a change in your team's plans"
    }. ` +
    `We help ${account.sector.toLowerCase()} teams with ${servicePhrase(profile)}. ` +
    `Open to a brief chat?`;

  const drafts: Omit<Draft, "id" | "accountId" | "createdAt">[] = [
    {
      channel: "email",
      subject: templateSubject(account, signals, vocabulary),
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
      body: `Ask a mutual connection (investor, partner or former colleague) for a short introduction to ${
        dm ? `${dm.name} (${dm.title})` : roles.length ? `the ${roles[0]}` : "the relevant leader"
      } at ${account.name}. Suggested line: "You both care about getting this right — worth comparing notes for 20 minutes."`,
      tone: profile.tone,
      length: "short",
      status: "draft",
      generatedBy: "template",
    },
  ];
  return drafts;
}
