// Staffing and recruiting firms advertise other companies' vacancies.
//
// A job-board feed names the *poster*, and for a recruiter that is not the buyer:
// "Academic Work" advertising a data engineer for an unnamed client is evidence
// that some company is hiring, not evidence about Academic Work. Left alone, a
// real Swedish job feed fills the pipeline with staffing agencies, because their
// names rarely contain the words the niche exclusions look for.
//
// The tell is in the advert's own language: a posting written "on behalf of our
// client", "på uppdrag av vår kund" or "konsultuppdrag" is selling someone else's
// role. When that is present, the item has no attributable buyer and ingestion
// counts it as unattributed instead of creating an account.
//
// Kept deliberately narrow: only phrases that mean "we are placing you with a
// client", never "our customers" or "we deliver to our clients", which are an
// ordinary company talking about its market.

interface Tell {
  /** Shown in the run report, so the customer can see what was dropped. */
  phrase: string;
  pattern: RegExp;
}

const TELLS: Tell[] = [
  { phrase: "on behalf of our client", pattern: /\bon\s+behalf\s+of\s+(our|a|the)\s+client\b/i },
  { phrase: "on behalf of a client", pattern: /\bon\s+behalf\s+of\s+a\s+(client|company)\b/i },
  {
    phrase: "our client is hiring",
    pattern: /\bour\s+client\s+(is|are)\s+(now\s+)?(hiring|looking|seeking|recruiting|searching)\b/i,
  },
  { phrase: "our client seeks", pattern: /\bour\s+client\s+(seeks|needs|requires|wants)\b/i },
  { phrase: "for our client", pattern: /\b(for|with)\s+our\s+client\b/i },
  { phrase: "på uppdrag av vår kund", pattern: /\bp[åa]\s+uppdrag\s+av\s+(v[åa]r\s+)?kund/i },
  { phrase: "för vår kunds räkning", pattern: /\bf[öo]r\s+v[åa]r\s+kunds\s+r[äa]kning\b/i },
  // "Vår kund leder vägen … och söker nu" is how Swedish staffing firms phrase
  // it: the noun is the client, whatever verb follows. "Våra kunder" is an
  // ordinary company describing its market and does not match.
  { phrase: "vår kund", pattern: /\bv[åa]r\s+kund\b/i },
  { phrase: "till ett bolag", pattern: /\btill\s+ett\s+(globalt\s+|ledande\s+|innovativt\s+)?(bolag|f[öo]retag)\b/i },
  { phrase: "kundföretag", pattern: /\bkundf[öo]retag(et)?\b/i },
  { phrase: "konsultuppdrag", pattern: /\bkonsultuppdrag\b/i },
  { phrase: "bemanning", pattern: /\bbemanning(suppdrag|sf[öo]retag)?\b/i },
  { phrase: "uthyrning", pattern: /\buthyrning(av)?\b/i },
  { phrase: "rekryteringsuppdrag", pattern: /\brekryteringsuppdrag\b/i },
];

/**
 * The phrase that shows this item is a recruiter's advert, or null.
 *
 * Returned rather than a boolean so the report can say *why* an item was
 * dropped: "konsultuppdrag" and "on behalf of our client" need no explanation to
 * a consultant, but they do need to be visible.
 */
export function intermediaryPhrase(text: string): string | null {
  for (const tell of TELLS) {
    if (tell.pattern.test(text)) return tell.phrase;
  }
  return null;
}
