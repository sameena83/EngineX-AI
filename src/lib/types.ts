// Core domain types for EngineX AI.
// The product is a signal-based pipeline engine: it finds companies showing a
// specific need *right now* and hands a boutique consultancy a short list of
// researched accounts with drafted outreach.

export type SignalType =
  | "data_hiring_no_leadership"
  | "new_data_leader"
  | "platform_adoption"
  | "funding_ma"
  | "public_rfp";

export interface SignalDefinition {
  type: SignalType;
  label: string;
  shortLabel: string;
  /** Base strength 0..1 — how much this signal alone implies a live need. */
  weight: number;
  why: string;
}

export interface ServiceLine {
  id: string;
  name: string;
  description: string;
}

export interface CaseStudy {
  id: string;
  client: string;
  sector: string;
  problem: string;
  outcome: string;
  serviceLineId: string;
}

export interface Profile {
  companyName: string;
  website: string;
  headcount: string;
  region: string;
  services: ServiceLine[];
  idealClient: {
    sector: string;
    sizeMin: number;
    sizeMax: number;
    region: string;
    description: string;
  };
  caseStudies: CaseStudy[];
  tone: "concise" | "consultative" | "direct";
  length: "short" | "medium" | "long";
  /** Privacy: chat digests can include contact details or company-level only. */
  digestIncludesContacts: boolean;
  /**
   * How accounts reach the partner's chat tools. The report specifies a weekly
   * digest *and* strong-signal alerts, so these are two different urgency levels:
   * the digest is a scheduled summary, an alert is one account worth acting on now.
   */
  delivery: {
    digestCadence: "off" | "daily" | "weekly";
    /** Accounts at or above this score get an immediate alert. 0 disables alerts. */
    alertMinScore: number;
    /** How many accounts the weekly digest includes. */
    digestSize: number;
  };
  /** Identity outreach is sent from, once the customer enables direct sending. */
  sender: {
    name: string;
    email: string;
    replyTo: string;
  };
}

export interface Account {
  id: number;
  name: string;
  domain: string;
  sector: string;
  employees: number;
  location: string;
  description: string;
  /** Pipeline status of the account in the consultancy's workflow. */
  status: "new" | "approved" | "dismissed";
}

export interface Signal {
  id: number;
  accountId: number;
  type: SignalType;
  summary: string;
  evidence: string;
  source: string;
  sourceUrl: string | null;
  detectedAt: string;
  strength: number;
}

export interface Contact {
  id: number;
  accountId: number;
  name: string;
  title: string;
  email: string;
  emailStatus: "verified" | "likely" | "unverified";
  provider: string;
  linkedinUrl: string | null;
  isDecisionMaker: boolean;
}

export interface Brief {
  id: number;
  accountId: number;
  whyNow: string;
  likelyPain: string;
  caseStudyAngle: string;
  whoToContact: string;
  generatedBy: "llm" | "template";
  createdAt: string;
}

export type DraftChannel = "email" | "linkedin" | "warm_intro";

export interface Draft {
  id: number;
  accountId: number;
  channel: DraftChannel;
  subject: string | null;
  body: string;
  tone: string;
  length: string;
  status: "draft" | "approved" | "dismissed";
  generatedBy: "llm" | "template";
  createdAt: string;
}

export type IntegrationKind = "slack" | "teams" | "make" | "zapier";

export interface Integration {
  id: number;
  kind: IntegrationKind;
  label: string;
  url: string;
  enabled: boolean;
  /** Which events this destination receives: "digest", "account_card", "send_log". */
  events: string[];
}

/**
 * A signal a human marked as wrong. The signal itself is removed so it stops
 * counting towards the score, but its evidence is kept here: the point of the
 * verdict is to record what the engine got wrong, not to hide it.
 */
export interface SignalCorrection {
  id: number;
  signalId: number;
  accountId: number;
  type: SignalType;
  summary: string;
  evidence: string;
  source: string;
  sourceUrl: string | null;
  reason: string | null;
  createdAt: string;
}

export type OutcomeKind = "reply" | "meeting" | "won" | "no_response";

/** What came of an account after outreach — the signal→meeting feedback loop. */
export interface Outcome {
  id: number;
  accountId: number;
  kind: OutcomeKind;
  note: string | null;
  occurredAt: string;
}

export interface SendRecord {
  id: number;
  accountId: number;
  draftId: number;
  toEmail: string;
  subject: string;
  body: string;
  provider: string;
  status: "sent" | "failed" | "dry_run";
  error: string | null;
  createdAt: string;
}

/** A ranked account in the weekly signal feed. */
export interface ScoredAccount {
  account: Account;
  score: number;
  tier: "very_strong" | "strong" | "moderate" | "weak";
  signals: Signal[];
  contributions: { type: SignalType; label: string; points: number }[];
  topSignal: Signal | null;
}

export interface AccountBundle {
  account: Account;
  signals: Signal[];
  contacts: Contact[];
  brief: Brief | null;
  drafts: Draft[];
  score: ScoredAccount | null;
}
