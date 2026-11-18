import { DEFAULT_NICHE, nichePreset } from "./niches";
import type { Profile, SignalDefinition, SignalType } from "./types";
import { nicheConfigFromPreset, presetToVocabulary } from "./vocab";

// ---------------------------------------------------------------------------
// Sample workspace + sample market data for the default niche
// (data & AI consultancies, 5-50 people, selling to Nordic mid-market companies).
//
// The demo market is deliberately local to the demo consultancy: a Stockholm
// practice shown a Californian pipeline is a product that has not understood
// where it is being sold.
//
// These accounts are FICTIONAL sample records used to demonstrate the product.
// In production the same shapes are filled from job-board APIs, press releases,
// funding/M&A feeds, public tenders and a licensed contact provider.
//
// The signal vocabulary itself is no longer hardcoded here: it is derived from
// the niche preset in ./niches.ts, which is the same data a tenant stores in its
// own `signal_definitions` rows. A workspace on another niche gets a different
// set of keys from the same mechanism.
// ---------------------------------------------------------------------------

/** Sample accounts below all use these keys, so the two stay in step. */
export const SIGNAL_DEFINITIONS: Record<SignalType, SignalDefinition> = Object.fromEntries(
  presetToVocabulary(nichePreset(DEFAULT_NICHE)).map((d) => [d.type, d]),
);

export const DEFAULT_PROFILE: Profile = {
  companyName: "Northwind Data & AI",
  website: "https://northwind-data.example",
  headcount: "18",
  region: "Stockholm, SE",
  niche: DEFAULT_NICHE,
  nicheConfig: nicheConfigFromPreset(nichePreset(DEFAULT_NICHE)),
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
  idealClient: {
    sector:
      "Nordic mid-market companies (logistics, healthcare, financial services, retail, industrials)",
    sizeMin: 200,
    sizeMax: 5000,
    // Country names, so the feed resolves each account's city against them.
    // "Sweden" alone would have left Gothenburg unmatched before ./geo.ts.
    region: "Sweden, Norway, Denmark, Finland, Iceland",
    description:
      "Mid-market Nordic companies with real data volume, a small in-house team, and no senior data leadership — where a six-figure engagement creates visible leverage.",
  },
  caseStudies: [
    {
      id: "cs-1",
      client: "Regional logistics operator",
      sector: "Logistics",
      problem:
        "Ops data spread across three systems with no single source of truth; reporting took a week each month.",
      outcome:
        "Delivered a Snowflake + dbt platform and a governed reporting layer in 11 weeks; month-end reporting cut from 5 days to 4 hours.",
      serviceLineId: "svc-platform",
    },
    {
      id: "cs-2",
      client: "Specialty insurance carrier",
      sector: "Insurance",
      problem:
        "A new Head of Data inherited fragmented warehouses and no agreed metrics.",
      outcome:
        "Built a semantic layer and governance model; the data team shipped its first self-serve reporting to underwriting in 8 weeks.",
      serviceLineId: "svc-governance",
    },
    {
      id: "cs-3",
      client: "Mid-market healthcare network",
      sector: "Healthcare",
      problem:
        "Wanted an LLM assistant for clinical-ops documents but had no evaluation or safety process.",
      outcome:
        "Shipped a retrieval pipeline with an eval harness; assistant handles 40% of first-line internal queries with a documented accuracy baseline.",
      serviceLineId: "svc-ml",
    },
  ],
  tone: "consultative",
  length: "medium",
  digestIncludesContacts: false,
  delivery: {
    // The report's Slack Phase 1: a weekly digest plus strong-signal alerts.
    digestCadence: "weekly",
    alertMinScore: 80,
    digestSize: 8,
  },
  sender: {
    name: "Your Name, Northwind Data & AI",
    email: "partners@northwind-data.example",
    replyTo: "partners@northwind-data.example",
  },
};

type SeedSignal = {
  type: SignalType;
  daysAgo: number;
  summary: string;
  evidence: string;
  source: string;
  sourceUrl?: string;
  strength: number;
};

export type SeedAccount = {
  name: string;
  domain: string;
  sector: string;
  employees: number;
  location: string;
  description: string;
  signals: SeedSignal[];
  contacts: {
    name: string;
    title: string;
    decisionMaker?: boolean;
    emailStatus?: "verified" | "likely" | "unverified";
  }[];
};

