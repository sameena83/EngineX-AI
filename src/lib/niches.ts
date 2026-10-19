// Niche presets: the buying-signal vocabulary, as data.
//
// What a "signal" means is niche-specific. A data & AI practice cares about a
// Snowflake migration; a security practice cares about a SOC 2 audit; a platform
// practice cares about a Kubernetes migration. Everything about how the engine
// works — deduplication, evidence, scoring, fit, feedback loops, delivery — is
// identical across all three. Only the vocabulary changes.
//
// So the vocabulary lives here as plain data and is copied into the database per
// tenant (see `applyNichePreset` in ./db.ts). Adding a niche means adding a
// preset, not editing the classifier.
//
// Four of the shapes recur across niches and deliberately share a key —
// `funding_ma`, `public_rfp`, `*_leader_hired`, `*_hiring_no_leadership` — so
// performance can be compared across niches rather than starting from zero.

import type { Channel } from "./channels";

/**
 * A phrase that vetoes a source item even when a positive rule matched. Keywords
 * like "AI" or "security" match a great deal of a vendor's own marketing, and
 * this is the counterweight that keeps a noisy niche from filling the feed.
 */
export interface PresetNegativeRule {
  label: string;
  patterns: string[];
}

export interface PresetConfig {
  /** Roles to approach first. Used in briefs, drafts and the outreach angle. */
  buyerRoles: string[];
  negativeRules: PresetNegativeRule[];
  /** Phrases that disqualify a company outright — competitors and non-buyers. */
  exclusions: string[];
  scoring: {
    /** Points a perfect market fit contributes to the 0-100 score. */
    fitPoints: number;
    /** Days over which a signal's influence halves. Lower = stricter recency. */
    halfLifeDays: number;
  };
  /** One line the copywriter works from. */
  outreachAngle: string;
}

export interface PresetSignal {
  /** Stable key, stored on every signal row. */
  key: string;
  /**
   * The evidence channels this rule reads — a tender pattern must not be run
   * against press coverage, and a hiring pattern is meaningless without a job
   * board. Declared per signal, not per niche: within one market the tender rule
   * and the hiring rule read different places.
   */
  sources: Channel[];
  label: string;
  shortLabel: string;
  /** Base strength 0..1: how much this alone implies a live need. */
  weight: number;
  why: string;
  /**
   * Regex sources, matched case-insensitively. Order within the signal does not
   * matter; order of the *signals* does — earlier signals win a tie, so narrow
   * urgent events (a live tender, a named appointment) are listed first.
   */
  patterns: string[];
  /** Matched against the consultancy's service names and descriptions. */
  serviceKeywords: string[];
}

export interface ServiceSuggestion {
  id: string;
  name: string;
  description: string;
}

export interface NicheTargeting {
  /** Employee band the niche sells into, as a human range rather than a filter. */
  employees: string;
  industries: string[];
  geographies: string[];
}

export interface NichePreset extends PresetConfig {
  key: string;
  label: string;
  description: string;
  signals: PresetSignal[];
  /** Default source queries, used until a tenant overrides them. */
  sourceQueries: string[];
  /** A sensible starter service list for this niche. */
  services: ServiceSuggestion[];
  /**
   * Who the niche sells to. Indicative starting points for a new workspace, not
   * validated filters: the fit matcher reads the tenant's own `idealClient`
   * numbers, which override these the moment the profile is edited.
   */
  targeting: NicheTargeting;
}

/**
 * Noise rules shared by every niche. Being a vendor's own announcement, being
 * promotional, or being a listicle is not a buying signal in any market — and
 * these are the patterns that most often produced false positives in testing.
 */
const VENDOR_NOISE: PresetNegativeRule[] = [
  {
    label: "Vendor marketing",
    patterns: [
      "\\bwe('| a)?re (excited|thrilled|proud) to (announce|unveil|launch)\\b",
      "\\b(now available|generally available|ga release)\\b",
      "\\bbook a demo\\b",
      "\\brequest a demo\\b",
      "\\bsign up (for|to) (a )?(free )?(trial|webinar|beta)\\b",
      "\\bour (customers|clients) (can|now)\\b",
      "\\bpowered by \\w+\\b",
    ],
  },
  {
    label: "Awards and rankings",
    patterns: [
      "\\bshortlist(ed)? for\\b",
      "\\bwins? (the )?(award|prize)\\b",
      "\\baward[- ]winning\\b",
      "\\bnamed (a )?(leader|visionary|challenger) in\\b",
      "\\bgartner magic quadrant\\b",
      "\\bforrester wave\\b",
    ],
  },
  {
    label: "Promotional or listicle content",
    patterns: [
      "\\bsponsored (content|post|article)\\b",
      "\\bregister (now|today)\\b",
      "\\bjoin (us|our) (for a )?webinar\\b",
      "\\b(top|best) \\d+ \\w+ (to watch|companies|tools)\\b",
      "\\bwhat is \\w+\\?",
      "\\bhow to (choose|pick|select)\\b",
    ],
  },
];

