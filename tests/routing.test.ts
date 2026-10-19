// Routing: which rules may run against an item, and what an empty channel list means.
//
// The interesting case is the second one. Rows written before channels existed hold
// an empty list, which reads as "every channel" — the tolerant default that kept a
// tender pattern matching press releases. Those rows are resolved against the
// presets instead, and a rule a customer deliberately cleared must not be.

import assert from "node:assert/strict";
import test from "node:test";
import { presetChannelsFor, presetChannelsByType, nichePreset } from "../src/lib/niches";
import type { SignalDefinition, Vocabulary } from "../src/lib/types";
import {
  presetToVocabulary,
  readsChannel,
  resolveImplicitRouting,
  unconstrainedTypes,
  vocabularyForChannel,
} from "../src/lib/vocab";

const rule = (over: Partial<SignalDefinition> = {}): SignalDefinition => ({
  type: "some_rule",
  label: "Some rule",
  shortLabel: "Some rule",
  weight: 0.5,
  why: "",
  patterns: [],
  serviceKeywords: [],
  sources: [],
  ...over,
});

test("a rule with no channels reads everything", () => {
  const anyChannel = rule();
  assert.equal(readsChannel(anyChannel, "news"), true);
  assert.equal(readsChannel(anyChannel, "tender"), true);
});

test("a rule only reads the channels it declares", () => {
  const tenderOnly = rule({ type: "public_rfp", sources: ["tender"], sourcesExplicit: true });
  assert.equal(readsChannel(tenderOnly, "tender"), true);
  assert.equal(readsChannel(tenderOnly, "news"), false);
  assert.equal(readsChannel(tenderOnly, "job_board"), false);
});

test("a tender item is not offered to a hiring rule", () => {
  const vocab: Vocabulary = [
    rule({ type: "public_rfp", sources: ["tender"], sourcesExplicit: true }),
    rule({ type: "data_hiring_no_leadership", sources: ["job_board"], sourcesExplicit: true }),
    rule({ type: "hand_written" }),
  ];
  const tender = vocabularyForChannel(vocab, "tender").map((d) => d.type);
  assert.deepEqual(tender, ["public_rfp", "hand_written"]);
  const jobs = vocabularyForChannel(vocab, "job_board").map((d) => d.type);
  assert.deepEqual(jobs, ["data_hiring_no_leadership", "hand_written"]);
  // An item that declares no channel is readable by every rule: the caller is
  // asserting relevance, so routing it away would discard it silently.
  assert.equal(vocabularyForChannel(vocab, null).length, 3);
});

test("rules with no chosen channels follow the preset for their key", () => {
  const legacy: Vocabulary = [
    rule({ type: "public_rfp", sources: [], sourcesExplicit: false }),
    rule({ type: "funding_ma", sources: [] }),
  ];
  const routed = resolveImplicitRouting(legacy, presetChannelsFor);
  assert.deepEqual(routed[0].sources, ["tender"]);
  assert.deepEqual(routed[1].sources, ["news", "funding"]);
  // The stored row is untouched: this is a read-time resolution, not a write.
  assert.deepEqual(legacy[0].sources, []);
});

test("a rule whose channels were chosen keeps them, including \"any channel\"", () => {
  const cleared = rule({ type: "public_rfp", sources: [], sourcesExplicit: true });
  const routed = resolveImplicitRouting([cleared], presetChannelsFor);
  assert.deepEqual(routed[0].sources, []);
  assert.deepEqual(unconstrainedTypes(routed), ["public_rfp"]);
});

test("a key no preset declares is left alone rather than guessed", () => {
  const mine = rule({ type: "my_own_signal", sources: [], sourcesExplicit: false });
  const routed = resolveImplicitRouting([mine], presetChannelsFor);
  assert.deepEqual(routed[0].sources, []);
  assert.deepEqual(unconstrainedTypes(routed), ["my_own_signal"]);
});

test("resolution is driven by the lookup, not by a hardcoded preset", () => {
  const vocab: Vocabulary = [rule({ type: "public_rfp", sources: [], sourcesExplicit: false })];
  const routed = resolveImplicitRouting(vocab, (type) => (type === "public_rfp" ? ["news", "people"] : undefined));
  assert.deepEqual(routed[0].sources, ["news", "people"]);
});

test("an adopted preset is an explicit choice", () => {
  const vocab = presetToVocabulary(nichePreset("data_ai"));
  assert.ok(vocab.length > 0);
  for (const def of vocab) {
    assert.equal(def.sourcesExplicit, true, `${def.type} should not be treated as inherited`);
    // A preset that left a rule reading everything would defeat the point of
    // declaring the routing at all.
    assert.ok(def.sources.length > 0, `${def.type} declares no channels`);
  }
  // Nothing seeded from a preset is unconstrained, so the ingest diagnostic stays
  // quiet until someone clears a rule on purpose.
  assert.deepEqual(unconstrainedTypes(vocab), []);
});

test("every preset rule key has a routing the presets can be inherited from", () => {
  const declared = presetChannelsByType();
  for (const def of presetToVocabulary(nichePreset("devops"))) {
    assert.ok(declared.get(def.type)?.length, `${def.type} is missing from the preset routing map`);
  }
});
