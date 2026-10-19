// A signed-in user, independent of the provider that authenticated them.
//
// The tenant resolver only needs these three facts, so the type lives here rather
// than in the Clerk module: ./tenant.ts stays free of a server-only import, and a
// second provider would implement the same shape without touching it.

export interface Identity {
  /** The provider's stable user id — the key in the `members` table. */
  userId: string;
  email: string | null;
  /** A display name, when the provider knows one. Used to name a new workspace. */
  name?: string;
  /**
   * The company workspace the session is signed in *through*, when it has one.
   *
   * "Sign in with your work account" and "sign in with Google" are both an
   * organization in Clerk: an SSO connection belongs to an org, and an org can
   * be created by any admin. When this is set, the workspace is the org's, not
   * the person's — two colleagues signing in see the same accounts.
   */
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
  /** The provider's role in that org, e.g. `org:admin`. */
  orgRole?: string;
}
