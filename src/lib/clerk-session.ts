// The signed-in identity behind a request.
//
// Kept in its own module because `@clerk/nextjs/server` is a server-only package:
// importing it eagerly would make every module that reaches ./tenant.ts unusable
// outside a Next request — including the test suite, which runs the same sources
// under plain Node. ./tenant.ts therefore imports this lazily, and only when the
// Clerk keys are actually configured.
//
// The session token is read first, because it is already on the request and costs
// nothing. Its claims only carry an email when the instance's JWT template is
// configured to include one, so the profile is fetched from Clerk at most once per
// user per process instead of on every request.

import type { Identity } from "./identity";

export async function readSession(): Promise<Identity | null> {
  const { auth } = await import("@clerk/nextjs/server");
  // The organization fields are read defensively: they only exist on a session
  // that is signed in through an organization (an SSO connection, or an org the
  // user selected), and a Clerk upgrade should not break resolution if the shape
  // of `auth()` moves.
  const session = (await auth()) as unknown as {
    userId: string | null;
    sessionClaims?: Record<string, unknown> | null;
    orgId?: string | null;
    orgSlug?: string | null;
    orgRole?: string | null;
    orgName?: string | null;
  };
  const { userId } = session;
  if (!userId) return null;

  const claims = (session.sessionClaims ?? {}) as Record<string, unknown>;
  const org = {
    orgId: session.orgId ?? firstString(claims, ["org_id", "organization_id"]),
    orgSlug: session.orgSlug ?? firstString(claims, ["org_slug"]),
    orgName: session.orgName ?? firstString(claims, ["org_name", "organization_name"]),
    orgRole: session.orgRole ?? firstString(claims, ["org_role"]),
  };

  const email = firstString(claims, ["email", "email_address", "primary_email_address"]);
  const name = firstString(claims, ["name", "full_name", "fullName"]);
  if (email) return { userId, email, name, ...org };

  const cached = profileCache.get(userId);
  if (cached) return { userId, ...cached, ...org };

  const { currentUser } = await import("@clerk/nextjs/server");
  const user = await currentUser().catch(() => null);
  const profile = {
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    name: user?.fullName ?? user?.firstName ?? undefined,
  };
  // A failed lookup is cached too: a Clerk outage should not turn into one API
  // call per request for the rest of the process's life.
  profileCache.set(userId, profile);
  return { userId, ...profile, ...org };
}

const profileCache = new Map<string, { email: string | null; name?: string }>();

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
