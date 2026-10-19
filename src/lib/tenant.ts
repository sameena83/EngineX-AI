// Tenant resolution: turns "who is making this request" into a tenant id.
//
// The data layer requires a tenant id on every call (see ./db.ts). This module is
// the single place that decides which tenant a request belongs to, so the identity
// provider is swappable and every route resolves it the same way.
//
// Identity provider: Clerk, configured via CLERK_SECRET_KEY +
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. A signed-in user is mapped to a workspace
// through the `members` table, and a first-time user gets their own workspace with
// the sample market seeded — that mapping is the whole of multi-tenancy here. Two
// users of the same deployment never share a tenant id unless a row in `members`
// says they do.
//
// When there is no signed-in user, `resolveTenantDecision` below is the entire
// rule, in order:
//
//   1. SINGLE_TENANT_SLUG is set — this deployment serves that one named
//      workspace, in any environment. It is an explicit statement that one
//      customer (or a self-hosted install) owns the deployment, which is what
//      makes a production run possible without an identity provider. Every
//      request is logged once as sharing that workspace.
//   2. a session resolved — that user's workspace (the multi-tenant case; see
//      above). A tenant can be shared by several users, since `members` allows
//      it, but every request is scoped to the tenant the session maps to.
//   3. the identity provider IS configured but this request has no session —
//      refuse. Serving a fallback here would hand one workspace to every visitor
//      while the operator believes sign-in is enforced.
//   4. otherwise in production — refuse, loudly. Never quietly hand one
//      workspace to every visitor because a key was missing.
//   5. otherwise in development — the seeded development tenant, so the app still
//      runs with no configuration at all.
//
// The rule is a pure function of the environment so it can be tested directly
// (tests/tenant-mode.test.ts) rather than only by running a deployment.

import {
  findOrCreateTenant,
  getTenantBySlug,
  seedTenant,
  tenantsForUser,
  upsertMember,
} from "./db";
import { UnauthenticatedError } from "./errors";
import type { Identity } from "./identity";
import type { Tenant } from "./types";

/** The dev fallback's workspace slug, when nothing else is configured. */
const DEFAULT_DEV_TENANT_SLUG = "dev";

export function identityConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export type TenantDecision =
  /** A signed-in user: the workspace their `members` row points at. */
  | { kind: "user" }
  | { kind: "single"; slug: string }
  | { kind: "development"; slug: string }
  | { kind: "refuse"; reason: string };

/**
 * Which workspace serves a request, given what it carries.
 *
 * Pure, and deliberately boring: the only interesting decisions are that an
 * explicit slug outranks everything, that a session gets its own user's
 * workspace, and that a deployment with sign-in enabled never guesses.
 */
export function resolveTenantDecision(input: {
  /** Whether the CLERK_* variables are present. */
  identityConfigured?: boolean;
  /** Whether this request resolved a signed-in user. */
  hasSession?: boolean;
  singleTenantSlug?: string | null;
  devTenantSlug?: string | null;
  nodeEnv?: string | null;
}): TenantDecision {
  const single = (input.singleTenantSlug ?? "").trim();
  if (single) return { kind: "single", slug: single };

  if (input.hasSession) return { kind: "user" };

  if (input.identityConfigured) {
    return {
      kind: "refuse",
      reason:
        "This request has no signed-in user. Sign in to reach a workspace, or — if this " +
        "deployment is meant to serve one customer without sign-in — set SINGLE_TENANT_SLUG " +
        "to name that workspace. Refusing to fall back to a shared workspace while " +
        "authentication is enforced.",
    };
  }

  if (input.nodeEnv === "production") {
    return {
      kind: "refuse",
      reason:
        "No identity provider configured: set CLERK_SECRET_KEY and " +
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to serve each user their own workspace, or set " +
        "SINGLE_TENANT_SLUG to name the one workspace this deployment serves. Refusing to " +
        "fall back to a shared development tenant in production.",
    };
  }

  return { kind: "development", slug: (input.devTenantSlug ?? "").trim() || DEFAULT_DEV_TENANT_SLUG };
}

/** What this deployment is configured to be, independent of any one request. */
export type DeploymentMode = "multi" | "single" | "development" | "refuse";

export function deploymentMode(): DeploymentMode {
  const single = (process.env.SINGLE_TENANT_SLUG ?? "").trim();
  if (single) return "single";
  if (identityConfigured()) return "multi";
  if (process.env.NODE_ENV === "production") return "refuse";
  return "development";
}

