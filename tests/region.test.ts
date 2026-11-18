// Geography: a profile's target region against an account's location.
//
// The bug this covers: region was a substring check over free text, so a
// profile targeting "United States" scored "San Francisco, CA" as outside its
// stated region, and a Stockholm practice targeting "Sweden" could not match
// "Stockholm, SE". Both directions have to work, because the same code decides
// whether a Swedish or an American pipeline is the right one.

import assert from "node:assert/strict";
import test from "node:test";
import { compareRegion, resolvePlace, resolveTargets } from "../src/lib/geo";
import { computeFit, regionFit } from "../src/lib/match";
import { DEFAULT_PROFILE, SIGNAL_DEFINITIONS } from "../src/lib/seed-data";
import type { Account, Profile, Signal } from "../src/lib/types";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    companyName: "Test Practice",
    website: "https://test.example",
    headcount: "18",
    region: "Stockholm, SE",
    niche: "data_ai",
    nicheConfig: {
      key: "data_ai",
      label: "Data & AI",
      description: "Test practice",
      buyerRoles: [],
      negativeRules: [],
      exclusions: [],
      scoring: { fitPoints: 25, halfLifeDays: 30 },
      outreachAngle: "",
      sourceQueries: [],
    },
    services: [],
    idealClient: {
      sector: "Logistics",
      sizeMin: 200,
      sizeMax: 5000,
      region: "Sweden",
      description: "",
    },
    caseStudies: [],
    tone: "consultative",
    length: "medium",
    digestIncludesContacts: false,
    delivery: { digestCadence: "weekly", alertMinScore: 80, digestSize: 8 },
    sender: { name: "Test", email: "t@test.example", replyTo: "t@test.example" },
    ...overrides,
  };
}

/** A profile whose target region is the given text — the field under test. */
function targeting(regionText: string, base = "Stockholm, SE"): Profile {
  const p = profile({ region: base });
  p.idealClient = { ...p.idealClient, region: regionText };
  return p;
}

function account(location: string, overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Nordic Test AB",
    domain: "test.example",
    sector: "Logistics",
    employees: 800,
    location,
    description: "",
    status: "new",
    ...overrides,
  };
}

/* ------------------------------ resolution ------------------------------- */

test("cities resolve to their country, accents or not", () => {
  assert.deepEqual(
    [resolvePlace("Stockholm")?.country, resolvePlace("Stockholm")?.region],
    ["se", "nordics"],
  );
  assert.equal(resolvePlace("Norrköping, Sweden")?.country, "se");
  assert.equal(resolvePlace("Nørrebro, Copenhagen")?.country, "dk");
  assert.equal(resolvePlace("Oslo")?.country, "no");
  assert.equal(resolvePlace("Helsinki")?.country, "fi");
  // Same place, written the way a source would write it.
  assert.equal(resolvePlace("Stockholm, SE")?.country, "se");
  assert.equal(resolvePlace("Gothenburg")?.city, "Gothenburg");
});

test("US locations resolve through the state abbreviation", () => {
  // The original bug: "Austin, TX" never contained "United States".
  assert.equal(resolvePlace("Austin, TX")?.country, "us");
  assert.equal(resolvePlace("San Francisco, CA")?.country, "us");
  assert.equal(resolvePlace("New York, NY")?.country, "us");
  assert.equal(resolvePlace("Chicago, Illinois")?.country, "us");
  assert.equal(resolvePlace("Toronto, ON")?.country, "ca");
});

test("a location that cannot be placed is null, never a guess", () => {
  assert.equal(resolvePlace(""), null);
  assert.equal(resolvePlace("Unknown"), null);
  assert.equal(resolvePlace("Remote"), null);
  // In a *location* field a bare two-letter tail is a US state, not a country
  // code: "CA" means California. Country aliases avoid the same codes for that
  // reason (Canada is only "canada"), so the two never collide.
  assert.equal(resolvePlace("CA")?.country, "us");
});

test("targets split into countries, macro regions and cities", () => {
  const broad = resolveTargets("Sweden, Norway, Denmark, Finland, Iceland");
  assert.equal(broad.selectors.length, 5);
  assert.deepEqual(broad.unresolved, []);

  const macro = resolveTargets("the Nordics");
  assert.deepEqual(macro.selectors, [{ kind: "macro", region: "nordics" }]);

  const city = resolveTargets("Stockholm");
  assert.equal(city.selectors[0]?.kind, "city");

  // Unreadable targets are reported, so the caller can fall back rather than
  // treat "EMEA" as "no target region".
  assert.deepEqual(resolveTargets("EMEA").unresolved, ["EMEA"]);
});

/* ------------------------------- comparison ------------------------------ */