/** Consultancies sell to buyers, not to other consultancies. */
const COMPETITOR_EXCLUSIONS = [
  "consultancy",
  "consulting",
  "agency",
  "recruitment",
  "staffing",
  "managed service provider",
  "systems integrator",
];

/* ------------------------------- data & AI ------------------------------- */

const DATA_AI: NichePreset = {
  key: "data_ai",
  label: "Data & AI",
  description: "Data platform, analytics, ML and governance consultancies.",
  targeting: {
    employees: "200–5,000",
    industries: [
      "Financial services",
      "Retail & e-commerce",
      "Logistics & supply chain",
      "Healthcare",
      "Manufacturing",
    ],
    geographies: ["UK", "Ireland", "Netherlands", "US Midwest"],
  },
  buyerRoles: ["Chief Data Officer", "Head of Data", "VP Analytics", "CTO", "Head of AI"],
  negativeRules: VENDOR_NOISE,
  exclusions: COMPETITOR_EXCLUSIONS,
  // A platform migration is stale within weeks; the old fixed 45-day curve
  // halved influence at ~31 days, so 30 is the same shape expressed honestly.
  scoring: { fitPoints: 25, halfLifeDays: 30 },
  outreachAngle:
    "Improve analytics, get a data platform live, or automate a manual workflow.",
  sourceQueries: [
    "company raises funding round data platform",
    "company appoints chief data officer",
    "company migrates data warehouse to cloud",
    "public authority tender data warehouse analytics",
  ],
  services: [
    {
      id: "svc-platform",
      name: "Data platform engineering",
      description:
        "Design and build modern data platforms on Snowflake, Databricks and dbt, including ingestion, modelling and cost governance.",
    },
    {
      id: "svc-analytics",
      name: "Analytics & BI",
      description:
        "Turn warehouse data into decision-ready dashboards and semantic layers, and train internal teams to own them.",
    },
    {
      id: "svc-ml",
      name: "ML & LLM applications",
      description:
        "Ship production machine-learning and LLM applications, from evaluation and RAG pipelines to deployment and monitoring.",
    },
    {
      id: "svc-governance",
      name: "Data governance",
      description:
        "Stand up governance, lineage, quality and access controls so data teams can move fast without breaking trust.",
    },
  ],
  signals: [
    {
      key: "public_rfp",
      // The one signal that only exists in one place: a tender notice.
      sources: ["tender"],
      label: "Public RFP or tender",
      shortLabel: "Public RFP",
      weight: 0.9,
      why: "A live tender mentioning data, analytics or AI is an explicit statement of need.",
      patterns: [
        "\\btender\\b",
        "\\brfp\\b",
        "\\brfi\\b",
        "request for (proposals?|tenders?|quotations?|information)",
        "\\bprocurement\\b",
        "call for (bids|proposals)",
        "invitation to (tender|bid)",
        "\\bcontract notice\\b",
      ],
      serviceKeywords: [
        "platform",
        "analytics",
        "governance",
        "implementation",
        "delivery",
        "consulting",
      ],
    },
    {
      key: "new_data_leader",
      sources: ["news", "people"],
      label: "New data leader, first 90 days",
      shortLabel: "New data leader",
      weight: 0.95,
      why: "A newly appointed CDO / VP Data / Head of AI often brings in outside partners early.",
      patterns: [
        "appoint(ed|s|ment)?\\b",
        "joins? .{0,30}\\bas\\b",
        "(new|first) (chief data officer|head of data|vp of data|director of data)",
        "chief data officer",
        "\\bcdo\\b",
        "new (chief information officer|chief technology officer|chief digital officer)",
        "head of (data|analytics)",
        "vp of (data|analytics)",
        "(hires?|names?) .{0,40}(chief data|head of data|vp of data)",
      ],
      serviceKeywords: [
        "governance",
        "strategy",
        "roadmap",
        "assessment",
        "analytics",
        "enablement",
        "leadership",
        "operating model",
      ],
    },
    {
      key: "funding_ma",
      sources: ["news", "funding"],
      label: "Funding or M&A",
      shortLabel: "Funding / M&A",
      weight: 0.7,
      why: "New funding or an acquisition creates immediate data integration and reporting work.",
      patterns: [
        "rais(e|es|ed|ing)\\b",
        "series [a-e]\\b",
        "funding round",
        "\\bseed round\\b",
        "acquir(e|ed|es|ing)\\b",
        "\\bmerger\\b",
        "\\bipo\\b",
        "investment (of|round|from)",
        "\\$\\s?\\d+(\\.\\d+)?\\s?(m|bn|million|billion)\\b",
      ],
      serviceKeywords: ["platform", "integration", "reporting", "analytics", "modernisation", "scale"],
    },
    {
      key: "data_hiring_no_leadership",
      // Announced nowhere: this signal only exists as a job advert.
      sources: ["job_board"],
      label: "Data hiring without data leadership",
      shortLabel: "Hiring, no leader",
      weight: 0.85,
      why: "Data engineers or ML roles with no visible CDO or Head of Data — a gap a partner can fill.",
      // The hiring verb and the role must appear together. Testing showed a bare
      // "hiring" pattern fires on any company's job ad in any niche: it classified
      // a data-hiring item as security hiring the moment the security vocabulary
      // was active. Proximity is what makes the pattern mean what it says.
      patterns: [
        "(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?).{0,60}(data engineer|analytics engineer|data platform|ml engineer|machine learning engineer|data scientist)",
        "(data engineer|analytics engineer|data platform|ml engineer|machine learning engineer|data scientist).{0,60}(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?)",
        "data platform (team|engineer)",
        "(looking|searching) for (a|an)?\\s?(senior\\s)?(data|analytics)",
      ],
      serviceKeywords: ["engineering", "platform", "ml", "analytics", "enablement", "team", "delivery"],
    },
    {
      key: "platform_adoption",
      sources: ["news"],
      label: "Platform adoption",
      shortLabel: "Platform adoption",
      weight: 0.6,
      why: "Public evidence of a move to Snowflake, Databricks, dbt or similar.",
      patterns: [
        "\\bmigrat(e|es|ed|ing|ion)\\b",
        "\\badopt(ed|s|ing|ion)?\\b",
        "\\bimplement(ed|s|ing|ation)?\\b",
        "roll(ing)? out",
        "\\b(snowflake|databricks|bigquery|redshift|fabric|dbt)\\b",
        "new data (platform|warehouse|lakehouse|stack)",
        "data warehouse",
        "machine learning platform",
        "\\bmodernis(e|ing|ation)\\b",
      ],
      serviceKeywords: [
        "platform",
        "warehouse",
        "snowflake",
        "databricks",
        "bigquery",
        "dbt",
        "lakehouse",
        "engineering",
        "ingestion",
        "migration",
      ],
    },
  ],
};

