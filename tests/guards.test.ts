// The endpoints that do something a stranger must not be able to do.
//
// Two failures are worth pinning here, because both are silent in production:
// an operator who forgets the secret gets an endpoint that refuses (a 503 they
// will notice), where the alternative — an open reset button on a public URL —
// is invisible until the workspace is empty.

import assert from "node:assert/strict";
import test from "node:test";
import { INGEST_PUSH_GUARD, RESET_GUARD, resolveGuard } from "../src/lib/guards";

const base = { rule: RESET_GUARD, nodeEnv: "development" } as const;

test("with no secret configured, development stays open and production refuses", () => {
  assert.deepEqual(resolveGuard({ ...base, secret: null }), { ok: true });
  // A blank variable is not a configured secret: it would otherwise read as
  // "protected" while accepting an empty header.
  assert.deepEqual(resolveGuard({ ...base, secret: "   " }), { ok: true });

  const prod = resolveGuard({ ...base, secret: null, nodeEnv: "production" });
  assert.equal(prod.ok, false);
  if (prod.ok) return;
  assert.equal(prod.status, 503);
  assert.match(prod.error, /RESET_SECRET/);
  assert.match(prod.error, /x-reset-secret/);
});

test("a configured secret must be presented, in either accepted form", () => {
  const secret = "s3cret";
  assert.deepEqual(resolveGuard({ ...base, secret, headerValue: secret }), { ok: true });
  assert.deepEqual(
    resolveGuard({ ...base, secret, authorization: `Bearer ${secret}` }),
    { ok: true },
  );

  const wrong = resolveGuard({ ...base, secret, headerValue: "nope" });
  assert.equal(wrong.ok, false);
  if (wrong.ok) return;
  // A wrong secret is a 401 wherever it is sent from — including production,
  // where the operator has demonstrably configured the endpoint.
  assert.equal(wrong.status, 401);

  const absent = resolveGuard({ ...base, secret, nodeEnv: "production" });
  assert.equal(absent.ok, false);
  if (absent.ok) return;
  assert.equal(absent.status, 401);
});

test("each rule names its own variable and header", () => {
  assert.notEqual(RESET_GUARD.envVar, INGEST_PUSH_GUARD.envVar);
  assert.notEqual(RESET_GUARD.header, INGEST_PUSH_GUARD.header);
  assert.match(INGEST_PUSH_GUARD.header, /^x-/);
  // Two endpoints sharing one variable would mean rotating one secret locks the
  // other out; the guard's error message is the only place a caller learns which.
  for (const rule of [RESET_GUARD, INGEST_PUSH_GUARD]) {
    const verdict = resolveGuard({ ...base, rule, secret: null, nodeEnv: "production" });
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.error, new RegExp(rule.envVar));
  }
});
