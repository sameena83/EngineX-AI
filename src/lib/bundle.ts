import {
  getAccount,
  getBriefForAccount,
  getContactsForAccount,
  getDraftsForAccount,
  getProfile,
  getSignalsForAccount,
  getVocabulary,
} from "./db";
import { scoreAccount } from "./signals";
import type { AccountBundle } from "./types";

/**
 * Everything the account page needs, in one round trip. Scoped to the tenant:
 * an account id belonging to another consultancy simply resolves to null.
 */
export async function getBundle(
  tenantId: number,
  accountId: number,
): Promise<AccountBundle | null> {
  const account = await getAccount(tenantId, accountId);
  if (!account) return null;
  const [signals, contacts, brief, drafts, profile, vocabulary] = await Promise.all([
    getSignalsForAccount(tenantId, accountId),
    getContactsForAccount(tenantId, accountId),
    getBriefForAccount(tenantId, accountId),
    getDraftsForAccount(tenantId, accountId),
    getProfile(tenantId),
    getVocabulary(tenantId),
  ]);
  return {
    account,
    signals,
    contacts,
    brief,
    drafts,
    // The profile is part of scoring now: the same signals rank differently for
    // a platform practice than for a governance one.
    score: scoreAccount(account, signals, vocabulary, profile),
  };
}
