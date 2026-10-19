// Evidence channels: the vocabulary of a rule, and which of them an item may read.
//
// These are the semantics the whole ingestion path depends on, and until now they
// were only ever checked by hand against a running server — which is how a rule
// can quietly start matching the wrong evidence again after a refactor.

import assert from "node:assert/strict";
import test from "node:test";
import { CHANNELS, asChannels, channelLabel, isChannel, uncoveredChannels } from "../src/lib/channels";
import { nichePreset } from "../src/lib/niches";

test("only real channel names are accepted", () => {
  for (const channel of CHANNELS) assert.equal(isChannel(channel.id), true);
  // A channel no adapter can feed is a rule that can never fire, so it must not
  // be storable — this is what stops the UI writing one.
  for (const bogus of ["", "email", "webz", null, undefined, 42, ["news"]]) {
    assert.equal(isChannel(bogus), false);
  }
});

test("channel lists are filtered and deduplicated", () => {
  assert.deepEqual(asChannels(["news", "news", "tender", "nope"]), ["news", "tender"]);
  assert.deepEqual(asChannels("news"), []);
  assert.deepEqual(asChannels(undefined), []);
});

test("every channel has a human label", () => {
  for (const channel of CHANNELS) {
    assert.ok(channelLabel(channel.id));
    assert.ok(channel.reads.length > 0);
  }
});

test("uncovered channels are the rules the sources cannot reach", () => {
  // A tender rule with only a news feed configured is the case this exists for.
  assert.deepEqual(uncoveredChannels(["tender", "news"], ["news", "job_board"]), ["tender"]);
  assert.deepEqual(uncoveredChannels(["news", "news"], ["news"]), []);
  // A rule with no channels reads everything, so no source can leave it uncovered.
  assert.deepEqual(uncoveredChannels([], ["news"]), []);
  assert.deepEqual(uncoveredChannels(["news"], []), ["news"]);
});

test("the presets only declare channels the app knows", () => {
  for (const preset of [nichePreset("data_ai"), nichePreset("cybersecurity"), nichePreset("devops")]) {
    for (const signal of preset.signals) {
      for (const channel of signal.sources) {
        assert.ok(isChannel(channel), `${preset.key}/${signal.key} declares unknown channel ${channel}`);
      }
    }
  }
});
