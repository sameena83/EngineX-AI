// Who a request belongs to.
//
// This is the rule that decides whether a deployment can serve at all, that a
// signed-in user gets their own workspace, and that a deployment with sign-in
// enabled never quietly hands one workspace to every visitor. It is a pure
// function of the request's shape precisely so it can be pinned down here instead
// of only by deploying.

import assert from "node:assert/strict";
import test from "node:test";
import { resolveTenantDecision } from "../src/lib/tenant";

test("a signed-in user is served their own workspace", () => {
  for (const nodeEnv of ["production", "development", undefined]) {
    assert.deepEqual(resolveTenantDecision({ identityConfigured: true, hasSession: true, nodeEnv }), {
      kind: "user",
    });
  }
});

test("an identity provider with no session on the request refuses", () => {
  // The dangerous state: keys present, sign-in enforced, but this request has no
  // user. Falling through would serve one shared workspace while the operator
  // believes every visitor is authenticated.
  for (const nodeEnv of ["production", "development", undefined]) {
    const mode = resolveTenantDecision({ identityConfigured: true, nodeEnv });
    assert.equal(mode.kind, "refuse", `${String(nodeEnv)} should refuse`);
    const reason = mode.kind === "refuse" ? mode.reason : "";
    assert.match(reason, /no signed-in user/);
    assert.match(reason, /SINGLE_TENANT_SLUG/);
    assert.doesNotMatch(reason, /not implemented/);
  }
});

test("naming one workspace still works while the identity provider is configured", () => {
  // The explicit opt-in is not silent, so it outranks both the refusal above and
  // a session: that is how a deployment with idle Clerk keys keeps serving one
  // customer, and how a shared demo workspace stays shared on purpose.
  assert.deepEqual(
    resolveTenantDecision({ identityConfigured: true, hasSession: true, singleTenantSlug: "acme" }),
    { kind: "single", slug: "acme" },
  );
});

test("production refuses to guess when nothing is configured", () => {
  const mode = resolveTenantDecision({ nodeEnv: "production" });
  assert.equal(mode.kind, "refuse");
  // The message is the operator's only clue, so it has to name both ways out.
  assert.match(mode.kind === "refuse" ? mode.reason : "", /SINGLE_TENANT_SLUG/);
  assert.match(mode.kind === "refuse" ? mode.reason : "", /CLERK_SECRET_KEY/);
});

test("an explicit slug outranks the environment", () => {
  for (const nodeEnv of ["production", "development", "test", undefined]) {
    const mode = resolveTenantDecision({ singleTenantSlug: "acme", nodeEnv });
    assert.deepEqual(mode, { kind: "single", slug: "acme" });
  }
});

test("the slug is trimmed, and a blank one does not count as configured", () => {
  assert.deepEqual(resolveTenantDecision({ singleTenantSlug: "  acme  " }), {
    kind: "single",
    slug: "acme",
  });
  // Whitespace is how an unset variable in a .env file arrives; treating it as a
  // workspace would be the worst of both worlds.
  assert.equal(
    resolveTenantDecision({ singleTenantSlug: "   ", nodeEnv: "production" }).kind,
    "refuse",
  );
  assert.deepEqual(resolveTenantDecision({ singleTenantSlug: "" }), {
    kind: "development",
    slug: "dev",
  });
});

test("development falls back to a seeded workspace with no configuration", () => {
  assert.deepEqual(resolveTenantDecision({ identityConfigured: false, nodeEnv: "development" }), {
    kind: "development",
    slug: "dev",
  });
  assert.deepEqual(resolveTenantDecision({ nodeEnv: "development" }), {
    kind: "development",
    slug: "dev",
  });
  assert.deepEqual(resolveTenantDecision({ devTenantSlug: "final-check" }), {
    kind: "development",
    slug: "final-check",
  });
  // A blank dev slug still has to produce something, or the app cannot boot.
  assert.deepEqual(resolveTenantDecision({ devTenantSlug: "  " }), {
    kind: "development",
    slug: "dev",
  });
});
