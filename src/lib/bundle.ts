import {
  getAccount,
  getBriefForAccount,
  getContactsForAccount,
  getDraftsForAccount,
  getSignalsForAccount,
} from "./db";
import { scoreAccount } from "./signals";
import type { AccountBundle } from "./types";

export function getBundle(accountId: number): AccountBundle | null {
  const account = getAccount(accountId);
  if (!account) return null;
  const signals = getSignalsForAccount(accountId);
  return {
    account,
    signals,
    contacts: getContactsForAccount(accountId),
    brief: getBriefForAccount(accountId),
    drafts: getDraftsForAccount(accountId),
    score: scoreAccount(account, signals),
  };
}
