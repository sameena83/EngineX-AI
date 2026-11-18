// Geography: turning free-text locations into place facts the ranking can use.
//
// Both sides of the comparison used to be compared as raw strings, which meant
// a profile targeting "United States" scored a San Francisco account as
// "outside your stated region" — "CA" never contains "United States" — and a
// Stockholm consultancy targeting "Sweden" could not match "Stockholm, SE".
//
// This module resolves a free-text place to a country and a macro region, so
// the same rule works in both directions: Sweden ⊃ Stockholm, and United
// States ⊃ California. Nothing here knows about scores or wording; it returns
// facts and ./match.ts turns them into a reason.
//
// Deliberately a small, hand-checked table rather than a gazetteer package: the
// product only ever needs to place the countries its customers sell into, and a
// wrong match is worse than an unknown one (an unknown location is never
// counted against an account).

export type MacroRegion = "nordics" | "europe" | "north_america" | "other";

export interface Place {
  /** ISO-3166 alpha-2, lower case. */
  country: string;
  countryName: string;
  region: MacroRegion;
  /** Resolved city, when the text named one. */
  city: string | null;
}

interface CountryInfo {
  name: string;
  region: MacroRegion;
  /** Lower-case spellings that mean this country. Ambiguous 2-letter codes are
   *  left out on purpose: "CA" is California far more often than Canada. */
  aliases: string[];
}

const COUNTRIES: Record<string, CountryInfo> = {
  se: {
    name: "Sweden",
    region: "nordics",
    aliases: ["sweden", "sverige", "se"],
  },
  no: { name: "Norway", region: "nordics", aliases: ["norway", "norge", "no"] },
  dk: { name: "Denmark", region: "nordics", aliases: ["denmark", "danmark", "dk"] },
  fi: { name: "Finland", region: "nordics", aliases: ["finland", "suomi", "fi"] },
  is: { name: "Iceland", region: "nordics", aliases: ["iceland", "island", "is"] },
  de: { name: "Germany", region: "europe", aliases: ["germany", "deutschland"] },
  nl: { name: "Netherlands", region: "europe", aliases: ["netherlands", "holland", "nl"] },
  uk: {
    name: "United Kingdom",
    region: "europe",
    aliases: ["united kingdom", "uk", "great britain", "england", "scotland", "wales"],
  },
  ie: { name: "Ireland", region: "europe", aliases: ["ireland", "eire"] },
  fr: { name: "France", region: "europe", aliases: ["france"] },
  es: { name: "Spain", region: "europe", aliases: ["spain", "espana"] },
  it: { name: "Italy", region: "europe", aliases: ["italy", "italia"] },
  pl: { name: "Poland", region: "europe", aliases: ["poland", "polska", "pl"] },
  ee: { name: "Estonia", region: "europe", aliases: ["estonia", "eesti", "ee"] },
  lv: { name: "Latvia", region: "europe", aliases: ["latvia", "latvija", "lv"] },
  lt: { name: "Lithuania", region: "europe", aliases: ["lithuania", "lietuva", "lt"] },
  be: { name: "Belgium", region: "europe", aliases: ["belgium", "belgie", "belgique", "be"] },
  at: { name: "Austria", region: "europe", aliases: ["austria", "osterreich", "at"] },
  ch: { name: "Switzerland", region: "europe", aliases: ["switzerland", "schweiz", "suisse", "ch"] },
  pt: { name: "Portugal", region: "europe", aliases: ["portugal", "pt"] },
  cz: { name: "Czechia", region: "europe", aliases: ["czechia", "czech republic", "cz"] },
  us: {
    name: "United States",
    region: "north_america",
    aliases: ["united states", "united states of america", "usa", "u s", "us", "america"],
  },
  ca: { name: "Canada", region: "north_america", aliases: ["canada"] },
};

/** The alias → country lookup, built once. Longest alias first, so
 *  "united states of america" wins over "united states". */
