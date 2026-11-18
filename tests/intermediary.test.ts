// Recruiter adverts: the tell, and the phrases that only look like one.
//
// This guard decides whether a job-board item creates a company record. Its
// failure mode is expensive in both directions: too loose and the feed fills with
// staffing agencies pretending to be buyers; too eager and a real employer's ad
// is discarded. These are real advert phrasings, Swedish and English.

import assert from "node:assert/strict";
import test from "node:test";
import { intermediaryPhrase } from "../src/lib/intermediary";

test("a posting on behalf of a client is a recruiter advert", () => {
  const adverts = [
    "Data Engineer — on behalf of our client, a Nordic logistics group.",
    "Our client is looking for a Senior Data Engineer to join their platform team.",
    "Our client seeks a Data Architect for a greenfield Snowflake migration.",
    "Hiring: Data Engineer (Malmö). På uppdrag av vår kund söker vi nu en dataingenjör.",
    "Tjänsten är ett konsultuppdrag hos kundföretaget i Stockholm.",
    "Vi söker en Data Engineer till vår kund inom finanssektorn.",
    "För vår kunds räkning rekryterar vi en Analytics Engineer.",
    "Bemanning av dataingenjörer för kunds räkning.",
    "Rekryteringsuppdrag: Head of Data till ett scale-up.",
    "Vår kund leder vägen inom datadriven transformation och söker nu en Data Engineer.",
    "Senior Data Engineer till ett globalt bolag inom fordonsindustrin.",
  ];
  for (const text of adverts) {
    assert.ok(intermediaryPhrase(text), `expected a recruiter tell in: ${text}`);
  }
});

test("a real employer talking about its customers is not a recruiter advert", () => {
  const adverts = [
    "IKEA Supply Services is hiring a Data Engineer in Älmhult.",
    "We build pipelines for our customers across the Nordics.",
    "Our clients rely on us for analytics delivery; we are hiring a data engineer.",
    "Våra kunder är nordiska banker. Vi söker en Data Engineer.",
    "Hiring: Data Engineer (Stockholm). Modern data platforms are built on events.",
    "Mentimeter is looking for a Data Engineer to own our event pipelines.",
  ];
  for (const text of adverts) {
    assert.equal(intermediaryPhrase(text), null, `false positive on: ${text}`);
  }
});

test("the reported phrase is the one that matched", () => {
  assert.equal(intermediaryPhrase("På uppdrag av vår kund söker vi en dataingenjör."), "på uppdrag av vår kund");
  assert.equal(intermediaryPhrase("An advert on behalf of our client."), "on behalf of our client");
});
