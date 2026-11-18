// The arithmetic behind "protect your margin".
//
// One operator key pays for every customer's generation, so two numbers decide
// whether a plan is profitable: what a call cost, and whether a workspace has
// passed its daily ceiling. Both are pure functions of the environment, which is
// what lets them be pinned here rather than discovered on an invoice.
//
// The DB half — that spend is recorded per workspace and summed for the day — is
// in tests/multitenant-isolation.test.ts, because it needs a real database.

import assert from "node:assert/strict";
import test from "node:test";
import {
  costUsd,
  dailyCapUsd,
  dayKey,
  modelFor,
  overCap,
  pricesFromEnv,
} from "../src/lib/ai-usage";

/** Run `fn` with env vars set, restoring whatever was there afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const before = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    before.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("a call costs its input and output tokens at the model's price", () => {
  // gpt-4o-mini: $0.15 per million in, $0.60 per million out.
  assert.equal(costUsd("gpt-4o-mini", 1_000_000, 0), 0.15);
  assert.equal(costUsd("gpt-4o-mini", 0, 1_000_000), 0.6);
  // A realistic brief: ~1.2k in, ~400 out.
  const brief = costUsd("gpt-4o-mini", 1200, 400);
  assert.ok(Math.abs(brief - (1200 / 1e6) * 0.15 - (400 / 1e6) * 0.6) < 1e-12);
});

test("a dated snapshot uses its family's price, not a cheaper family's prefix", () => {
  // The prefix match must be longest-first: "gpt-4o" is a prefix of
  // "gpt-4o-mini-2024-07-18", and using it would overstate the cost by ~16x.
  const mini = costUsd("gpt-4o-mini-2024-07-18", 1_000_000, 0);
  const full = costUsd("gpt-4o", 1_000_000, 0);
  assert.equal(mini, 0.15);
  assert.equal(full, 2.5);
});

test("an unknown model is priced, not ignored", () => {
  // A model nobody taught this table about must still accrue cost: a silent 0
  // would let an unknown model spend without ever moving the cap.
  const unknown = costUsd("some-new-model", 1_000_000, 1_000_000);
  assert.ok(unknown > 0, "unknown models cost something");
});

test("prices can be overridden for a gateway or a negotiated rate", () => {
  withEnv({ AI_PRICE_OVERRIDES: '{"gpt-4o-mini":{"input":1,"output":2}}' }, () => {
    assert.equal(costUsd("gpt-4o-mini", 1_000_000, 0), 1);
    assert.equal(costUsd("gpt-4o-mini", 0, 1_000_000), 2);
  });
  // A malformed override falls back to the defaults instead of throwing: cost
  // tracking must never be what breaks a brief.
  withEnv({ AI_PRICE_OVERRIDES: "{not json" }, () => {
    assert.equal(costUsd("gpt-4o-mini", 1_000_000, 0), 0.15);
  });
});

test("classification can run on a cheaper model than the one that writes", () => {
  withEnv({ ENGINEX_MODEL: "gpt-4.1", ENGINEX_CLASSIFY_MODEL: "gpt-4o-mini" }, () => {
    assert.equal(modelFor("classify"), "gpt-4o-mini");
    assert.equal(modelFor("brief"), "gpt-4.1");
    assert.equal(modelFor("draft"), "gpt-4.1");
    assert.equal(modelFor("review"), "gpt-4.1");
  });

  // Unset classification model means "the same model", not a silent switch.
  withEnv({ ENGINEX_MODEL: "gpt-4.1", ENGINEX_CLASSIFY_MODEL: undefined }, () => {
    assert.equal(modelFor("classify"), "gpt-4.1");
  });
});

test("the daily cap has a documented default and survives a junk value", () => {
  withEnv({ AI_DAILY_USD_CAP: undefined }, () => assert.equal(dailyCapUsd(), 5));
  withEnv({ AI_DAILY_USD_CAP: "12.5" }, () => assert.equal(dailyCapUsd(), 12.5));
  // A typo must not silently remove the ceiling.
  for (const junk of ["", "abc", "0", "-3"]) {
    withEnv({ AI_DAILY_USD_CAP: junk }, () => assert.equal(dailyCapUsd(), 5));
  }
});

test("a workspace is over its cap only once it reaches it", () => {
  assert.equal(overCap(4.99, 5), false);
  assert.equal(overCap(5, 5), true, "reaching the cap stops further model calls");
  assert.equal(overCap(9, 5), true);
  // A non-positive cap disables the ceiling rather than blocking everything —
  // the env parser never produces one, but the predicate must not invert.
  assert.equal(overCap(9, 0), false);
});

test("the day boundary is UTC, so the cap resets at one fixed moment", () => {
  assert.equal(dayKey(new Date("2026-11-18T09:30:00Z")), "2026-11-18");
  // 00:30 in Stockholm on the 19th is still the 18th in UTC: the cap resets on
  // the server's day, whatever the customer's timezone says.
  assert.equal(dayKey(new Date("2026-11-18T23:30:00Z")), "2026-11-18");
  assert.equal(dayKey(new Date("2026-11-19T00:30:00Z")), "2026-11-19");
});

test("the default price table is non-empty and every entry is priced", () => {
  const prices = pricesFromEnv();
  const models = Object.keys(prices);
  assert.ok(models.length >= 3);
  for (const model of models) {
    assert.ok(prices[model].input >= 0 && prices[model].output >= 0, model);
  }
});
