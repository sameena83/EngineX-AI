// Signal sources: provider-agnostic adapters that pull raw buying signals in.
//
// This mirrors the email adapter (see ./email.ts): every adapter is configured
// purely by environment variables, nothing is hardcoded to one vendor, and with
// no keys present the whole path still runs in dry-run against a bundled sample
// so it stays testable offline.
//
// Adding a source means adding one entry to the adapter list below — the
// orchestrator (./ingest.ts), the /api/ingest route and the UI status list all
// read from here.

import type { SignalType } from "./types";

export type SourceCategory = "news" | "job_board" | "tender" | "people" | "push";

/** One raw item from a source, before classification and account resolution. */
export interface RawCandidate {
  companyName: string;
  /** The text that describes the event. This is what gets classified. */
  text: string;
  source: string;
  domain?: string | null;
  sector?: string | null;
  employees?: number | null;
  location?: string | null;
  url?: string | null;
  /** When the event was published, ISO. Defaults to ingestion time. */
  postedAt?: string | null;
  /** Set when the source already knows the signal type. */
  hint?: SignalType | null;
}

export interface SourceStatus {
  id: string;
  label: string;
  category: SourceCategory;
  docsUrl: string;
  envVars: string[];
  configured: boolean;
  /** Pulled by EngineX. Push-only sources hand candidates to /api/ingest instead. */
  pull: boolean;
  notes: string;
}

export interface SourceAdapter extends SourceStatus {
  fetch(): Promise<RawCandidate[]>;
}

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

function envNumber(key: string, fallback: number): number {
  const n = Number(env(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ----------------------------- news sources ------------------------------ */

// Webz.io News Search (https://docs.webz.io/docs/webz/news-search-api) returns
// articles plus the organisations they mention; we turn each mention into a
// candidate so the article is attributed to a real company.
const WEBZ_DEFAULT_QUERIES = [
  "company raises funding round data platform",
  "company appoints chief data officer",
  "company migrates data warehouse to cloud",
  "public authority tender data warehouse analytics",
];

function webzQueries(): string[] {
  const raw = env("WEBZ_QUERIES");
  if (!raw) return WEBZ_DEFAULT_QUERIES;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
  } catch {
    // Fall through to the defaults: a malformed override should not break a run.
  }
  return WEBZ_DEFAULT_QUERIES;
}

function webzAdapter(): SourceAdapter {
  const token = env("WEBZ_API_TOKEN");
  // Overridable so the adapter can be pointed at a stub in tests or at a proxy.
  const baseUrl = (env("WEBZ_BASE_URL") || "https://api.webz.io").replace(/\/$/, "");
  const k = Math.min(50, envNumber("WEBZ_MAX_RESULTS", 10));
  return {
    id: "webz",
    label: "Webz.io News Search",
    category: "news",
    docsUrl: "https://docs.webz.io/docs/webz/news-search-api",
    envVars: ["WEBZ_API_TOKEN", "WEBZ_QUERIES", "WEBZ_MAX_RESULTS"],
    configured: Boolean(token),
    pull: true,
    notes:
      "Press coverage for funding rounds, leadership changes and platform moves, attributed to a named company.",
    async fetch() {
      const publishedFrom = new Date(Date.now() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const out: RawCandidate[] = [];
      for (const query of webzQueries()) {
        const res = await fetch(`${baseUrl}/api/news/context`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query,
            k,
            filters: { published_from: publishedFrom },
          }),
        });
        if (!res.ok) throw new Error(`Webz.io HTTP ${res.status}`);
        const data = (await res.json()) as {
          results?: {
            article?: { url?: string; title?: string; published_at?: string; summary?: string };
            chunk?: { text?: string };
            metadata?: { organization?: string[] };
          }[];
        };
        for (const item of data.results ?? []) {
          const article = item.article;
          const companies = item.metadata?.organization ?? [];
          // An article we cannot attribute to a company is not actionable here.
          if (!article?.title || companies.length === 0) continue;
          const text = [article.title, article.summary ?? item.chunk?.text]
            .filter(Boolean)
            .join(" — ");
          for (const companyName of companies.slice(0, 3)) {
            out.push({
              companyName,
              text,
              source: "Webz.io news search",
              url: article.url ?? null,
              postedAt: article.published_at ?? null,
            });
          }
        }
      }
      return out;
    },
  };
}