/* ------------------------------ cybersecurity ---------------------------- */

const CYBERSECURITY: NichePreset = {
  key: "cybersecurity",
  label: "Cybersecurity",
  description: "Security consulting, assurance, detection and response practices.",
  targeting: {
    employees: "500–20,000",
    industries: [
      "Financial services",
      "Healthcare",
      "Public sector",
      "Critical infrastructure & utilities",
      "SaaS & hosting",
    ],
    geographies: ["UK", "Ireland", "EU", "US"],
  },
  buyerRoles: [
    "CISO",
    "Head of Security",
    "Security Director",
    "CTO",
    "CIO",
    "Data Protection Officer",
  ],
  negativeRules: VENDOR_NOISE,
  exclusions: COMPETITOR_EXCLUSIONS,
  // Certification and regulatory deadlines stay relevant far longer than a
  // funding round does, so security signals decay more slowly.
  scoring: { fitPoints: 25, halfLifeDays: 45 },
  outreachAngle:
    "Address a specific security or compliance requirement, or close an uncovered gap.",
  sourceQueries: [
    "company appoints chief information security officer",
    "company announces SOC 2 certification",
    "company data breach notification filed",
    "organisation migrates to zero trust architecture",
  ],
  services: [
    {
      id: "svc-assurance",
      name: "Security assurance & certification",
      description:
        "SOC 2, ISO 27001 and PCI readiness — gap assessment, control design, evidence and audit support.",
    },
    {
      id: "svc-detection",
      name: "Detection & response",
      description:
        "SIEM, XDR, EDR and 24/7 monitoring: detection engineering, alert triage and incident response runbooks.",
    },
    {
      id: "svc-identity",
      name: "Identity & zero trust",
      description:
        "Zero-trust architecture, identity governance, privileged access management and conditional-access rollout.",
    },
    {
      id: "svc-testing",
      name: "Offensive security & testing",
      description:
        "Penetration testing, red teaming, secure code review and remediation guidance for engineering teams.",
    },
  ],
  signals: [
    {
      key: "public_rfp",
      // The one signal that only exists in one place: a tender notice.
      sources: ["tender"],
      label: "Public RFP or tender",
      shortLabel: "Public RFP",
      weight: 0.9,
      why: "A tender naming security, compliance or assurance is an explicit statement of need.",
      patterns: [
        "\\btender\\b",
        "\\brfp\\b",
        "\\brfi\\b",
        "request for (proposals?|tenders?|quotations?|information)",
        "\\bprocurement\\b",
        "call for (bids|proposals)",
        "invitation to (tender|bid)",
        "\\bcontract notice\\b",
      ],
      serviceKeywords: ["assurance", "compliance", "testing", "consulting", "implementation", "delivery"],
    },
    {
      key: "breach_or_incident",
      sources: ["news"],
      label: "Breach or security incident",
      shortLabel: "Breach / incident",
      weight: 0.9,
      why: "A disclosed incident triggers urgent assessment, remediation and board-level reporting work.",
      patterns: [
        "\\bbreach(ed|es)?\\b",
        "\\bdata leak\\b",
        "\\bransomware\\b",
        "\\bcyberattack\\b|\\bcyber attack\\b",
        "unauthorised access|unauthorized access",
        "security incident",
        "\\bexfiltrat(e|ed|ion)\\b",
        "notified the (regulator|ico|dpa)",
      ],
      serviceKeywords: ["response", "incident", "remediation", "forensics", "detection", "assurance"],
    },
    {
      key: "security_leader_hired",
      sources: ["news", "people"],
      label: "New security leader, first 90 days",
      shortLabel: "New security leader",
      weight: 0.95,
      why: "A new CISO or Head of Security usually re-assesses the estate and brings in outside help early.",
      patterns: [
        "(new|first|appoints?) .{0,30}(chief information security officer|chief security officer|head of security|head of information security)",
        "\\bciso\\b",
        "\\bcso\\b",
        "vp of security|director of security",
        "head of (cyber|cybersecurity|infosec)",
        "appoint(ed|s|ment)?\\b",
      ],
      serviceKeywords: [
        "assurance",
        "strategy",
        "assessment",
        "roadmap",
        "governance",
        "identity",
        "leadership",
      ],
    },
    {
      key: "compliance_audit",
      // Announced as certification work, or stated as a requirement in a tender.
      sources: ["news", "tender"],
      label: "Compliance framework or audit",
      shortLabel: "Compliance audit",
      weight: 0.9,
      why: "Certification or regulatory deadlines force control design, evidence and audit readiness.",
      patterns: [
        "\\bsoc 2\\b|\\bsoc2\\b",
        "iso[ -]?27001",
        "\\bpci[ -]?dss\\b|\\bpci\\b",
        "\\bnis2\\b",
        "\\bdora\\b",
        "\\bhipaa\\b",
        "\\bgdpr\\b",
        "\\bcyber essentials\\b",
        "compliance (audit|framework|deadline|certification)",
        "\\biso 27001 certified\\b",
      ],
      serviceKeywords: ["assurance", "compliance", "certification", "audit", "governance", "controls"],
    },
    {
      key: "funding_ma",
      sources: ["news", "funding"],
      label: "Funding or M&A",
      shortLabel: "Funding / M&A",
      weight: 0.7,
      why: "New capital or an acquisition widens the attack surface and creates due-diligence and integration work.",
      patterns: [
        "rais(e|es|ed|ing)\\b",
        "series [a-e]\\b",
        "funding round",
        "\\bseed round\\b",
        "acquir(e|ed|es|ing)\\b",
        "\\bmerger\\b",
        "\\bipo\\b",
        "investment (of|round|from)",
        "\\$\\s?\\d+(\\.\\d+)?\\s?(m|bn|million|billion)\\b",
      ],
      serviceKeywords: ["due diligence", "integration", "assurance", "assessment", "governance", "scale"],
    },
    {
      key: "security_hiring_no_leadership",
      sources: ["job_board"],
      label: "Security hiring without a security leader",
      shortLabel: "Hiring, no leader",
      weight: 0.85,
      why: "Security engineers reporting into IT with no CISO — a gap a partner can fill immediately.",
      patterns: [
        "(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?).{0,60}(security engineer|security analyst|soc analyst|detection engineer|infosec engineer|application security|security operations)",
        "(security engineer|security analyst|soc analyst|detection engineer|infosec engineer|application security engineer|security operations).{0,60}(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?)",
      ],
      serviceKeywords: ["detection", "response", "engineering", "testing", "enablement", "delivery"],
    },
    {
      key: "security_technology_adoption",
      // Tooling shows up in announcements and in the skills a job advert asks for.
      sources: ["news", "job_board"],
      label: "Security technology change",
      shortLabel: "Security tooling",
      weight: 0.7,
      why: "A SIEM, XDR or zero-trust rollout needs architecture and migration help.",
      patterns: [
        "zero trust",
        "\\bsiem\\b",
        "\\bsoar\\b|\\bxdr\\b|\\bedr\\b",
        "\\bmfa\\b|multi-factor authentication",
        "\\bpasskeys?\\b",
        "privileged access management|\\bpam\\b",
        "security (platform|architecture) (migration|refresh|modernisation|modernization)",
        "\\bmigrat(e|es|ed|ing|ion)\\b",
        "\\bimplement(ed|s|ing|ation)?\\b",
      ],
      serviceKeywords: ["identity", "detection", "platform", "architecture", "migration", "implementation"],
    },
  ],
};

