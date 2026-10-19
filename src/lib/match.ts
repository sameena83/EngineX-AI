// Market fit: does this opportunity suit THIS consultancy?
//
// The feed used to rank purely on how strong a signal was, which meant a
// five-person data practice saw the same list as an enterprise consultancy —
// "large company raised money" ranked the same for both. Fit answers the other
// half of the question: is this the kind of work we sell, to the kind of company
// we sell it to, at the size we can actually serve.
//
// Everything here is a pure function of (profile, account, signals) so it can be
// reasoned about and tested without a database.
//
// The gate is deliberately conservative: a clear mismatch is excluded, but
// missing information never is. An account with no known sector or headcount is
// "borderline", not "out" — the engine should not hide an opportunity because a
// source omitted a field.

import type {
  Account,
  FitFactor,
  FitResult,
  Profile,
  Signal,
  SignalDefinition,
  Vocabulary,
} from "./types";
import { definitionFor, exclusionHit } from "./vocab";

/**
 * What a signal implies the buyer needs.
 *
 * Read from the tenant's vocabulary: each definition carries the service
 * keywords it maps to, so a security practice's "compliance audit" matches its
 * assurance service and a platform practice's "tech adoption" matches its
 * Kubernetes one. When a signal predates the current vocabulary there is nothing
 * to read, so the words of its own key are used instead of giving up.
 */
function serviceKeywordsFor(def: SignalDefinition): string[] {
  if (def.serviceKeywords.length > 0) return def.serviceKeywords;
  return def.type
    .split(/[_-]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 4);
}

/** Split a free-text profile field ("logistics, healthcare and retail") into tokens. */
function splitList(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[,;/|]|\band\b|\bor\b|·|•/g)
    .flatMap((part) => part.split(/\s{2,}/))
    .map((part) => part.replace(/[()]/g, " ").trim())
    .filter((part) => part.length >= 3);
}

/** Does `haystack` mention `needle`, allowing for plurals and simple suffixes? */
function mentions(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.trim().toLowerCase();
  if (n.length < 3) return false;
  if (h.includes(n)) return true;
  // "consultancies" vs "consultancy", "governance" vs "govern".
  const stem = n.length > 5 ? n.slice(0, Math.max(4, n.length - 2)) : n;
  return stem.length >= 3 && h.includes(stem);
}

function fit(score: number, ok: boolean, reason: string): FitFactor {
  return { score: Math.max(0, Math.min(1, score)), ok, reason };
}

/* ------------------------------- industries ------------------------------ */

export function industryFit(profile: Profile, account: Account): FitFactor {
  const targets = splitList(profile.idealClient.sector);
  const sector = account.sector?.trim() ?? "";

  // Nothing to match against: the engine cannot call it a mismatch.
  if (targets.length === 0) {
    return fit(0.5, true, "No target industries set — industry not checked.");
  }
  if (!sector || sector.toLowerCase() === "unknown") {
    return fit(0.4, true, "Industry unknown, so it is not counted against it.");
  }
  const matched = targets.filter((t) => mentions(sector, t) || mentions(t, sector));
  if (matched.length > 0) {
    return fit(1, true, `Sector ${sector} is one of your target industries.`);
  }
  const descriptionHit = mentions(profile.idealClient.description, sector);
  if (descriptionHit) {
    return fit(0.6, true, `Sector ${sector} appears in your ideal-client description.`);
  }
  return fit(0, false, `Sector ${sector} is outside your target industries.`);
}

/* ---------------------------------- size --------------------------------- */

export function sizeFit(profile: Profile, account: Account): FitFactor {
  const { sizeMin, sizeMax } = profile.idealClient;
  const employees = account.employees ?? 0;

  if (!sizeMin && !sizeMax) {
    return fit(0.5, true, "No size range set — company size not checked.");
  }
  if (!employees || employees <= 0) {
    return fit(0.4, true, "Headcount unknown, so it is not counted against it.");
  }
  const min = sizeMin || 1;
  const max = sizeMax || Number.MAX_SAFE_INTEGER;

  if (employees >= min && employees <= max) {
    return fit(1, true, `${employees} staff is inside your ${min}–${max} range.`);
  }

  // One band of grace either side: adjacent-size companies are still worth a
  // look, clearly wrong ones are not.
  const lowerBand = min * 0.4;
  const upperBand = max * 3;
  if (employees < min) {
    if (employees >= lowerBand) {
      return fit(0.55, true, `${employees} staff is below your range but close.`);
    }
    return fit(0, false, `${employees} staff is well below your ${min}+ target.`);
  }
  if (employees <= upperBand) {
    return fit(0.55, true, `${employees} staff is above your range but close.`);
  }
  return fit(0, false, `${employees} staff is well beyond your ${max} ceiling.`);
}

