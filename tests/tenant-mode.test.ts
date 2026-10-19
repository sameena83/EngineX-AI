// Who a request without an identity belongs to.
//
// This is the rule that decides whether a deployment can serve at all, and the
// one that must never quietly hand a single workspace to every visitor. It is a
// pure function of the environment precisely so it can be pinned down here
// instead of only by deploying.

import assert from "node:assert/strict";
import test from "node:test";
import { resolveFallbackTenant } from "../src/lib/tenant";

test("an identity provider that resolved nothing refuses rather than sharing a workspace", () => {
  // The adapter is not implemented yet, so CLERK_* present + no session is the
  // state a half-configured deployment lands in. Falling through would serve one
  // workspace to everyone while the operator believes sign-in is enforced.
  for (const nodeEnv of ["production", "development", undefined]) {
    const mode = resolveFallbackTenant({ identityConfigured: true, nodeEnv });
    assert.equal(mode.kind, "refuse", `${String(nodeEnv)} should refuse`);
    const reason = mode.kind === "refuse" ? mode.reason : "";
    assert.match(reason, /CLERK_SECRET_KEY/);
    assert.match(reason, /SINGLE_TENANT_SLUG/);
    assert.match(reason, /development workspace/);
  }
});

test("naming one workspace still works while the identity provider is configured", () => {
  // The explicit opt-in is not silent, so it outranks the refusal above — that is
  // how a deployment with idle Clerk keys keeps serving one customer.
  assert.deepEqual(resolveFallbackTenant({ identityConfigured: true, singleTenantSlug: "acme" }), {
    kind: "single",
    slug: "acme",
  });
});

test("production refuses to guess when nothing is configured", () => {
  const mode = resolveFallbackTenant({ nodeEnv: "production" });
  assert.equal(mode.kind, "refuse");
  // The message is the operator's only clue, so it has to name both ways out.
  assert.match(mode.kind === "refuse" ? mode.reason : "", /SINGLE_TENANT_SLUG/);
  assert.match(mode.kind === "refuse" ? mode.reason : "", /CLERK_SECRET_KEY/);
});

test("an explicit slug outranks the environment", () => {
  for (const nodeEnv of ["production", "development", "test", undefined]) {
    const mode = resolveFallbackTenant({ singleTenantSlug: "acme", nodeEnv });
    assert.deepEqual(mode, { kind: "single", slug: "acme" });
  }
});

test("the slug is trimmed, and a blank one does not count as configured", () => {
  assert.deepEqual(resolveFallbackTenant({ singleTenantSlug: "  acme  " }), {
    kind: "single",
    slug: "acme",
  });
  // Whitespace is how an unset variable in a .env file arrives; treating it as a
  // workspace would be the worst of both worlds.
  assert.equal(resolveFallbackTenant({ singleTenantSlug: "   ", nodeEnv: "production" }).kind, "refuse");
  assert.deepEqual(resolveFallbackTenant({ singleTenantSlug: "" }), {
    kind: "development",
    slug: "dev",
  });
});

test("development falls back to a seeded workspace with no configuration", () => {
  assert.deepEqual(resolveFallbackTenant({ identityConfigured: false, nodeEnv: "development" }), {
    kind: "development",
    slug: "dev",
  });
  assert.deepEqual(resolveFallbackTenant({ nodeEnv: "development" }), {
    kind: "development",
    slug: "dev",
  });
  assert.deepEqual(resolveFallbackTenant({ devTenantSlug: "final-check" }), {
    kind: "development",
    slug: "final-check",
  });
  // A blank dev slug still has to produce something, or the app cannot boot.
  assert.deepEqual(resolveFallbackTenant({ devTenantSlug: "  " }), {
    kind: "development",
    slug: "dev",
  });
});