const ALIASES: { alias: string; country: string }[] = Object.entries(COUNTRIES)
  .flatMap(([code, info]) => info.aliases.map((alias) => ({ alias, country: code })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Macro regions a customer can name directly in their profile. */
const MACROS: Record<string, MacroRegion> = {
  nordics: "nordics",
  "nordic countries": "nordics",
  scandinavia: "nordics",
  europe: "europe",
  eu: "europe",
  "european union": "europe",
  "northern europe": "europe",
  "north america": "north_america",
  "north american": "north_america",
};

/** Which regions a broader one contains. The Nordics are part of Europe, so a
 *  European target has to accept a Swedish account. */
const CONTAINED_BY: Record<MacroRegion, MacroRegion[]> = {
  nordics: ["nordics", "europe"],
  europe: ["europe"],
  north_america: ["north_america"],
  other: ["other"],
};

/** Cities worth placing. Keyed on the normalised spelling (no accents, lower
 *  case); the value carries the display name and its country. */
const CITIES: Record<string, { name: string; country: string }> = {
  // Sweden
  stockholm: { name: "Stockholm", country: "se" },
  goteborg: { name: "Gothenburg", country: "se" },
  gothenburg: { name: "Gothenburg", country: "se" },
  malmo: { name: "Malmo", country: "se" },
  uppsala: { name: "Uppsala", country: "se" },
  norrkoping: { name: "Norrkoping", country: "se" },
  linkoping: { name: "Linkoping", country: "se" },
  orebro: { name: "Orebro", country: "se" },
  vasteras: { name: "Vasteras", country: "se" },
  helsingborg: { name: "Helsingborg", country: "se" },
  jonkoping: { name: "Jonkoping", country: "se" },
  umea: { name: "Umea", country: "se" },
  lund: { name: "Lund", country: "se" },
  sundsvall: { name: "Sundsvall", country: "se" },
  gavle: { name: "Gavle", country: "se" },
  boras: { name: "Boras", country: "se" },
  sodertalje: { name: "Sodertalje", country: "se" },
  eskilstuna: { name: "Eskilstuna", country: "se" },
  karlstad: { name: "Karlstad", country: "se" },
  ostersund: { name: "Ostersund", country: "se" },
  lulea: { name: "Lulea", country: "se" },
  visby: { name: "Visby", country: "se" },
  kalmar: { name: "Kalmar", country: "se" },
  karlskrona: { name: "Karlskrona", country: "se" },
  halmstad: { name: "Halmstad", country: "se" },
  vaxjo: { name: "Vaxjo", country: "se" },
  // Nordics
  oslo: { name: "Oslo", country: "no" },
  bergen: { name: "Bergen", country: "no" },
  trondheim: { name: "Trondheim", country: "no" },
  stavanger: { name: "Stavanger", country: "no" },
  tromso: { name: "Tromso", country: "no" },
  drammen: { name: "Drammen", country: "no" },
  kristiansand: { name: "Kristiansand", country: "no" },
  copenhagen: { name: "Copenhagen", country: "dk" },
  kobenhavn: { name: "Copenhagen", country: "dk" },
  aarhus: { name: "Aarhus", country: "dk" },
  odense: { name: "Odense", country: "dk" },
  aalborg: { name: "Aalborg", country: "dk" },
  esbjerg: { name: "Esbjerg", country: "dk" },
  helsinki: { name: "Helsinki", country: "fi" },
  espoo: { name: "Espoo", country: "fi" },
  vantaa: { name: "Vantaa", country: "fi" },
  tampere: { name: "Tampere", country: "fi" },
  turku: { name: "Turku", country: "fi" },
  oulu: { name: "Oulu", country: "fi" },
  lahti: { name: "Lahti", country: "fi" },
  reykjavik: { name: "Reykjavik", country: "is" },
  // Common markets outside the Nordics, so the other direction resolves too.
  "new york": { name: "New York", country: "us" },
  "san francisco": { name: "San Francisco", country: "us" },
  chicago: { name: "Chicago", country: "us" },
  austin: { name: "Austin", country: "us" },
  boston: { name: "Boston", country: "us" },
  seattle: { name: "Seattle", country: "us" },
  denver: { name: "Denver", country: "us" },
  atlanta: { name: "Atlanta", country: "us" },
  dallas: { name: "Dallas", country: "us" },
  houston: { name: "Houston", country: "us" },
  "los angeles": { name: "Los Angeles", country: "us" },
  miami: { name: "Miami", country: "us" },
  toronto: { name: "Toronto", country: "ca" },
  vancouver: { name: "Vancouver", country: "ca" },
  london: { name: "London", country: "uk" },
  dublin: { name: "Dublin", country: "ie" },
  berlin: { name: "Berlin", country: "de" },
  munich: { name: "Munich", country: "de" },
  hamburg: { name: "Hamburg", country: "de" },
  amsterdam: { name: "Amsterdam", country: "nl" },
  paris: { name: "Paris", country: "fr" },
  madrid: { name: "Madrid", country: "es" },
  barcelona: { name: "Barcelona", country: "es" },
  milan: { name: "Milan", country: "it" },
  warsaw: { name: "Warsaw", country: "pl" },
  tallinn: { name: "Tallinn", country: "ee" },
  vilnius: { name: "Vilnius", country: "lt" },
  riga: { name: "Riga", country: "lv" },
};

/** US states, so "Austin, TX" resolves to the United States. Codes are only
 *  read in a location string, never as a profile target, where they collide
 *  with country codes. */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

const US_STATE_CODES = new Set(Object.values(US_STATES));

/** Lower-case, accent-free, punctuation-to-space. "Norrköping, SE" →
 *  "norrkoping se". */
function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const padded = ` ${haystack} `;
  return padded.includes(` ${phrase} `);
}

function placeFor(country: string, city: string | null): Place {
  const info = COUNTRIES[country];
  return {
    country,
    countryName: info?.name ?? country.toUpperCase(),
    region: info?.region ?? "other",
    city,
  };
}

/** Strip a parenthetical aside: "Stockholm, SE (selling to US)" is about the
 *  profile's own words, not a second target market. */
function withoutAsides(text: string): string {
  return text.replace(/\([^)]*\)/g, " ");
}

