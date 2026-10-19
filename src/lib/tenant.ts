// Tenant resolution: turns "who is making this request" into a tenant id.
//
// The data layer requires a tenant id on every call (see ./db.ts). This module
// is the single place that decides which tenant a request belongs to, so the
// identity provider is swappable and every route resolves it the same way.
//
// Identity provider: Clerk, configured via CLERK_SECRET_KEY +
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. The signed-in user is mapped to a tenant
// through the `members` table, and a first-time user gets their own tenant with
// the sample market seeded.
//
// When Clerk is NOT configured there are three cases, and `resolveFallbackTenant`
// below is the whole of the rule:
//
//   1. SINGLE_TENANT_SLUG is set — this deployment serves that one named
//      workspace, in any environment. It is an explicit statement that one
//      customer (or a self-hosted install) owns the deployment, which is what
//      makes a production run possible at all before the identity provider is
//      wired. Every request is logged at startup as sharing that workspace.
//   2. otherwise, if the identity provider IS configured but no signed-in user
//      resolved — refuse. The adapter is not implemented yet, so this is the
//      state a half-configured deployment lands in, and falling back here would
//      serve a shared workspace to everyone while the operator believes auth is
//      on. Unsetting the CLERK_* variables, or naming a single workspace, is a
//      deliberate way out.
//   3. otherwise in production — refuse, loudly. Never quietly hand one
//      workspace to every visitor because a key was missing.
//   4. otherwise in development — the seeded development tenant, so the app
//      still runs with no configuration at all.
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
import type { Tenant } from "./types";

/** The dev fallback's workspace slug, when nothing else is configured. */
const DEFAULT_DEV_TENANT_SLUG = "dev";

export function identityConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export type FallbackTenant =
  | { kind: "single"; slug: string }
  | { kind: "development"; slug: string }
  | { kind: "refuse"; reason: string };

/**
 * Which workspace serves a request that carries no resolved identity.
 *
 * Pure, and deliberately boring: the only interesting decisions are that an
 * explicit slug outranks the environment, and that production refuses rather
 * than guesses.
 */
export function resolveFallbackTenant(input: {
  /** Whether the CLERK_* variables are present. */
  identityConfigured?: boolean;
  singleTenantSlug?: string | null;
  devTenantSlug?: string | null;
  nodeEnv?: string | null;
}): FallbackTenant {
  const single = (input.singleTenantSlug ?? "").trim();
  if (single) return { kind: "single", slug: single };

  if (input.identityConfigured) {
    // Configured but unresolved. Do not guess: this is the one state where a
    // silent fallback would hand one workspace to everyone who can reach the
    // URL while the operator reasonably believes sign-in is enforced.
    return {
      kind: "refuse",
      reason:
        "An identity provider is configured but no signed-in user could be resolved: the " +
        "Clerk adapter in currentUserId() is not implemented yet. Refusing to serve a shared " +
        "workspace while authentication appears to be on — unset CLERK_SECRET_KEY and " +
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to use the development workspace, or set " +
        "SINGLE_TENANT_SLUG to name the one workspace this deployment serves.",
    };
  }

  if (input.nodeEnv === "production") {
    return {
      kind: "refuse",
      reason:
        "No identity provider configured: set CLERK_SECRET_KEY and " +
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, or set SINGLE_TENANT_SLUG to name the " +
        "one workspace this deployment serves. Refusing to fall back to a shared " +
        "development tenant in production.",
    };
  }

  return { kind: "development", slug: (input.devTenantSlug ?? "").trim() || DEFAULT_DEV_TENANT_SLUG };
}

const FALLBACK_ENV = () => ({
  identityConfigured: identityConfigured(),
  singleTenantSlug: process.env.SINGLE_TENANT_SLUG,
  devTenantSlug: process.env.DEV_TENANT_SLUG,
  nodeEnv: process.env.NODE_ENV,
});

/**
 * The same decision, read off the live environment.
 *
 * Exported so a deployment can be asked what it would do before a request is
 * made against it — the readiness endpoint reports this, which is how a host
 * tells "this instance cannot serve data at all" from "the database died".
 */
export function configuredTenant(): FallbackTenant {
  return resolveFallbackTenant(FALLBACK_ENV());
}

/**
 * The signed-in identity, or null when no provider is configured.
 *
 * Clerk is wired in the auth step; until then this returns null so the dev
 * fallback below applies rather than this throwing on every request.
 */
async function currentUserId(): Promise<{ userId: string; email: string | null } | null> {
  if (!identityConfigured()) return null;
  return null;
}

/** Find or create the tenant a signed-in user works in. */
export async function ensureUserTenant(
  userId: string,
  email: string | null,
  opts: { name?: string } = {},
): Promise<Tenant> {
  const existing = await tenantsForUser(userId);
  if (existing.length > 0) {
    // Already a member of a workspace — that is their active tenant.
    await upsertMember({ tenantId: existing[0].id, userId, email });
    return existing[0];
  }

  // First sign-in: give this user their own workspace. The slug has to be
  // unique and human-readable, so it is derived from the user id.
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
 * here rather than trusting a client-supplied id.
 */
export async function currentTenantId(): Promise<number> {
  const identity = await currentUserId();

  if (identity) {
    const tenant = await ensureUserTenant(identity.userId, identity.email);
    return tenant.id;
  }

  const fallback = resolveFallbackTenant(FALLBACK_ENV());
  switch (fallback.kind) {
    case "single":
      warnSharedWorkspace(fallback.slug);
      return seededTenantId(fallback.slug, `${fallback.slug} workspace`);
    case "development":
      return seededTenantId(fallback.slug, "Development workspace");
    case "refuse":
      throw new Error(fallback.reason);
  }
}