/* --------------------------- DevOps / platform ---------------------------- */

const DEVOPS: NichePreset = {
  key: "devops",
  label: "DevOps & platform engineering",
  description: "Platform, SRE, cloud infrastructure and developer-experience consultancies.",
  targeting: {
    employees: "100–3,000",
    industries: [
      "SaaS & product",
      "Fintech",
      "Media & gaming",
      "Retail",
      "Logistics",
    ],
    geographies: ["UK", "Ireland", "EU", "US"],
  },
  buyerRoles: [
    "VP Platform",
    "Head of Infrastructure",
    "Head of SRE",
    "Director of Engineering",
    "CTO",
  ],
  negativeRules: VENDOR_NOISE,
  exclusions: COMPETITOR_EXCLUSIONS,
  // Outages and platform deadlines are the shortest-lived signals of all.
  scoring: { fitPoints: 25, halfLifeDays: 21 },
  outreachAngle: "Cut cloud cost, make releases reliable, or stand up a platform team.",
  sourceQueries: [
    "company hiring site reliability engineer platform team",
    "company migrates to kubernetes",
    "company reduces cloud spend initiative",
    "company adopts terraform infrastructure as code",
  ],
  services: [
    {
      id: "svc-platform",
      name: "Platform engineering",
      description:
        "Build internal developer platforms on Kubernetes with golden paths, self-service environments and Terraform-managed infrastructure.",
    },
    {
      id: "svc-sre",
      name: "SRE & reliability",
      description:
        "SLOs, incident response, on-call design, observability and chaos practice to make releases boring.",
    },
    {
      id: "svc-cicd",
      name: "CI/CD & delivery automation",
      description:
        "Pipeline and release engineering — build times, progressive delivery, supply-chain security and environment parity.",
    },
    {
      id: "svc-cloudcost",
      name: "Cloud cost & efficiency",
      description:
        "Rightsizing, autoscaling, commitment planning and unit-cost reporting that cuts cloud spend without slowing delivery.",
    },
  ],
  signals: [
    {
      key: "public_rfp",
      // The one signal that only exists in one place: a tender notice.
      sources: ["tender"],
      label: "Public RFP or tender",
      shortLabel: "Public RFP",
      weight: 0.9,
      why: "A tender naming cloud, platform or infrastructure is an explicit statement of need.",
      patterns: [
        "\\btender\\b",
        "\\brfp\\b",
        "\\brfi\\b",
        "request for (proposals?|tenders?|quotations?|information)",
        "\\bprocurement\\b",
        "call for (bids|proposals)",
        "invitation to (tender|bid)",
        "\\bcontract notice\\b",
      ],
      serviceKeywords: ["platform", "cloud", "infrastructure", "implementation", "delivery", "migration"],
    },
    {
      key: "reliability_pain",
      sources: ["news"],
      label: "Reliability or outage pressure",
      shortLabel: "Reliability pain",
      weight: 0.85,
      why: "Repeated outages or missed SLAs create budget and mandate for reliability work.",
      patterns: [
        "\\boutage(s)?\\b",
        "\\bdowntime\\b",
        "\\bpost[- ]mortem\\b",
        "service level (objective|agreement)|\\bslo\\b|\\bsla\\b",
        "\\bincident(s)? (review|response|retro)\\b",
        "\\brollback(s)?\\b",
        "\\bproduction incident\\b",
      ],
      serviceKeywords: ["sre", "reliability", "incident", "observability", "on-call", "response"],
    },
    {
      key: "platform_leader_hired",
      sources: ["news", "people"],
      label: "New platform leader, first 90 days",
      shortLabel: "New platform leader",
      weight: 0.95,
      why: "A new VP Platform, Head of SRE or Head of Infrastructure re-plans the estate and buys help early.",
      patterns: [
        "(new|first|appoints?) .{0,35}(chief technology officer|vp of platform|vp of infrastructure|head of platform|head of infrastructure|head of sre|director of platform)",
        "\\bcto\\b",
        "vp of (engineering|platform|infrastructure)",
        "head of (platform|infrastructure|devops|sre)",
        "platform (lead|architect) hired",
        "appoint(ed|s|ment)?\\b",
      ],
      serviceKeywords: [
        "platform",
        "strategy",
        "assessment",
        "roadmap",
        "architecture",
        "enablement",
        "leadership",
      ],
    },
    {
      key: "funding_ma",
      sources: ["news", "funding"],
      label: "Funding or M&A",
      shortLabel: "Funding / M&A",
      weight: 0.7,
      why: "New capital or an acquisition means scale, integration and infrastructure work.",
      patterns: [
        "rais(e|es|ed|ing)\\b",
        "series [a-e]\\b",
        "funding round",
        "\\bseed round\\b",
        "acquir(e|ed|es|ing)\\b",
        "\\bmerger\\b",
        "\\bipo\\b",
        "investment (of|round|from)",
        "\\$\\s?\\d+(\\.\\d+)?\\s?(m|bn|million|billion)\\b",
      ],
      serviceKeywords: ["platform", "integration", "scale", "cloud", "migration", "cost"],
    },
    {
      key: "cloud_cost_initiative",
      sources: ["news"],
      label: "Cloud cost or efficiency drive",
      shortLabel: "Cloud cost drive",
      weight: 0.8,
      why: "A public cost-reduction mandate rarely has internal expertise behind it yet.",
      patterns: [
        "cloud (cost|spend|bill) (reduction|optimisation|optimization|savings)",
        "reduce (cloud )?(costs|spend)",
        "\\bfinops\\b",
        "cost optimisation|cost optimization",
        "rightsizing|right-sizing",
        "\\bbudget cut(s)?\\b",
        "efficiency (programme|program|drive)",
      ],
      serviceKeywords: ["cost", "efficiency", "cloud", "finops", "autoscaling", "platform"],
    },
    {
      key: "platform_hiring_no_leadership",
      sources: ["job_board"],
      label: "Platform hiring without platform leadership",
      shortLabel: "Hiring, no leader",
      weight: 0.85,
      why: "SRE or platform roles with no visible platform leadership — a gap a partner can fill.",
      patterns: [
        "(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?).{0,60}(site reliability|\\bsre\\b|platform engineer|infrastructure engineer|devops engineer|cloud engineer)",
        "(site reliability engineer|platform engineer|infrastructure engineer|devops engineer|cloud engineer).{0,60}(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?)",
      ],
      serviceKeywords: ["platform", "sre", "engineering", "delivery", "enablement", "automation"],
    },
    {
      key: "technology_adoption",
      sources: ["news", "job_board"],
      label: "Technology adoption or migration",
      shortLabel: "Tech adoption",
      weight: 0.75,
      why: "Public evidence of a move to Kubernetes, Terraform or a new pipeline needs architecture help.",
      patterns: [
        "\\bmigrat(e|es|ed|ing|ion)\\b",
        "\\badopt(ed|s|ing|ion)?\\b",
        "\\bimplement(ed|s|ing|ation)?\\b",
        "roll(ing)? out",
        "\\bkubernetes\\b|\\bk8s\\b",
        "\\bterraform\\b|infrastructure as code|\\biac\\b",
        "\\bhelm\\b|\\bargocd\\b|\\bflux\\b",
        "\\bdocker\\b|\\bcontainers?\\b",
        "\\bobservability\\b|\\bprometheus\\b|\\bgrafana\\b|\\bdynatrace\\b|\\bdatadog\\b",
        "github actions|gitlab ci|jenkins|ci/cd pipeline",
        "\\bmonorepo\\b",
      ],
      serviceKeywords: [
        "platform",
        "kubernetes",
        "terraform",
        "pipeline",
        "automation",
        "observability",
        "migration",
        "containers",
      ],
    },
  ],
};