/* --------------------------------- region -------------------------------- */

export function regionFit(profile: Profile, account: Account): FitFactor {
  const targets = splitList(profile.idealClient.region);
  const location = account.location?.trim() ?? "";

  if (targets.length === 0) {
    return fit(0.5, true, "No target region set — region not checked.");
  }
  if (!location || location.toLowerCase() === "unknown") {
    return fit(0.4, true, "Location unknown, so it is not counted against it.");
  }
  if (targets.some((t) => mentions(location, t) || mentions(t, location))) {
    return fit(1, true, `Located in your target region (${location}).`);
  }
  return fit(0.2, true, `${location} is outside your stated region.`);
}

/* -------------------------------- services ------------------------------- */

export function serviceFit(
  profile: Profile,
  signals: Signal[],
  vocabulary: Vocabulary,
): {
  factor: FitFactor;
  matched: string[];
} {
  const services = profile.services ?? [];
  if (services.length === 0) {
    return { factor: fit(0.5, true, "No services listed — service match not checked."), matched: [] };
  }

  const matched = new Set<string>();
  for (const signal of signals) {
    const keywords = serviceKeywordsFor(definitionFor(vocabulary, signal.type));
    for (const service of services) {
      const haystack = `${service.name} ${service.description}`;
      if (keywords.some((k) => mentions(haystack, k))) matched.add(service.name);
    }
  }

  if (matched.size > 0) {
    const names = [...matched];
    return {
      factor: fit(Math.min(1, 0.6 + matched.size * 0.2), true, `Fits your service line: ${names.join(", ")}.`),
      matched: names,
    };
  }
  return {
    factor: fit(0, false, "The signals here do not match any service you sell."),
    matched: [],
  };
}

/* -------------------------------- combined ------------------------------- */

// Industry and services dominate: work you do not sell cannot be rescued by a
// company happening to be the right size.
const WEIGHTS = { industry: 0.3, services: 0.35, size: 0.2, region: 0.15 };

export function computeFit(
  profile: Profile,
  account: Account,
  signals: Signal[],
  vocabulary: Vocabulary = [],
): FitResult {
  const industry = industryFit(profile, account);
  const size = sizeFit(profile, account);
  const region = regionFit(profile, account);
  const { factor: services, matched } = serviceFit(profile, signals, vocabulary);

  const score =
    industry.score * WEIGHTS.industry +
    services.score * WEIGHTS.services +
    size.score * WEIGHTS.size +
    region.score * WEIGHTS.region;

  // An excluded company is out regardless of how well it fits on paper: a
  // consultancy, agency or recruiter is a competitor or a non-buyer, never a
  // prospect. Checked first so the reason shown is the real one.
  const exclusion = exclusionHit(account, profile.nicheConfig?.exclusions);

  // Otherwise a clear mismatch is an industry the business is not in AND a size
  // it cannot serve. Either one alone leaves it as something worth a look.
  const clearMismatch = exclusion !== null || (!industry.ok && !size.ok);
  const gate: FitResult["gate"] = clearMismatch
    ? "out"
    : score >= 0.62
      ? "in"
      : "borderline";

  const summaryParts = [
    account.sector && account.sector !== "Unknown" ? account.sector : null,
    account.employees > 0 ? `${account.employees} staff` : null,
    matched.length > 0 ? `fits ${matched.join(" / ")}` : null,
  ].filter((p): p is string => Boolean(p));

  return {
    score: Math.round(score * 100) / 100,
    gate,
    industry,
    size,
    region,
    services,
    matchedServices: matched,
    exclusion,
    summary: exclusion
      ? `Excluded: matches "${exclusion}", so it is a competitor or a non-buyer.`
      : summaryParts.join(" · ") || "No market details on file.",
  };
}

/** Whether this opportunity should be excluded from the top list. */
export function isPoorFit(result: FitResult): boolean {
  return result.gate === "out";
}

/** Why this ranks where it does, in the consultancy's own terms. */
export function fitReasons(result: FitResult): string[] {
  const out: string[] = [];
  if (result.services.ok) out.push(result.services.reason);
  if (result.industry.ok) out.push(result.industry.reason);
  if (result.size.ok) out.push(result.size.reason);
  if (result.region.score >= 0.9) out.push(result.region.reason);
  return out;
}

/** What held it back, so a ranking is never a black box. */
export function fitPenalties(result: FitResult): string[] {
  const out: string[] = [];
  if (result.exclusion) {
    out.push(`Company matches an exclusion ("${result.exclusion}").`);
  }
  for (const factor of [result.industry, result.size, result.region, result.services]) {
    if (!factor.ok) out.push(factor.reason);
  }
  return out;
}