/* --------------------------- generic REST source ------------------------- */

// Alias lists so an unfamiliar REST payload works without configuration; the
// field map overrides them when a source uses other names.
const FIELD_ALIASES: Record<keyof RawFieldMap, string[]> = {
  companyName: [
    "companyname",
    "company",
    "organization",
    "organisation",
    "employer",
    "name",
    "buyer",
    "authority",
    "account",
  ],
  text: [
    "text",
    "description",
    "summary",
    "title",
    "headline",
    "snippet",
    "body",
    "notification",
  ],
  url: ["url", "link", "sourceurl", "href", "permalink"],
  postedAt: ["postedat", "publishedat", "published", "date", "createdat", "posted_on"],
  domain: ["domain", "website", "companydomain", "companywebsite"],
  sector: ["sector", "industry", "category"],
  location: ["location", "city", "region", "country"],
  employees: ["employees", "headcount", "staff", "size"],
};

type RawFieldMap = {
  companyName: string;
  text: string;
  url: string;
  postedAt: string;
  domain: string;
  sector: string;
  location: string;
  employees: string;
};

const ITEM_KEYS = ["items", "results", "data", "jobs", "records", "posts", "tenders", "notifications"];

function parseFieldMap(raw: string): Partial<RawFieldMap> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<RawFieldMap> = {};
    for (const key of Object.keys(FIELD_ALIASES) as (keyof RawFieldMap)[]) {
      if (typeof parsed[key] === "string") out[key] = String(parsed[key]);
    }
    return out;
  } catch {
    return {};
  }
}

function readPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      obj,
    );
}