/* ---------------------------- automation & ERP ---------------------------- */

const AUTOMATION_ERP: NichePreset = {
  key: "automation_erp",
  label: "Automation & ERP",
  description: "Business-process automation, ERP implementation and systems-integration practices.",
  targeting: {
    employees: "250–10,000",
    industries: [
      "Manufacturing",
      "Food & beverage",
      "Distribution & wholesale",
      "Professional services",
      "Public sector",
    ],
    geographies: ["UK", "Ireland", "Nordics", "US"],
  },
  buyerRoles: ["COO", "CFO", "Head of Operations", "CIO", "Head of Transformation"],
  negativeRules: VENDOR_NOISE,
  exclusions: COMPETITOR_EXCLUSIONS,
  // An ERP or process programme runs for quarters, so its signals stay live far
  // longer than a platform outage does.
  scoring: { fitPoints: 25, halfLifeDays: 60 },
  outreachAngle:
    "Replace a manual workflow or an ageing ERP with something the team can actually run.",
  sourceQueries: [
    "company selects ERP vendor implementation partner",
    "company appoints head of transformation operations",
    "company automates invoice approval workflow",
    "public authority tender ERP finance system",
  ],
  services: [
    {
      id: "svc-erp",
      name: "ERP implementation & migration",
      description:
        "Select, migrate and cut over finance, supply-chain and HR systems with data conversion, testing and change management.",
    },
    {
      id: "svc-process",
      name: "Process automation",
      description:
        "Map and automate manual workflows — approvals, invoicing, onboarding and reporting — with integration between the systems already in place.",
    },
    {
      id: "svc-integration",
      name: "Systems integration",
      description:
        "Connect ERP, CRM, payroll and warehouse systems so one record flows end to end, with monitoring and error handling.",
    },
  ],
  signals: [
    {
      key: "public_rfp",
      // The one signal that only exists in one place: a tender notice.
      sources: ["tender"],
      label: "Public RFP or tender",
      shortLabel: "Public RFP",
      weight: 0.9,
      why: "A tender naming an ERP, finance or workflow system is an explicit, funded statement of need.",
      patterns: [
        "\\btender\\b",
        "\\brfp\\b",
        "\\brfi\\b",
        "request for (proposals?|tenders?|quotations?|information)",
        "\\bprocurement\\b",
        "call for (bids|proposals)",
        "invitation to (tender|bid)",
        "\\bcontract notice\\b",
      ],
      serviceKeywords: ["erp", "implementation", "integration", "delivery", "consulting", "finance"],
    },
    {
      key: "erp_selection",
      // A selection is announced publicly, or published as a requirement to bid on.
      sources: ["news", "tender"],
      label: "ERP or system selection",
      shortLabel: "ERP selection",
      weight: 0.9,
      why: "Choosing a new system is the moment a programme is funded and before an implementer is locked in.",
      patterns: [
        "select(ed|s|ing)? .{0,40}(erp|sap|oracle|netsuite|dynamics|workday)",
        "\\b(erp|sap s/4hana|netsuite|dynamics 365|workday|sage|xero)\\b",
        "replac(e|es|ed|ing) .{0,30}(system|erp|platform)",
        "\\bfinance (system|transformation) (programme|program|project)\\b",
        "\\bupgrad(e|es|ed|ing) (our|the) erp\\b",
      ],
      serviceKeywords: [
        "erp",
        "implementation",
        "migration",
        "assessment",
        "finance",
        "change management",
      ],
    },
    {
      key: "operations_leader_hired",
      sources: ["news", "people"],
      label: "New operations leader, first 90 days",
      shortLabel: "New ops leader",
      weight: 0.95,
      why: "A new COO, CFO or Head of Transformation arrives with a mandate to fix process and buys help early.",
      patterns: [
        "(new|first|appoints?) .{0,35}(chief operating officer|chief financial officer|head of operations|head of transformation|operations director)",
        "\\bcoo\\b|\\bcfo\\b",
        "head of (operations|transformation|business systems)",
        "appoint(ed|s|ment)?\\b",
      ],
      serviceKeywords: [
        "process",
        "strategy",
        "assessment",
        "roadmap",
        "transformation",
        "change management",
      ],
    },
    {
      key: "funding_ma",
      sources: ["news", "funding"],
      label: "Funding or M&A",
      shortLabel: "Funding / M&A",
      weight: 0.7,
      why: "New capital or an acquisition forces two sets of finance and operations systems to be reconciled.",
      patterns: [
        "rais(e|es|ed|ing)\\b",
        "series [a-e]\\b",
        "funding round",
        "\\bseed round\\b",
        "acquir(e|ed|es|ing)\\b",
        "\\bmerger\\b",
        "\\bipo\\b",
        "investment (of|round|from)",
        "\\$\\s?\\d+(\\.\\d+)?\\s?(m|bn|million|billion)\\b",
      ],
      serviceKeywords: ["integration", "finance", "process", "scale", "reporting", "migration"],
    },
    {
      key: "automation_hiring_no_leadership",
      sources: ["job_board"],
      label: "Automation hiring without a leader",
      shortLabel: "Hiring, no leader",
      weight: 0.85,
      why: "Automation or ERP analysts with no transformation lead above them — a gap a partner can fill.",
      patterns: [
        "(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?).{0,60}(erp|rpa|automation engineer|process analyst|business systems analyst|finance systems analyst)",
        "(erp (analyst|consultant|administrator)|rpa developer|automation engineer|process analyst|business systems analyst).{0,60}(hiring|recruiting|vacanc(y|ies)|job ads?|open roles?)",
      ],
      serviceKeywords: ["automation", "process", "erp", "enablement", "delivery", "integration"],
    },
  ],
};

