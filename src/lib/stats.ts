import {
  contactedAccountIds,
  getVocabulary,
  listAccounts,
  listOutcomes,
  listSignals,
} from "./db";
import type { OutcomeKind, SignalType } from "./types";
import { definitionFor } from "./vocab";

// The report's core metric: meetings per 50 accounts, tracked per signal type.
// Without this loop the feed is a guess; with it you can tell a customer which
// signals actually produce conversations.

export interface SignalPerformance {
  type: SignalType;
  label: string;
  accounts: number;
  contacted: number;
  replies: number;
  meetings: number;
  /** Meetings per 50 accounts carrying this signal. */
  meetingsPer50: number;
  /** Meetings as a share of contacted accounts, 0..1. */
  meetingRate: number;
}

export interface PerformanceSummary {
  totals: {
    accounts: number;
    contacted: number;
    replies: number;
    meetings: number;
    meetingRate: number;
    meetingsPer50: number;
  };
  bySignal: SignalPerformance[];
}

const MEETING_KINDS: OutcomeKind[] = ["meeting", "won"];

export async function computePerformance(tenantId: number): Promise<PerformanceSummary> {
  const [accounts, signals, outcomes, contacted, vocabulary] = await Promise.all([
    listAccounts(tenantId),
    listSignals(tenantId),
    listOutcomes(tenantId),
    contactedAccountIds(tenantId),
    getVocabulary(tenantId),
  ]);
  // An account counts as contacted if we sent to it OR an outcome was logged for
  // it — logging "meeting booked" implies a conversation happened.
  for (const o of outcomes) contacted.add(o.accountId);

  const signalsByAccount = new Map<number, Set<SignalType>>();
  for (const s of signals) {
    const set = signalsByAccount.get(s.accountId) ?? new Set<SignalType>();
    set.add(s.type);
    signalsByAccount.set(s.accountId, set);
  }

  const outcomeKindsByAccount = new Map<number, Set<OutcomeKind>>();
  for (const o of outcomes) {
    const set = outcomeKindsByAccount.get(o.accountId) ?? new Set<OutcomeKind>();
    set.add(o.kind);
    outcomeKindsByAccount.set(o.accountId, set);
  }

  const hasReply = (accountId: number) =>
    outcomeKindsByAccount.get(accountId)?.has("reply") ?? false;
  const hasMeeting = (accountId: number) =>
    MEETING_KINDS.some((k) => outcomeKindsByAccount.get(accountId)?.has(k)) ?? false;

  // The vocabulary, not a hardcoded list: this table exists so a customer can see
  // which of THEIR signals produce meetings, including ones added after release.
  // Signals stored before a niche switch are listed too, under a neutral label,
  // so their performance history is not silently dropped.
  const tracked = new Map<string, string>(vocabulary.map((d) => [d.type, d.shortLabel]));
  for (const s of signals) {
    if (!tracked.has(s.type)) tracked.set(s.type, definitionFor(vocabulary, s.type).shortLabel);
  }

  const bySignal: SignalPerformance[] = [...tracked].map(([type, label]) => {
    const carrying = accounts.filter((a) => signalsByAccount.get(a.id)?.has(type));
    const carryingContacted = carrying.filter((a) => contacted.has(a.id));
    const replies = carrying.filter((a) => hasReply(a.id)).length;
    const meetings = carrying.filter((a) => hasMeeting(a.id)).length;
    const meetingsContacted = carryingContacted.filter((a) => hasMeeting(a.id)).length;
    const denom = carrying.length || 1;
    return {
      type,
      label,
      accounts: carrying.length,
      contacted: carryingContacted.length,
      replies,
      meetings,
      meetingsPer50: Math.round((meetings / denom) * 50 * 10) / 10,
      meetingRate: carryingContacted.length
        ? Math.round((meetingsContacted / carryingContacted.length) * 100) / 100
        : 0,
    };
  });

  bySignal.sort(
    (a, b) => b.meetingsPer50 - a.meetingsPer50 || b.accounts - a.accounts,
  );

  const repliedAccounts = accounts.filter((a) => hasReply(a.id)).length;
  const meetingAccounts = accounts.filter((a) => hasMeeting(a.id)).length;
  const meetingContacted = accounts.filter(
    (a) => contacted.has(a.id) && hasMeeting(a.id),
  ).length;
  const contactedCount = contacted.size;

  return {
    totals: {
      accounts: accounts.length,
      contacted: contactedCount,
      replies: repliedAccounts,
      meetings: meetingAccounts,
      meetingRate: contactedCount
        ? Math.round((meetingContacted / contactedCount) * 100) / 100
        : 0,
      meetingsPer50: accounts.length
        ? Math.round((meetingAccounts / accounts.length) * 50 * 10) / 10
        : 0,
    },
    bySignal,
  };
}
