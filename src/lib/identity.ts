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
}