test("a Sweden target matches Swedish and Nordic accounts", () => {
  assert.equal(compareRegion("Stockholm, SE", "Sweden").status, "match");
  assert.equal(compareRegion("Gothenburg", "Sweden").status, "match");
  // Norway is next door: worth a look, not a mismatch.
  const near = compareRegion("Oslo", "Sweden");
  assert.equal(near.status, "near");
  assert.equal(near.score, 0.75);
});

test("a United States target matches US accounts, not Swedish ones", () => {
  // The other direction, and the one that was silently broken.
  assert.equal(compareRegion("San Francisco, CA", "United States").status, "match");
  assert.equal(compareRegion("Austin, TX", "United States").score, 1);
  assert.equal(compareRegion("Stockholm, SE", "United States").status, "miss");
});

test("a Swedish profile does not match a Californian account", () => {
  const cmp = compareRegion("San Francisco, CA", "Sweden, Norway, Denmark, Finland");
  assert.equal(cmp.status, "miss");
  assert.equal(cmp.score, 0);
  assert.equal(cmp.account?.countryName, "United States");
});

test("the Nordics macro covers every Nordic country", () => {
  for (const city of ["Stockholm", "Oslo", "Copenhagen", "Helsinki", "Reykjavik"]) {
    assert.equal(compareRegion(city, "Nordics").status, "match", city);
  }
  assert.equal(compareRegion("Berlin", "Nordics").status, "miss");
});

test("the consultancy's own country wins inside a regional target", () => {
  // Target is the whole of Europe, base is Stockholm: Sweden should outrank
  // Norway rather than both being one undifferentiated "Europe".
  const home = compareRegion("Gothenburg", "Europe", "Stockholm, SE");
  const away = compareRegion("Oslo", "Europe", "Stockholm, SE");
  assert.equal(home.score, 1);
  assert.equal(away.status, "match");
  assert.equal(away.score, 1); // still in target, just not the home country
});

test("unknown locations and unreadable targets are never mismatches", () => {
  assert.equal(compareRegion("Unknown", "Sweden").status, "unknown_location");
  assert.equal(compareRegion("Remote", "Sweden").status, "unknown_location");
  assert.equal(compareRegion("Stockholm", "EMEA").status, "unresolved");
});

/* --------------------------------- fit ----------------------------------- */

test("regionFit reads the target region in the profile", () => {
  const sweden = regionFit(targeting("Sweden"), account("Stockholm"));
  assert.equal(sweden.ok, true);
  assert.equal(sweden.score, 1);

  const outside = regionFit(targeting("Sweden"), account("Austin, TX"));
  assert.equal(outside.ok, false);
  assert.match(outside.reason, /outside your target region/);
});

test("regionFit falls back to the consultancy's base when no target is set", () => {
  // "I am in Stockholm" has to mean something even before the field is filled.
  const fit = regionFit(targeting("", "Stockholm, SE (selling to US)"), account("Malmö"));
  assert.equal(fit.ok, true);
  assert.equal(fit.score, 1);
});

test("an unknown location is left unchecked, not penalised", () => {
  const fit = regionFit(targeting("Sweden"), account("Unknown"));
  assert.equal(fit.ok, true);
  assert.equal(fit.score, 0.4);
  assert.equal(computeFit(targeting("Sweden"), account("Unknown"), []).gate, "in");
});

test("a good location cannot rescue an industry mismatch", () => {
  // Francks Kylindustri: right country, right size, strong evidence — but
  // commercial refrigeration is not data & AI work. Region being 1.0 lifts the
  // paper score; it must not lift the account to "in".
  const at = new Date().toISOString();
  const signals: Signal[] = [
    {
      id: 1,
      accountId: 1,
      type: "funding_ma",
      summary: "IK Partners to acquire Francks Kylindustri",
      evidence: "Acquisition announced.",
      source: "Press release",
      sourceUrl: null,
      eventAt: at,
      detectedAt: at,
      strength: 0.9,
    },
  ];
  const fit = computeFit(
    DEFAULT_PROFILE,
    account("Norrkoping, Sweden", {
      sector: "Commercial refrigeration services",
      employees: 650,
    }),
    signals,
    Object.values(SIGNAL_DEFINITIONS),
  );
  assert.equal(fit.region.ok, true);
  assert.equal(fit.industry.ok, false);
  assert.equal(fit.gate, "borderline");
});

test("an out-of-region account is gated out of the feed", () => {
  const swedish = computeFit(targeting("Sweden"), account("Austin, TX"), []);
  assert.equal(swedish.gate, "out");
  assert.equal(swedish.region.ok, false);

  const american = computeFit(targeting("United States"), account("Austin, TX"), []);
  assert.notEqual(american.gate, "out");
  assert.equal(american.region.score, 1);
});
