import type { Channel } from "./channels";

export type { Channel };

// Core domain types for EngineX AI.
// The product is a signal-based pipeline engine: it finds companies showing a
// specific need *right now* and hands a boutique consultancy a short list of
// researched accounts with drafted outreach.

/**
 * A tenant is one paying consultancy — the isolation boundary. Every row of
 * workspace data belongs to exactly one tenant, and every query filters on it.
 */
export interface Tenant {
  id: number;
  slug: string;
  name: string;
  /** Billing plan, written only by the Stripe webhook. */
  plan: "trial" | "starter" | "pro";
  /** Which market this tenant sells into (Phase 3 expands on this). */
  market: string;
  createdAt: string;
}

/** Ties an identity-provider user to a tenant. A user may have several. */
export interface Member {
  id: number;
  tenantId: number;
  /** The identity provider's user id (e.g. Clerk's `user_...`). */
  userId: string;
  email: string | null;
  role: "owner" | "member";
  createdAt: string;
}

/**
 * A signal type key. Deliberately open: the vocabulary is per-tenant data (see
 * ./niches.ts and the signal_definitions table), not a fixed union, so a
 * consultancy outside data & AI gets its own signals without a code change.
 */
export type SignalType = string;

/** One signal type as configured for a tenant. */
export interface SignalDefinition {
  type: SignalType;
  label: string;
  shortLabel: string;
  /** Base strength 0..1 — how much this signal alone implies a live need. */
  weight: number;
  why: string;
  /** Regex sources the rule classifier compiles. Empty for a display-only type. */
  patterns: string[];
  /** Matched against the consultancy's service names and descriptions. */
  serviceKeywords: string[];
  /**
   * The evidence channels this rule reads (see ./channels.ts).
   *
   * A tender pattern run against press coverage invents opportunities that were
   * never there, so a rule is only ever matched against items from a channel it
   * declares. Empty means every channel: the tolerant default that keeps a
   * hand-written rule, or one stored under an earlier vocabulary, in the pipeline.
   */
  sources: Channel[];
  /**
   * Whether `sources` was chosen deliberately (by the customer, or by the preset
   * they adopted) rather than inherited.
   *
   * This exists for the rows migration 5 created with an empty channel list: those
   * predate the column, so nothing recorded what the rule should read. Absent or
   * false means "follow the preset for this rule key", which is what routes them
   * without guessing, and it is what an empty list means only once a customer has
   * cleared it on purpose. See `resolveImplicitRouting` in ./vocab.ts.
   */
  sourcesExplicit?: boolean;
}

/** A tenant's whole signal vocabulary, supplied to classification and scoring. */
export type Vocabulary = SignalDefinition[];

/**
 * A phrase that disqualifies a source item even when a signal rule matched.
 *
 * The important counterweight to the positive rules: a keyword like "security"
 * or "AI" matches a great deal of noise, and most of it is a vendor's own
 * marketing. These rules are what keep a noisy niche from filling the feed.
 */
export interface NegativeRule {
  label: string;
  patterns: string[];
}

/**
 * The half of a niche that is not the signal vocabulary: who to approach, what
 * to ignore, and how strongly to weight fit and freshness.
 *
 * Stored per tenant so a consultancy can retarget its own workspace — the point
 * of the niche profile is that changing market is configuration, not a release.
 */
export interface NicheConfig {
  /** Preset this was seeded from, kept so a user can see where they started. */
  key: string;
  label: string;
  description: string;
  /** Roles to approach first, used in briefs and drafts. */
  buyerRoles: string[];
  /** Phrases that disqualify a source item even when a signal matched. */
  negativeRules: NegativeRule[];
  /** Phrases that disqualify a company outright (competitors, non-buyers). */
  exclusions: string[];
  scoring: {
    /** Points a perfect market fit contributes to the 0-100 score. */
    fitPoints: number;
    /** Days over which a signal's influence halves. Lower = stricter recency. */
    halfLifeDays: number;
  };
  /** One line the copywriter works from. */
  outreachAngle: string;
  /** Default source queries, used until a source overrides them. */
  sourceQueries: string[];
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
  /** Which niche preset this workspace started from (e.g. "cybersecurity"). */
  niche: string;
  /** The editable niche profile: buyers, exclusions, scoring, source queries. */
  nicheConfig: NicheConfig;
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
  /** When the event itself happened, from the source's own timestamp. */
  eventAt: string;
  /** When EngineX first saw it. Different fact, and both are shown. */
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

export type IntegrationKind = "slack" | "teams" | "make" | "zapier" | "hubspot";

export interface Integration {
  id: number;
  kind: IntegrationKind;
  label: string;
  /**
   * Webhook URL for the webhook kinds; empty for an API integration like HubSpot,
   * whose credentials are deployment-wide environment variables and whose only
   * per-tenant state is the `settings` below.
   */
  url: string;
  enabled: boolean;
  /** Which events this destination receives: "digest", "account_card", "send_log". */
  events: string[];
  /**
   * Integration-specific options, so a new destination does not need a column.
   * For HubSpot: `pipelineId`, `dealStageId`, `createDeals`.
   */
  settings?: Record<string, unknown>;
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

/** One dimension of "does this opportunity suit this consultancy". */
export interface FitFactor {
  /** 0..1 for this dimension. */
  score: number;
  /** Whether this dimension is an acceptable match. */
  ok: boolean;
  /** Plain-language explanation, shown in the UI. */
  reason: string;
}

/**
 * How well an account matches the consultancy's stated target market: the
 * services it sells, the industries it targets and the company size it wants.
 */
export interface FitResult {
  /** 0..1 overall. */
  score: number;
  /** "in" = clear match, "borderline" = worth a look, "out" = clear mismatch. */
  gate: "in" | "borderline" | "out";
  industry: FitFactor;
  size: FitFactor;
  region: FitFactor;
  services: FitFactor;
  /** Profile service names this opportunity lines up with. */
  matchedServices: string[];
  /** The exclusion term this company matched, if any — a competitor or non-buyer. */
  exclusion: string | null;
  summary: string;
}

/** A ranked account in the weekly signal feed. */
export interface ScoredAccount {
  account: Account;
  score: number;
  tier: "very_strong" | "strong" | "moderate" | "weak";
  signals: Signal[];
  contributions: { type: SignalType; label: string; points: number }[];
  topSignal: Signal | null;
  /** Market fit, computed against the consultancy's profile. */
  fit: FitResult;
  /** Points that came from market fit rather than from the signal itself. */
  fitPoints: number;
  /** Why this ranks where it does, most important first. */
  reasons: string[];
  /** What held it back: staleness, weak evidence, duplicates. */
  penalties: string[];
}

export interface AccountBundle {
  account: Account;
  signals: Signal[];
  contacts: Contact[];
  brief: Brief | null;
  drafts: Draft[];
  score: ScoredAccount | null;
}