export const NICHE_PRESETS: Record<string, NichePreset> = {
  [DATA_AI.key]: DATA_AI,
  [CYBERSECURITY.key]: CYBERSECURITY,
  [DEVOPS.key]: DEVOPS,
  [AUTOMATION_ERP.key]: AUTOMATION_ERP,
};

export const DEFAULT_NICHE = DATA_AI.key;

export function nichePreset(key: string | null | undefined): NichePreset {
  return NICHE_PRESETS[key ?? ""] ?? NICHE_PRESETS[DEFAULT_NICHE];
}

/**
 * The channel routing the presets declare, keyed by rule key.
 *
 * Four of the signal shapes deliberately share a key across markets —
 * `funding_ma`, `public_rfp`, `*_leader_hired`, `*_hiring_no_leadership` — so a
 * key is enough to find out which evidence a rule is meant to read, whichever
 * market the tenant is on. That is what lets a rule stored before channels
 * existed be routed instead of left reading everything (see
 * `resolveImplicitRouting` in ./vocab.ts).
 */
let channelsByType: Map<string, Channel[]> | null = null;

export function presetChannelsByType(): Map<string, Channel[]> {
  if (channelsByType) return channelsByType;
  const map = new Map<string, Channel[]>();
  for (const preset of Object.values(NICHE_PRESETS)) {
    for (const signal of preset.signals) {
      // First declaration wins, and only a non-empty one counts: a preset that
      // reads everything cannot say anything about the key.
      if (signal.sources.length && !map.has(signal.key)) {
        map.set(signal.key, [...signal.sources]);
      }
    }
  }
  // The presets are static data, so this is computed once per process.
  channelsByType = map;
  return map;
}

/** The channels the presets declare for one rule key, if any. */
export function presetChannelsFor(type: string): Channel[] | undefined {
  return presetChannelsByType().get(type);
}

export function listNiches(): { key: string; label: string; description: string; signals: number }[] {
  return Object.values(NICHE_PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    signals: p.signals.length,
  }));
}