/**
 * Why this deployment cannot serve, when it cannot.
 *
 * Readiness needs the reason, not just the verdict: an operator staring at a 503
 * should see which variable is missing rather than having to reproduce the
 * request that failed.
 */
export function deploymentRefusal(): string | null {
  const decision = resolveTenantDecision(DECISION_ENV());
  return decision.kind === "refuse" ? decision.reason : null;
}

const DECISION_ENV = () => ({
  identityConfigured: identityConfigured(),
  singleTenantSlug: process.env.SINGLE_TENANT_SLUG,
  devTenantSlug: process.env.DEV_TENANT_SLUG,
  nodeEnv: process.env.NODE_ENV,
});

/**
 * The signed-in identity, or null when there is none to resolve.
 *
 * Clerk is imported lazily for two reasons: `@clerk/nextjs/server` is a
 * server-only package, and this module is imported by the test suite under plain
 * Node; and a deployment without Clerk keys never pays for the import at all.
 */
async function currentUserId(): Promise<Identity | null> {
  if (!identityConfigured()) return null;
  const { readSession } = await import("./clerk-session");
  return readSession();
}

/** Find or create the tenant a signed-in user works in. */
export async function ensureUserTenant(
  userId: string,
  email: string | null,
  opts: { name?: string } = {},
): Promise<Tenant> {
  const existing = await tenantsForUser(userId);
  if (existing.length > 0) {
    // Already a member of a workspace — that is their active tenant. The update
    // keeps an email the provider has since stopped returning.
    await upsertMember({ tenantId: existing[0].id, userId, email });
    return existing[0];
  }

  // First sign-in: give this user their own workspace. The slug has to be unique
  // and human-readable, so it is derived from the user id — two users cannot
  // collide on it, and it does not leak an email address into a URL.
  const slug = `t-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(-20).toLowerCase()}`;
  const tenant = await findOrCreateTenant({
    slug,
    name: opts.name ?? email?.split("@")[0] ?? "My workspace",
  });
  await upsertMember({ tenantId: tenant.id, userId, email, role: "owner" });
  return tenant;
}

/** A slug-named workspace: created and seeded on first use. */
async function seededTenantId(slug: string, name: string): Promise<number> {
  const existing = await getTenantBySlug(slug);
  if (existing) {
    // Seeding is idempotent, so this is a no-op after the first run.
    await seedTenant(existing.id);
    return existing.id;
  }
  const tenant = await findOrCreateTenant({ slug, name });
  return tenant.id;
}

let warnedAboutSharedTenant = false;

/**
 * Say once, loudly, that this deployment has no per-user isolation.
 *
 * Silence here would be the dangerous part: a single-tenant deployment looks
 * exactly like an authenticated one from the outside.
 */
function warnSharedWorkspace(slug: string): void {
  if (warnedAboutSharedTenant) return;
  warnedAboutSharedTenant = true;
  console.warn(
    `[tenant] SINGLE_TENANT_SLUG=${slug}: every request is served the workspace "${slug}" ` +
      `with no per-user isolation. Serve this deployment to one customer only.`,
  );
}

/**
 * The tenant this request operates on. Every route handler resolves it through
 * here rather than trusting a client-supplied id — which is what makes a
 * cross-tenant id in a URL return nothing rather than someone else's rows.
 */
export async function currentTenantId(): Promise<number> {
  const identity = await currentUserId();
  const decision = resolveTenantDecision({ ...DECISION_ENV(), hasSession: Boolean(identity) });

  switch (decision.kind) {
    case "user": {
      // The decision says "user" only because a session resolved above.
      if (!identity) throw new UnauthenticatedError("Sign in required");
      const tenant = await ensureUserTenant(identity.userId, identity.email, {
        name: identity.name,
      });
      return tenant.id;
    }
    case "single":
      warnSharedWorkspace(decision.slug);
      return seededTenantId(decision.slug, `${decision.slug} workspace`);
    case "development":
      return seededTenantId(decision.slug, "Development workspace");
    case "refuse":
      // A deployment that has sign-in configured but no session is an
      // authentication failure (401); anything else here is a misconfiguration
      // the operator has to fix (500), and the message says which.
      if (identityConfigured()) throw new UnauthenticatedError(decision.reason);
      throw new Error(decision.reason);
  }
}