export const SEED_ACCOUNTS: SeedAccount[] = [
  {
    name: "Bergström Logistics",
    domain: "bergstromlogistics.example",
    sector: "Logistics",
    employees: 850,
    location: "Gothenburg",
    description:
      "Regional freight and 3PL operator modernising a legacy operations stack.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 6,
        summary: "Hiring 3 data engineers, no CDO or Head of Data on LinkedIn",
        evidence:
          "Two Senior Data Engineer and one Analytics Engineer roles posted in the last two weeks; no data-leadership title in the org chart.",
        source: "Job-board API",
        strength: 0.9,
      },
      {
        type: "funding_ma",
        daysAgo: 21,
        summary: "Acquired a Danish regional carrier, creating data integration work",
        evidence:
          "Press release announcing the acquisition of a 200-truck carrier; integration and consolidated reporting explicitly named as priorities.",
        source: "Press release",
        strength: 0.75,
      },
    ],
    contacts: [
      { name: "Annika Berg", title: "VP Operations", decisionMaker: true },
      { name: "Johan Ekdahl", title: "Director of IT", decisionMaker: true },
      { name: "Erik Lund", title: "Senior Data Engineer", emailStatus: "likely" },
    ],
  },
  {
    name: "Vårdpartner Nord",
    domain: "vardpartnernord.example",
    sector: "Healthcare",
    employees: 1400,
    location: "Malmö",
    description:
      "Multi-site outpatient healthcare group with a budding analytics function.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 12,
        summary: "New Chief Data Officer appointed 5 weeks ago",
        evidence:
          "Press release and LinkedIn announcement of a new CDO joining from a larger provider; first 90 days typically a partner-buying window.",
        source: "Press release + licensed people data",
        strength: 0.95,
      },
    ],
    contacts: [
      { name: "Karin Åkesson", title: "Chief Data Officer", decisionMaker: true },
      { name: "Tomas Iglesias", title: "Director, Clinical Analytics", decisionMaker: true },
    ],
  },
  {
    name: "Svea Retail Group",
    domain: "svearetail.example",
    sector: "Retail",
    employees: 600,
    location: "Norrköping",
    description: "Regional omnichannel retailer with growing e-commerce volume.",
    signals: [
      {
        type: "platform_adoption",
        daysAgo: 9,
        summary: "Job ads list Snowflake and dbt as required skills",
        evidence:
          "Four analytics roles in the last month require Snowflake and dbt; a partner announcement references a cloud data migration.",
        source: "Job-board API + partner announcement",
        strength: 0.8,
      },
      {
        type: "data_hiring_no_leadership",
        daysAgo: 15,
        summary: "Analytics hiring with no senior data leadership",
        evidence:
          "Hiring an Analytics Engineer and BI Developer; no Head of Data or CDO visible.",
        source: "Job-board API",
        strength: 0.7,
      },
    ],
    contacts: [
      { name: "Kajsa Osei", title: "VP Digital & E-commerce", decisionMaker: true },
      { name: "Luis Mendez", title: "IT Director", decisionMaker: true },
    ],
  },
  {
    name: "Nordkap Finans",
    domain: "nordkapfinans.example",
    sector: "Financial services",
    employees: 450,
    location: "Stockholm",
    description: "Specialty lender modernising risk and reporting capabilities.",
    signals: [
      {
        type: "public_rfp",
        daysAgo: 4,
        summary: "Public procurement for a cloud data warehouse and BI modernisation",
        evidence:
          "Swedish procurement portal notice ref. 2026-114 seeking a partner for warehouse migration, semantic layer and regulatory reporting.",
        source: "Public procurement portal",
        sourceUrl: "https://procurement.example/upphandling/2026-114",
        strength: 0.95,
      },
    ],
    contacts: [
      { name: "Rakel Kim", title: "Chief Information Officer", decisionMaker: true },
      { name: "Ove Bradley", title: "Head of Risk Analytics", decisionMaker: true },
    ],
  },
  {
    name: "Fjällgård Foods",
    domain: "fjallgardfoods.example",
    sector: "Consumer goods",
    employees: 1200,
    location: "Uppsala",
    description: "Packaged-food manufacturer with a large distribution footprint.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 8,
        summary: "Hiring a Head of Supply Chain Analytics, no data org in place",
        evidence:
          "Single senior analytics role posted into a function with no data team; classic greenfield build-out.",
        source: "Job-board API",
        strength: 0.8,
      },
    ],
    contacts: [
      { name: "Greta Lindqvist", title: "VP Supply Chain", decisionMaker: true },
      { name: "Andre Cole", title: "Director of Finance Systems" },
    ],
  },
  {
    name: "Ankaret Insurance",
    domain: "ankaretins.example",
    sector: "Insurance",
    employees: 900,
    location: "Västerås",
    description: "Property & casualty carrier investing in underwriting analytics.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 18,
        summary: "New VP of Data & Analytics hired from a peer carrier",
        evidence:
          "Leadership page updated and announcement post; mandate to consolidate warehouses and improve underwriting models.",
        source: "Licensed people data + company site",
        strength: 0.9,
      },
      {
        type: "platform_adoption",
        daysAgo: 30,
        summary: "Moving to Databricks per job ads and a partner case study",
        evidence:
          "Three roles list Databricks; a platform partner published a case study naming Ankaret.",
        source: "Job-board API + partner case study",
        strength: 0.65,
      },
    ],
    contacts: [
      { name: "Helena Marsh", title: "VP Data & Analytics", decisionMaker: true },
      { name: "Viktor Nguyen", title: "Chief Underwriting Officer", decisionMaker: true },
    ],
  },
  {
    name: "Verkstad Precision",
    domain: "verkstadprecision.example",
    sector: "Industrials",
    employees: 700,
    location: "Eskilstuna",
    description: "Precision-components manufacturer digitising plant operations.",
    signals: [
      {
        type: "funding_ma",
        daysAgo: 14,
        summary: "Closed a growth round to fund an Industry 4.0 programme",
        evidence:
          "Announced a SEK 400M growth investment naming plant analytics and IoT data as a use of funds.",
        source: "Press release",
        strength: 0.85,
      },
    ],
    contacts: [
      { name: "Per Kowalski", title: "COO", decisionMaker: true },
      { name: "Sofia Alvarez", title: "Head of Digital Transformation", decisionMaker: true },
    ],
  },
  {
    name: "Nordlab Biotech",
    domain: "nordlabbio.example",
    sector: "Biotech",
    employees: 320,
    location: "Lund",
    description: "Clinical-stage biotech scaling R&D data operations.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 25,
        summary: "First Head of Data Science appointed",
        evidence:
          "New role announced; remit spans data platform, analytics and ML for discovery.",
        source: "Licensed people data",
        strength: 0.85,
      },
      {
        type: "data_hiring_no_leadership",
        daysAgo: 5,
        summary: "Hiring a Data Platform Engineer",
        evidence: "One Senior Data Platform Engineer role posted.",
        source: "Job-board API",
        strength: 0.6,
      },
    ],
    contacts: [
      { name: "Dr. Nadia Rahman", title: "Head of Data Science", decisionMaker: true },
      { name: "Colin Walsh", title: "VP R&D Operations", decisionMaker: true },
    ],
  },
  {
    name: "Nordkraft Energi",
    domain: "nordkraftenergi.example",
    sector: "Energy",
    employees: 1100,
    location: "Sundsvall",
    description: "Midstream energy operator modernising asset analytics.",
    signals: [
      {
        type: "public_rfp",
        daysAgo: 11,
        summary: "Tender for an enterprise data platform and analytics partner",
        evidence:
          "Tender references data ingestion from SCADA systems, a lakehouse and executive dashboards.",
        source: "Public tender portal",
        sourceUrl: "https://tenders.example/nordkraft/data",
        strength: 0.9,
      },
      {
        type: "platform_adoption",
        daysAgo: 40,
        summary: "Databricks named in a conference talk",
        evidence:
          "Two engineers presented a Databricks pilot at an industry meetup.",
        source: "Conference listing",
        strength: 0.55,
      },
    ],
    contacts: [
      { name: "Robert Hale", title: "CIO", decisionMaker: true },
      { name: "Mei Chen", title: "Director of Data Engineering", decisionMaker: true },
    ],
  },
  {
    name: "Storälven Energi",
    domain: "storalvenenergi.example",
    sector: "Utilities",
    employees: 1500,
    location: "Östersund",
    description: "Regional utility investing in grid and customer analytics.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 10,
        summary: "Three analytics roles, no standing data leadership",
        evidence:
          "Hiring BI and data engineering staff into IT with no CDO; board papers mention an analytics gap.",
        source: "Job-board API + board minutes",
        strength: 0.8,
      },
    ],
    contacts: [
      { name: "Alicia Boyer", title: "Deputy CIO", decisionMaker: true },
      { name: "Jamal Wright", title: "Manager, Grid Analytics" },
    ],
  },
  {
    name: "Kunskapsporten",
    domain: "kunskapsporten.example",
    sector: "Education technology",
    employees: 380,
    location: "Umeå",
    description: "Digital curriculum provider scaling its product analytics.",
    signals: [
      {
        type: "funding_ma",
        daysAgo: 7,
        summary: "Raised a SEK 280M Series C",
        evidence:
          "Funding announcement names data platform and AI personalisation as priorities.",
        source: "Press release",
        strength: 0.8,
      },
    ],
    contacts: [
      { name: "Nikolina Barnes", title: "VP Product", decisionMaker: true },
      { name: "Sam Okafor", title: "Head of Engineering", decisionMaker: true },
    ],
  },
  {
    name: "Sköld Cyber",
    domain: "skoldcyber.example",
    sector: "Cybersecurity",
    employees: 260,
    location: "Helsinki",
    description: "Managed security provider building a data-driven SOC.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 19,
        summary: "Hiring a data engineer for the SOC",
        evidence:
          "Role focuses on telemetry pipelines and detection analytics; no data leadership present.",
        source: "Job-board API",
        strength: 0.7,
      },
    ],
    contacts: [
      { name: "Diego Santos", title: "VP Security Operations", decisionMaker: true },
    ],
  },
  {
    name: "Hälsonätet Väst",
    domain: "halsonatetvast.example",
    sector: "Healthcare",
    employees: 700,
    location: "Borås",
    description: "Community health system exploring population-health analytics.",
    signals: [
      {
        type: "public_rfp",
        daysAgo: 16,
        summary: "Tender for a population-health data platform",
        evidence:
          "Tender seeks a partner for a clinical data warehouse and risk-stratification models.",
        source: "Public procurement portal",
        strength: 0.85,
      },
    ],
    contacts: [
      { name: "Brenda Sinclair", title: "Chief Medical Information Officer", decisionMaker: true },
    ],
  },
  {
    name: "Nordmedia Group",
    domain: "nordmediagroup.example",
    sector: "Media",
    employees: 500,
    location: "Copenhagen",
    description: "Digital publisher monetising audience data.",
    signals: [
      {
        type: "platform_adoption",
        daysAgo: 22,
        summary: "Migrating analytics to a modern warehouse",
        evidence:
          "Job ads reference Snowflake and a modern BI stack; a trade article describes the migration.",
        source: "Job-board API + trade press",
        strength: 0.65,
      },
    ],
    contacts: [
      { name: "Yuki Tanaka", title: "VP Audience & Data", decisionMaker: true },
    ],
  },
  {
    name: "Nordpay",
    domain: "nordpay.example",
    sector: "Fintech",
    employees: 300,
    location: "Stockholm",
    description: "Payments platform scaling fraud and risk analytics.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 3,
        summary: "New Head of Data hired, first 90 days",
        evidence:
          "Announced this week; remit includes a data platform rebuild and ML risk models.",
        source: "Licensed people data + LinkedIn post",
        strength: 0.95,
      },
    ],
    contacts: [
      { name: "Aisha Bello", title: "Head of Data", decisionMaker: true },
      { name: "Grant Fisher", title: "VP Risk", decisionMaker: true },
    ],
  },
  {
    name: "Öresund Freight",
    domain: "oresundfreight.example",
    sector: "Logistics",
    employees: 950,
    location: "Helsingborg",
    description: "Intermodal freight company merging two operating systems.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 13,
        summary: "Data engineering hiring, no CDO",
        evidence: "Two data engineering roles open; no data leadership listed.",
        source: "Job-board API",
        strength: 0.75,
      },
      {
        type: "funding_ma",
        daysAgo: 33,
        summary: "Merged with a rail-partner operator",
        evidence: "Merger press release cites system integration as a priority.",
        source: "Press release",
        strength: 0.7,
      },
    ],
    contacts: [
      { name: "Walter Simmons", title: "COO", decisionMaker: true },
      { name: "Ines Duarte", title: "IT Director", decisionMaker: true },
    ],
  },
  {
    name: "Nordic Stay Group",
    domain: "nordicstaygroup.example",
    sector: "Hospitality",
    employees: 1600,
    location: "Visby",
    description: "Hotel group consolidating revenue and guest analytics.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 27,
        summary: "Hiring a revenue-analytics manager",
        evidence: "Role requires building reporting from scratch across properties.",
        source: "Job-board API",
        strength: 0.65,
      },
    ],
    contacts: [
      { name: "Paula Grant", title: "VP Revenue Management", decisionMaker: true },
    ],
  },
  {
    name: "Lind & Wall Advokater",
    domain: "lindwalladvokater.example",
    sector: "Legal services",
    employees: 400,
    location: "Gothenburg",
    description: "Law firm investing in matter and pricing analytics.",
    signals: [
      {
        type: "platform_adoption",
        daysAgo: 34,
        summary: "Adopting a modern BI stack",
        evidence:
          "A job ad references Power BI migration to a cloud warehouse; firm blog announces a data initiative.",
        source: "Job-board API + firm blog",
        strength: 0.6,
      },
    ],
    contacts: [
      { name: "Harald Finch", title: "Chief Operating Officer", decisionMaker: true },
    ],
  },
  {
    name: "Skärgårds Marine",
    domain: "skargardsmarine.example",
    sector: "Maritime",
    employees: 620,
    location: "Kalmar",
    description: "Marine services operator with heavy sensor data.",
    signals: [
      {
        type: "funding_ma",
        daysAgo: 9,
        summary: "Acquired a fleet-monitoring startup",
        evidence:
          "Acquisition brings IoT sensor data that needs integrating with ops reporting.",
        source: "Press release",
        strength: 0.8,
      },
    ],
    contacts: [
      { name: "Fiona Clark", title: "Head of Fleet Operations", decisionMaker: true },
    ],
  },
  {
    name: "Lykta Beauty",
    domain: "lyktabeauty.example",
    sector: "Beauty",
    employees: 480,
    location: "Oslo",
    description: "DTC beauty brand scaling customer analytics.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 20,
        summary: "First Director of Analytics appointed",
        evidence:
          "New hire announced; remit covers marketing analytics and retention modelling.",
        source: "Licensed people data",
        strength: 0.85,
      },
    ],
    contacts: [
      { name: "Isabella Moreau", title: "Director of Analytics", decisionMaker: true },
      { name: "Ryan Patel", title: "VP Growth", decisionMaker: true },
    ],
  },
  {
    name: "Vildmark Outdoor",
    domain: "vildmarkoutdoor.example",
    sector: "Consumer goods",
    employees: 350,
    location: "Örebro",
    description: "Outdoor-equipment brand building a data function.",
    signals: [
      {
        type: "data_hiring_no_leadership",
        daysAgo: 2,
        summary: "Hiring an Analytics Engineer",
        evidence: "First data hire; role reports into finance.",
        source: "Job-board API",
        strength: 0.7,
      },
    ],
    contacts: [
      { name: "Chloe Bennett", title: "CFO", decisionMaker: true },
    ],
  },
  {
    name: "Aero Nord",
    domain: "aeronord.example",
    sector: "Aerospace",
    employees: 1250,
    location: "Linköping",
    description: "Aerostructures supplier modernising quality analytics.",
    signals: [
      {
        type: "public_rfp",
        daysAgo: 15,
        summary: "Tender for a manufacturing analytics platform",
        evidence:
          "Tender covers sensor ingestion, quality analytics and a governance framework.",
        source: "Public procurement portal",
        strength: 0.85,
      },
      {
        type: "platform_adoption",
        daysAgo: 28,
        summary: "References a lakehouse in partner materials",
        evidence: "A platform partner lists Aero Nord in a manufacturing case study.",
        source: "Partner case study",
        strength: 0.6,
      },
    ],
    contacts: [
      { name: "Gregory Nolan", title: "VP Quality", decisionMaker: true },
      { name: "Amara Diallo", title: "Director of Manufacturing Systems", decisionMaker: true },
    ],
  },
  {
    name: "Läkemod Pharma",
    domain: "lakemodpharma.example",
    sector: "Pharmaceuticals",
    employees: 800,
    location: "Tampere",
    description: "Specialty pharma consolidating commercial analytics.",
    signals: [
      {
        type: "funding_ma",
        daysAgo: 24,
        summary: "Acquired a portfolio from a larger group",
        evidence:
          "Deal press release notes integration of commercial and supply data.",
        source: "Press release",
        strength: 0.75,
      },
    ],
    contacts: [
      { name: "Teresa Voss", title: "VP Commercial Operations", decisionMaker: true },
    ],
  },
  {
    name: "Mälardalen Robotics",
    domain: "malardalenrobotics.example",
    sector: "Robotics",
    employees: 540,
    location: "Västerås",
    description: "Industrial robotics maker scaling fleet telemetry.",
    signals: [
      {
        type: "new_data_leader",
        daysAgo: 17,
        summary: "New VP of Data Platform hired",
        evidence:
          "Announced hire; remit includes telemetry platform and ML for predictive maintenance.",
        source: "Licensed people data",
        strength: 0.9,
      },
      {
        type: "funding_ma",
        daysAgo: 6,
        summary: "Raised a SEK 550M Series D",
        evidence: "Round named fleet data and AI as core investment areas.",
        source: "Press release",
        strength: 0.8,
      },
    ],
    contacts: [
      { name: "Ingrid Solberg", title: "VP Data Platform", decisionMaker: true },
      { name: "Derrick Charles", title: "VP Engineering", decisionMaker: true },
    ],
  },
];
