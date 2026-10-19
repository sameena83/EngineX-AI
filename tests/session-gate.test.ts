// The sign-in gate.
//
// Two mistakes here are expensive and silent. Refusing a machine-facing endpoint
// — the health probe, the scheduler, a scraper pushing candidates — looks like an
// outage, and allowing a page or an API that needs a workspace turns a signed-out
// visitor into a 500. Both are decided by a pure function of the path, so both can
// be pinned here.

import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPath, resolveSessionGate } from "../src/lib/session-gate";

const signedOut = { identityConfigured: true, signedIn: false };
const signedIn = { identityConfigured: true, signedIn: true };

test("with no identity provider nothing is gated", () => {
  // A development install, or the single-workspace deployment: both are deliberate
  // configurations, and refusing here would break the app the README describes.
  for (const pathname of ["/", "/signals", "/api/feed", "/api/drafts/1/send"]) {
    assert.deepEqual(resolveSessionGate({ pathname, identityConfigured: false, signedIn: false }), {
      action: "allow",
    });
  }
});

test("a signed-in user is allowed everywhere", () => {
  for (const pathname of ["/", "/accounts/12", "/api/feed", "/api/reset"]) {
    assert.deepEqual(resolveSessionGate({ ...signedIn, pathname }), { action: "allow" });
  }
});

test("a signed-out visitor is sent to sign-in, and back where they were going", () => {
  assert.deepEqual(resolveSessionGate({ ...signedOut, pathname: "/signals" }), {
    action: "sign-in",
    returnTo: "/signals",
  });
  // The whole point of remembering the path: a shared account link still opens
  // that account after signing in.
  assert.deepEqual(resolveSessionGate({ ...signedOut, pathname: "/accounts/12" }), {
    action: "sign-in",
    returnTo: "/accounts/12",
  });
});

test("a signed-out API caller gets a 401, not a redirect to HTML", () => {
  const decision = resolveSessionGate({ ...signedOut, pathname: "/api/feed" });
  assert.equal(decision.action, "unauthorised");
  // A JSON client that receives a sign-in page reports a parse error instead of
  // "sign in required", which is a worse failure than the status code.
  assert.match(decision.action === "unauthorised" ? decision.error : "", /sign in/i);
});

test("the machine-facing endpoints stay reachable with no session", () => {
  // Each carries its own credential: the probe has none, the scheduler has
  // CRON_SECRET, and a scraper has INGEST_SECRET (which the push path enforces).
  for (const pathname of [
    "/api/health",
    "/api/cron",
    "/api/ingest",
    "/sign-in",
    "/sign-in/sso-callback",
    "/sign-up",
  ]) {
    assert.deepEqual(resolveSessionGate({ ...signedOut, pathname }), { action: "allow" }, pathname);
    assert.equal(isPublicPath(pathname), true, pathname);
  }
});

test("a path that merely looks public is not", () => {
  // Prefix matching must not turn "/sign-in-notes" or "/api/healthy" into an
  // exemption for anyone who guesses the name.
  for (const pathname of ["/sign-in-notes", "/api/healthy", "/api/crons", "/sign-up-later"]) {
    assert.equal(isPublicPath(pathname), false, pathname);
  }

  // A page lookalike is sent to sign-in...
  for (const pathname of ["/sign-in-notes", "/sign-up-later"]) {
    assert.equal(resolveSessionGate({ ...signedOut, pathname }).action, "sign-in", pathname);
  }
  // ...and an API lookalike is refused the way every other API path is, so the
  // exemption can never widen into "anything under /api/ingest…".
  for (const pathname of ["/api/healthy", "/api/crons"]) {
    assert.equal(resolveSessionGate({ ...signedOut, pathname }).action, "unauthorised", pathname);
  }
});
