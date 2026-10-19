// Perimeter guards for the endpoints a deployment exposes to the internet.
//
// The app serves one named workspace until the identity adapter is wired (see
// ./tenant.ts), so a public URL is reachable by anyone who has it. Most of what
// is behind that URL is read-only, and the parts that write are the price of
// running without sign-in yet. Two endpoints are different in kind, because what
// they do cannot be undone by the customer:
//
//   - POST /api/reset   wipes the workspace the customer is working in.
//   - POST /api/ingest  with a `candidates` body injects unverified items into
//                       the signal feed, where they are ranked as real evidence.
//
// Both are therefore closed in production unless the operator has set the
// matching secret, and open in development, where the demo has to work with no
// configuration at all. Nothing in the UI calls either of them with a body, so
// closing them costs the product nothing.
//
// The decision is a pure function of the environment so it can be tested without
// a server, the same way the tenant fallback rule is (see tests/guards.test.ts).

export interface GuardRule {
  /** The variable that holds the secret, e.g. "RESET_SECRET". */
  envVar: string;
  /** The header a caller may present it in, e.g. "x-reset-secret". */
  header: string;
  /** What a stranger would be doing, phrased for the error a human reads. */
  label: string;
}

export const RESET_GUARD: GuardRule = {
  envVar: "RESET_SECRET",
  header: "x-reset-secret",
  label: "Resetting the workspace",
};

export const INGEST_PUSH_GUARD: GuardRule = {
  envVar: "INGEST_SECRET",
  header: "x-ingest-secret",
  label: "Pushing candidates into the signal feed",
};

export interface GuardInput {
  rule: GuardRule;
  /** The configured secret, or empty when the operator has not set one. */
  secret?: string | null;
  /** The secret as presented, in the two forms the project accepts. */
  headerValue?: string | null;
  authorization?: string | null;
  nodeEnv?: string | null;
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function resolveGuard(input: GuardInput): GuardVerdict {
  const secret = (input.secret ?? "").trim();

  if (secret) {
    if (input.headerValue === secret) return { ok: true };
    if (input.authorization === `Bearer ${secret}`) return { ok: true };
    return { ok: false, status: 401, error: `Bad or missing ${input.rule.header}` };
  }

  // No secret configured. In development that is the documented default — the
  // sample workspace and the demo reset both depend on it. In production it would
  // mean an anonymous visitor can do this, which is not a state to guess into:
  // refuse, and name the variable that resolves it.
  if (input.nodeEnv === "production") {
    return {
      ok: false,
      status: 503,
      error:
        `${input.rule.label} is disabled on this deployment: ${input.rule.envVar} is not set, ` +
        `so the request cannot be authorised. Set ${input.rule.envVar} in the host's ` +
        `environment and send it as the ${input.rule.header} header (or "Authorization: ` +
        `Bearer <value>"), then redeploy.`,
    };
  }

  return { ok: true };
}

/**
 * Apply a rule to a request. Returns a response to send back when the request is
 * refused, or null when it may proceed.
 */
export function secretGuard(request: Request, rule: GuardRule): Response | null {
  const verdict = resolveGuard({
    rule,
    secret: process.env[rule.envVar],
    headerValue: request.headers.get(rule.header),
    authorization: request.headers.get("authorization"),
    nodeEnv: process.env.NODE_ENV,
  });
  if (verdict.ok) return null;
  return Response.json({ error: verdict.error }, { status: verdict.status });
}

/** Whether a rule is closed on this deployment — reported by /api/health. */
export function guardConfigured(rule: GuardRule): boolean {
  return Boolean((process.env[rule.envVar] ?? "").trim());
}
