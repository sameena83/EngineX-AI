// Accounts won, over time.
//
// The dashboard already answers "how are we doing right now"; this module
// answers "how are we trending" — the same outcome data bucketed by week, by
// month and by year, with the period-over-period change.

import { contactedAccountIds, listOutcomes } from "./db";
import type { Outcome, OutcomeKind } from "./types";

export type Granularity = "weekly" | "monthly" | "yearly";

export interface WonBucket {
  /** Stable key for the bucket, e.g. 2026-10-06 / 2026-10 / 2026. */
  key: string;
  label: string;
  /** ISO date the bucket starts at. */
  start: string;
  end: string;
  /** Distinct accounts whose first "won" landed in this bucket. */
  won: number;
  /** Accounts that reached "meeting" (or "won") in this bucket. */
  meetings: number;
  replies: number;
  contacted: number;
  /** Won accounts in this bucket plus everything before it. */
  cumulative: number;
}

export interface WonAnalytics {
  granularity: Granularity;
  buckets: WonBucket[];
  totals: {
    won: number;
    meetings: number;
    replies: number;
    contacted: number;
    /** Won as a share of contacted accounts, 0..1. */
    winRate: number;
  };
  /** Current bucket vs the one before it, and the same span one period earlier. */
  current: {
    label: string;
    won: number;
    meetings: number;
    previousWon: number;
    change: number;
  };
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  // Monday-first weeks, matching how a partner reads a pipeline review.
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  return out;
}

function startOfMonth(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  out.setDate(1);
  return out;
}

function startOfYear(d: Date): Date {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  out.setMonth(0, 1);
  return out;
}

function addWeeks(d: Date, n: number): Date {
  // Calendar-based, not fixed milliseconds: a fixed week across a daylight-saving
  // boundary lands at 23:00 or 01:00 and drifts the bucket boundary.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7);
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() + n);
  return out;
}

function label(bucketStart: Date, granularity: Granularity): string {
  if (granularity === "weekly") {
    return bucketStart.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  if (granularity === "monthly") {
    return bucketStart.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return String(bucketStart.getFullYear());
}

/**
 * Every bucket boundary for the window, oldest first. Week and month are fixed
 * windows (the last 12, so the chart stays readable); the yearly view runs from
 * the first recorded activity, which is what makes it the historical view.
 */
function bucketStarts(granularity: Granularity, earliest: Date, now: Date): Date[] {
  const starts: Date[] = [];
  if (granularity === "weekly") {
    const current = startOfWeek(now);
    for (let n = 11; n >= 0; n--) starts.push(addWeeks(current, -n));
    return starts;
  }
  if (granularity === "monthly") {
    const current = startOfMonth(now);
    for (let n = 11; n >= 0; n--) starts.push(addMonths(current, -n));
    return starts;
  }
  const current = startOfYear(now);
  for (let d = startOfYear(earliest); d.getTime() <= current.getTime(); d = addMonths(d, 12)) {
    starts.push(new Date(d.getTime()));
  }
  return starts;
}

function bucketEnd(granularity: Granularity, start: Date): Date {
  if (granularity === "weekly") return addWeeks(start, 1);
  if (granularity === "monthly") return addMonths(start, 1);
  return addMonths(start, 12);
}

function isMilestone(kind: OutcomeKind): boolean {
  return kind === "meeting" || kind === "won";
}

/**
 * Count accounts won, bucketed by when each account was *first* won — a won deal
 * belongs to the period it closed in, and double-logging it must not count twice.
 */
export function computeWonAnalytics(
  granularity: Granularity,
  now = new Date(),
  outcomes = listOutcomes(),
  contacted = contactedAccountIds(),
): WonAnalytics {
  const withDates = outcomes.map((o: Outcome & { accountName?: string }) => ({
    ...o,
    at: new Date(o.occurredAt),
  }));

  const earliest =
    withDates.length > 0
      ? new Date(Math.min(...withDates.map((o) => o.at.getTime())))
      : now;

  const wonByAccount = new Map<number, number>();
  for (const o of withDates) {
    if (o.kind !== "won") continue;
    const ts = o.at.getTime();
    const previous = wonByAccount.get(o.accountId);
    if (previous === undefined || ts < previous) wonByAccount.set(o.accountId, ts);
  }

  const starts = bucketStarts(granularity, earliest, now);
  let running = 0;
  const buckets: WonBucket[] = starts.map((start) => {
    const end = bucketEnd(granularity, start);
    const inBucket = (ts: number) => ts >= start.getTime() && ts < end.getTime();

    // Accounts whose first win falls in this bucket.
    const wonAccounts = new Set<number>();
    for (const [accountId, ts] of wonByAccount) if (inBucket(ts)) wonAccounts.add(accountId);
    running += wonAccounts.size;

    const meetings = new Set<number>();
    const replies = new Set<number>();
    for (const o of withDates) {
      if (!inBucket(o.at.getTime())) continue;
      if (isMilestone(o.kind)) meetings.add(o.accountId);
      if (o.kind === "reply") replies.add(o.accountId);
    }

    return {
      key: start.toISOString().slice(0, granularity === "yearly" ? 4 : granularity === "monthly" ? 7 : 10),
      label: label(start, granularity),
      start: start.toISOString(),
      end: end.toISOString(),
      won: wonAccounts.size,
      meetings: meetings.size,
      replies: replies.size,
      // Contact volume is tracked per account overall, not per period, so it is
      // reported once in the totals rather than invented per bucket.
      contacted: 0,
      cumulative: running,
    };
  });

  const totalWon = [...wonByAccount.keys()].length;
  const last = buckets[buckets.length - 1];
  const previous = buckets[buckets.length - 2];

  return {
    granularity,
    buckets,
    totals: {
      won: totalWon,
      meetings: new Set(withDates.filter((o) => isMilestone(o.kind)).map((o) => o.accountId)).size,
      replies: new Set(withDates.filter((o) => o.kind === "reply").map((o) => o.accountId)).size,
      contacted: contacted.size,
      winRate: contacted.size ? Math.round((totalWon / contacted.size) * 100) / 100 : 0,
    },
    current: {
      label: last?.label ?? "",
      won: last?.won ?? 0,
      meetings: last?.meetings ?? 0,
      previousWon: previous?.won ?? 0,
      change: (last?.won ?? 0) - (previous?.won ?? 0),
    },
  };
}

export function computeAllWonAnalytics(now = new Date()) {
  const outcomes = listOutcomes();
  const contacted = contactedAccountIds();
  const views: Record<Granularity, WonAnalytics> = {
    weekly: computeWonAnalytics("weekly", now, outcomes, contacted),
    monthly: computeWonAnalytics("monthly", now, outcomes, contacted),
    yearly: computeWonAnalytics("yearly", now, outcomes, contacted),
  };
  return {
    ...views,
    generatedAt: now.toISOString(),
    hasData: outcomes.length > 0,
  };
}