/** Find a field by explicit mapping first, then by the common aliases. */
function pick(item: Record<string, unknown>, field: keyof RawFieldMap, map: Partial<RawFieldMap>) {
  const explicit = map[field];
  if (explicit) return readPath(item, explicit);
  const lower = new Map(Object.keys(item).map((k) => [k.toLowerCase(), k]));
  for (const alias of FIELD_ALIASES[field]) {
    const key = lower.get(alias);
    if (key) return item[key];
  }
  return undefined;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function extractItems(payload: unknown, itemsPath: string): Record<string, unknown>[] {
  const container = itemsPath ? readPath(payload, itemsPath) : payload;
  if (Array.isArray(container)) return container as Record<string, unknown>[];
  if (container && typeof container === "object") {
    for (const key of ITEM_KEYS) {
      const value = (container as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

function genericHttpAdapter(): SourceAdapter {
  const url = env("INGEST_HTTP_URL");
  const token = env("INGEST_HTTP_TOKEN");
  const method = (env("INGEST_HTTP_METHOD") || "GET").toUpperCase();
  const itemsPath = env("INGEST_HTTP_ITEMS_PATH");
  const fieldMap = parseFieldMap(env("INGEST_HTTP_FIELD_MAP"));
  const maxPages = Math.min(20, envNumber("INGEST_HTTP_MAX_PAGES", 1));
  const paged = url.includes("{page}");
  return {
    id: "http",
    label: "Generic REST source",
    category: "job_board",
    docsUrl: "https://github.com/enginex/enginex#generic-rest-source",
    envVars: [
      "INGEST_HTTP_URL",
      "INGEST_HTTP_TOKEN",
      "INGEST_HTTP_ITEMS_PATH",
      "INGEST_HTTP_FIELD_MAP",
      "INGEST_HTTP_MAX_PAGES",
    ],
    configured: Boolean(url),
    pull: true,
    notes:
      "Any JSON API you have credentials for — job boards, ATS feeds, tender portals, people data. Point it at the URL and map the fields once.",
    async fetch() {
      const out: RawCandidate[] = [];
      for (let page = 1; page <= (paged ? maxPages : 1); page++) {
        const pageUrl = paged ? url.replace("{page}", String(page)) : url;
        const res = await fetch(pageUrl, {
          method,
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = extractItems(await res.json(), itemsPath);
        if (items.length === 0) break;
        for (const item of items) {
          const companyName = asText(pick(item, "companyName", fieldMap));
          const text = asText(pick(item, "text", fieldMap));
          if (!companyName || !text) continue;
          const employees = Number(pick(item, "employees", fieldMap));
          out.push({
            companyName,
            text,
            source: env("INGEST_HTTP_LABEL") || "REST source",
            url: asText(pick(item, "url", fieldMap)),
            postedAt: asText(pick(item, "postedAt", fieldMap)),
            domain: asText(pick(item, "domain", fieldMap)),
            sector: asText(pick(item, "sector", fieldMap)),
            location: asText(pick(item, "location", fieldMap)),
            employees: Number.isFinite(employees) && employees > 0 ? employees : null,
          });
        }
      }
      return out;
    },
  };
}

/* ------------------------------ push source ------------------------------ */

function pushAdapter(): SourceAdapter {
  return {
    id: "push",
    label: "Push API",
    category: "push",
    docsUrl: "https://github.com/enginex/enginex#push-signals-in",
    envVars: ["INGEST_SECRET"],
    // Nothing to configure: it is always ready to receive, and never pulled.
    configured: true,
    pull: false,
    notes:
      "POST candidates to /api/ingest from a scraper, a spreadsheet script, or a Make/Zapier scenario. No key needed unless INGEST_SECRET is set.",
    async fetch() {
      return [];
    },
  };
}

/* ------------------------------ dry run ---------------------------------- */

// Bundled fixture: what a real source looks like once normalised. Used when a
// run is explicitly a dry run, exactly like the email adapter's dry-run mode.
const SAMPLE_CANDIDATES: RawCandidate[] = [
  {
    companyName: "Northwind Freight",
    text: "Northwind Freight raises $42M Series C to fund a data platform rebuild",
    source: "Sample feed",
    url: "https://example.com/northwind-series-c",
    postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    sector: "Logistics",
    employees: 900,
    location: "Rotterdam, NL",
  },
  {
    companyName: "Kestrel Analytics",
    text: "Kestrel Analytics appoints its first Chief Data Officer",
    source: "Sample feed",
    url: "https://example.com/kestrel-cdo",
    postedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    sector: "Insurance",
    employees: 420,
    location: "Bristol, UK",
  },
  {
    companyName: "Harborline Logistics",
    text: "Harborline Logistics is hiring three data engineers for a Snowflake migration",
    source: "Sample feed",
    url: "https://example.com/harborline-jobs",
    postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
  {
    companyName: "Civic Water Authority",
    text: "Civic Water Authority issues a public tender for a cloud data warehouse",
    source: "Sample feed",
    url: "https://example.com/civic-tender",
    postedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
  {
    companyName: "Bramble Retail",
    text: "Bramble Retail's spring lookbook features a new loyalty programme",
    source: "Sample feed",
    url: "https://example.com/bramble-lookbook",
  },
];

function sampleAdapter(): SourceAdapter {
  return {
    id: "sample",
    label: "Bundled sample feed",
    category: "news",
    docsUrl: "https://github.com/enginex/enginex#dry-runs",
    envVars: [],
    configured: true,
    pull: true,
    notes: "Fixtures used for dry runs. Never written to the database.",
    async fetch() {
      return SAMPLE_CANDIDATES;
    },
  };
}

/* ------------------------------ the registry ----------------------------- */

export function listSources(): SourceAdapter[] {
  return [webzAdapter(), genericHttpAdapter(), pushAdapter()];
}

/** Sources EngineX can pull on a schedule (push sources are excluded). */
export function pullSources(): SourceAdapter[] {
  return listSources().filter((s) => s.pull && s.configured);
}

export function hasPullSource(): boolean {
  return pullSources().length > 0;
}

/** The adapter for a dry run: same shape, no credentials, no writes. */
export function sampleSource(): SourceAdapter {
  return sampleAdapter();
}

export function sourceStatuses(): SourceStatus[] {
  return listSources().map(({ id, label, category, docsUrl, envVars, configured, pull, notes }) => ({
    id,
    label,
    category,
    docsUrl,
    envVars,
    configured,
    pull,
    notes,
  }));
}
