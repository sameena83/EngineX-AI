// The sign-in gate: who may reach a route at all.
//
// The real authorization in this app is the tenant id on every data call (see
// ./db.ts and ./tenant.ts) — but a signed-out visitor should not reach a page
// that will only fail, and an API route should answer 401 rather than 500. This
// is that coarse layer, kept pure so its exemptions can be tested directly
// instead of by deploying (tests/session-gate.test.ts).
//
// Next.js's own guidance is that this must not be the only defence: it runs
// before the request, on every route, and the checks that matter live next to
// the data. Nothing here grants access to a workspace; it only decides whether
// the request is worth handling.

export interface GateInput {
  /** The request path, e.g. "/api/feed". */
  pathname: string;
  /** Whether the identity provider's keys are present. */
  identityConfigured: boolean;
  /** Whether the session resolved to a user. */
  signedIn: boolean;
}

export type GateDecision =
  | { action: "allow" }
  /** Send the browser to sign-in, and back where it was going afterwards. */
  | { action: "sign-in"; returnTo: string }
  /** Answer the API caller: no session, nothing to return. */
  | { action: "unauthorised"; error: string };

/**
 * Paths that stay reachable with no session.
 *
 * Each one is machine-facing or infrastructure, and each carries its own
 * credential instead of a browser session:
 *
 *   /api/health   the host's readiness probe — a probe has no cookie, and an
 *                 unhealthy-looking deployment is worse than a readable one.
 *   /api/cron     the scheduler: it authenticates with CRON_SECRET.
 *   /api/ingest   scrapers and automation platforms push here with
 *                 INGEST_SECRET, and the write path is closed without it.
 *
 * /sign-in and /sign-up must be public or nobody could ever sign in, and
 * Clerk's own /__clerk routes are excluded by the proxy matcher instead.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/api/health", "/api/cron", "/api/ingest"];

/** Pages that exist to be available without a session at all. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function resolveSessionGate(input: GateInput): GateDecision {
  // No identity provider: a development install, or a single-tenant deployment
  // that names its workspace. Both are deliberate configurations, and refusing
  // here would break the app the README tells you how to run.
  if (!input.identityConfigured) return { action: "allow" };
  if (input.signedIn) return { action: "allow" };
  if (isPublicPath(input.pathname)) return { action: "allow" };

  if (input.pathname.startsWith("/api/")) {
    // A 401, not a redirect: an API client that receives HTML for a JSON request
    // reports a parse error instead of "sign in".
    return { action: "unauthorised", error: "Sign in required" };
  }

  return { action: "sign-in", returnTo: input.pathname };
}