/**
 * Resolve one free-text location to a country, and a city when one is named.
 * Returns null rather than guessing: an unknown location must not be counted
 * against an account.
 */
export function resolvePlace(text: string): Place | null {
  if (!text) return null;
  const norm = normalise(withoutAsides(text));
  if (!norm || norm === "unknown" || norm === "n a") return null;

  // 1. A named city is the most specific fact in the string.
  for (const [key, city] of Object.entries(CITIES)) {
    if (hasPhrase(norm, key)) return placeFor(city.country, city.name);
  }

  // 2. "Austin, TX" — a US state name or its two-letter code as a segment.
  const segments = norm.split(/[,/|;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    if (US_STATES[segment]) return placeFor("us", null);
    if (segment.length === 2 && US_STATE_CODES.has(segment.toUpperCase())) {
      return placeFor("us", null);
    }
  }

  // 3. A country name anywhere, longest alias first.
  for (const { alias, country } of ALIASES) {
    if (hasPhrase(norm, alias)) return placeFor(country, null);
  }

  return null;
}

export type TargetSelector =
  | { kind: "city"; city: string; country: string }
  | { kind: "country"; country: string }
  | { kind: "macro"; region: MacroRegion };

/**
 * Read a profile's target region — "Sweden, Norway", "the Nordics", "United
 * States" — into selectors. Parts that resolve to nothing are returned as text
 * so the caller can fall back to a plain mention check instead of pretending
 * the profile said nothing.
 */
export function resolveTargets(text: string): {
  selectors: TargetSelector[];
  unresolved: string[];
} {
  const selectors: TargetSelector[] = [];
  const unresolved: string[] = [];
  const parts = withoutAsides(text)
    .split(/[,;/|]|\band\b|\bor\b|\+/gi)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.toLowerCase() !== "the");

  for (const part of parts) {
    const norm = normalise(part).replace(/^the\s+/, "");
    if (!norm) continue;

    const country = ALIASES.find((a) => a.alias === norm);
    if (country) {
      selectors.push({ kind: "country", country: country.country });
      continue;
    }
    const macro = MACROS[norm];
    if (macro) {
      selectors.push({ kind: "macro", region: macro });
      continue;
    }
    const city = CITIES[norm];
    if (city) {
      selectors.push({ kind: "city", city: city.name, country: city.country });
      continue;
    }
    unresolved.push(part);
  }

  return { selectors, unresolved };
}

export interface RegionComparison {
  status: "match" | "near" | "miss" | "unknown_location" | "unresolved";
  /** 0..1, how good the geography is. */
  score: number;
  account: Place | null;
  /** How the result was arrived at, for a precise reason string. */
  via: "city" | "country" | "macro" | "unresolved" | null;
  /** The profile's words, echoed back in the reason. */
  targetText: string;
}

/**
 * Compare an account's location with a profile's target region.
 *
 * Tiers: same city or country 1.0; same macro region 0.75 (a Stockholm practice
 * can serve Oslo); anything else 0. A location or a target that cannot be
 * placed never counts against the account — the caller shows it as unchecked
 * rather than a mismatch.
 */
export function compareRegion(
  location: string,
  targetText: string,
  originText = "",
): RegionComparison {
  const account = resolvePlace(location);
  const target = resolveTargets(targetText);
  const targetLabel = targetText.trim();

  if (target.selectors.length === 0 && target.unresolved.length === 0) {
    return { status: "unresolved", score: 0.5, account, via: "unresolved", targetText: targetLabel };
  }
  if (!account) {
    return { status: "unknown_location", score: 0.4, account: null, via: null, targetText: targetLabel };
  }
  if (target.selectors.length === 0) {
    return { status: "unresolved", score: 0.5, account, via: "unresolved", targetText: targetLabel };
  }

  let best = 0;
  let via: RegionComparison["via"] = null;
  for (const selector of target.selectors) {
    if (selector.kind === "city") {
      if (account.city && normalise(account.city) === normalise(selector.city)) {
        best = 1;
        via = "city";
      } else if (account.country === selector.country) {
        best = Math.max(best, 0.65);
        via = via ?? "country";
      }
      continue;
    }
    if (selector.kind === "country") {
      if (account.country === selector.country) {
        best = 1;
        via = "country";
        continue;
      }
      const targetRegion = COUNTRIES[selector.country]?.region;
      if (targetRegion && targetRegion !== "other" && targetRegion === account.region) {
        best = Math.max(best, 0.75);
        via = via ?? "macro";
      }
      continue;
    }
    if (CONTAINED_BY[account.region]?.includes(selector.region)) {
      best = 1;
      via = "macro";
    }
  }

  // Home advantage: when the target is a whole region, an account in the
  // consultancy's own country outranks its neighbours.
  if (best > 0 && best < 1) {
    const origin = resolvePlace(originText);
    if (origin && origin.country === account.country) {
      best = 1;
      via = "country";
    }
  }

  if (best === 0) {
    return { status: "miss", score: 0, account, via: null, targetText: targetLabel };
  }
  return {
    status: best >= 1 ? "match" : "near",
    score: best,
    account,
    via,
    targetText: targetLabel,
  };
}
