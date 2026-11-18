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

import { CHANNELS, isChannel, type Channel } from "./channels";
import type { SignalType } from "./types";

/** Channels an adapter can feed, for the UI and for validation. */
export { CHANNELS };

/** One raw item from a source, before classification and account resolution. */
export interface RawCandidate {
  companyName: string;
  /** The text that describes the event. This is what gets classified. */
  text: string;
  /** Human label for the source, shown as the signal's provenance. */
  source: string;
  /**
   * Which kind of evidence this is (see ./channels.ts).
   *
   * Set by the adapter for a pulled item, and declarable by the caller for a
   * pushed one. Absent means "read every rule": the push API's default, because a
   * scraper that posts a candidate is asserting the item is relevant and routing
   * it away from every rule would silently discard it.
   */
  channel?: Channel | null;
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
  /**
   * The evidence channels this source feeds. Null when it feeds all of them — a
   * fixture or a push endpoint is not a kind of evidence, it is a pipe.
   */
  channels: Channel[] | null;
  docsUrl: string;
  envVars: string[];
  configured: boolean;
  /** Pulled by EngineX. Push-only sources hand candidates to /api/ingest instead. */
  pull: boolean;
  notes: string;
  /**
   * A configuration mistake worth showing on /integrations: unparseable JSON, an
   * unknown channel name, a token variable that is not set. Null when the source
   * is configured the way it claims to be.
   */
  problem?: string | null;
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

/**
 * Which queries to run.
 *
 * Precedence: an explicit env override, then the tenant's own niche queries
 * (editable in the profile), then the data & AI defaults. The middle step is the
 * one that matters for a niche: a security practice polls for CISO appointments
 * and certification announcements without anyone setting an environment variable.
 */
function webzQueries(nicheQueries?: string[]): string[] {
  const raw = env("WEBZ_QUERIES");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
    } catch {
      // Fall through to the niche queries: a malformed override must not break a run.
    }
  }
  if (nicheQueries?.length) return nicheQueries;
  return WEBZ_DEFAULT_QUERIES;
}

function webzAdapter(nicheQueries?: string[]): SourceAdapter {
  const token = env("WEBZ_API_TOKEN");
  // Overridable so the adapter can be pointed at a stub in tests or at a proxy.
  const baseUrl = (env("WEBZ_BASE_URL") || "https://api.webz.io").replace(/\/$/, "");
  const k = Math.min(50, envNumber("WEBZ_MAX_RESULTS", 10));
  return {
    id: "webz",
    label: "Webz.io News Search",
    channels: ["news"],
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
      for (const query of webzQueries(nicheQueries)) {
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
              channel: "news",
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

/**
 * One configured REST endpoint.
 *
 * `INGEST_HTTP_SOURCES` is a JSON array of these, which is what lets a tenant
 * read a tender portal *and* a job board *and* a people provider at once — before
 * this, one generic REST source meant one non-news channel at a time. The single
 * endpoint variables below are the original shape and still work: a deployment
 * with one API of interest should not have to learn a new format, and a
 * deployment with four should not have to pick one.
 *
 * ```
 * INGEST_HTTP_SOURCES=[
 *   {"label":"Acme job board","url":"https://api.acme.com/jobs?page={page}","channel":"job_board","maxPages":3},
 *   {"label":"UK tender portal","url":"https://tenders.example.gov.uk/api/search","channel":"tender",
 *    "tokenEnv":"TENDER_API_TOKEN","itemsPath":"data.notices",
 *    "fieldMap":{"companyName":"buyer.name","text":"description","url":"notice_url"}}
 * ]
 * ```
 */
interface RestSourceSpec {
  id?: string;
  label?: string;
  url: string;
  channel?: string;
  /** The token itself, for an endpoint whose key nobody else needs. */
  token?: string;
  /** The name of the variable holding the token, so a secret stays in one place. */
  tokenEnv?: string;
  method?: string;
  itemsPath?: string;
  fieldMap?: Record<string, string> | string;
  maxPages?: number;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Parse `INGEST_HTTP_SOURCES`.
 *
 * A malformed list is reported rather than thrown or silently dropped: it is a
 * configuration mistake someone has to fix, and a source that is quietly missing
 * looks like a pipeline that simply found nothing.
 */
function parseRestSources(raw: string): { specs: RestSourceSpec[]; error: string | null } {
  if (!raw) return { specs: [], error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { specs: [], error: err instanceof Error ? err.message : "invalid JSON" };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const specs: RestSourceSpec[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const url = asString(raw.url);
    // An entry with no URL cannot be fetched, and inventing one would be worse
    // than ignoring the entry.
    if (!url) continue;
    const fieldMap =
      raw.fieldMap && typeof raw.fieldMap === "object" ? (raw.fieldMap as Record<string, string>) : asString(raw.fieldMap);
    specs.push({
      id: asString(raw.id) || undefined,
      label: asString(raw.label) || undefined,
      url,
      channel: asString(raw.channel) || undefined,
      token: asString(raw.token) || undefined,
      tokenEnv: asString(raw.tokenEnv) || undefined,
      method: asString(raw.method) || undefined,
      itemsPath: asString(raw.itemsPath) || undefined,
      fieldMap,
      maxPages: asPositiveInt(raw.maxPages),
    });
  }
  return { specs, error: null };
}

/** A URL-safe id fragment, so a source has a stable key for the UI and logs. */
function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return cleaned || "source";
}

function normaliseFieldMap(value: Record<string, string> | string | undefined): Partial<RawFieldMap> {
  if (!value) return {};
  return typeof value === "string" ? parseFieldMap(value) : parseFieldMap(JSON.stringify(value));
}

function httpAdapter(spec: RestSourceSpec, id: string, channel: Channel, problem: string | null): SourceAdapter {
  const token = spec.token || env(spec.tokenEnv ?? "");
  const method = (spec.method || "GET").toUpperCase();
  const itemsPath = spec.itemsPath ?? "";
  const fieldMap = normaliseFieldMap(spec.fieldMap);
  const maxPages = Math.min(20, spec.maxPages ?? 1);
  const paged = spec.url.includes("{page}");
  const label = spec.label || "Generic REST source";
  return {
    id,
    label,
    channels: [channel],
    docsUrl: "https://github.com/enginex/enginex#generic-rest-source",
    envVars: [
      "INGEST_HTTP_SOURCES",
      ...(spec.tokenEnv ? [spec.tokenEnv] : []),
    ],
    configured: Boolean(spec.url) && !(spec.tokenEnv && !token),
    pull: true,
    problem,
    notes:
      "Any JSON API you have credentials for — job boards, ATS feeds, tender portals, people data. Point it at the URL and map the fields once.",
    async fetch() {
      const out: RawCandidate[] = [];
      for (let page = 1; page <= (paged ? maxPages : 1); page++) {
        const pageUrl = paged ? spec.url.replace("{page}", String(page)) : spec.url;
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
            source: label,
            channel,
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

/**
 * Resolve the channel an endpoint was declared to feed.
 *
 * Defaults to a job board — the common case — but a tender portal, a funding
 * database or a people provider are the same adapter pointed at a different URL,
 * and the channel is what decides which rules may read it. An unrecognised name
 * is reported instead of silently becoming a job board.
 */
function declaredChannel(name: string | undefined): { channel: Channel; problem: string | null } {
  if (!name) return { channel: "job_board", problem: null };
  if (isChannel(name)) return { channel: name, problem: null };
  return {
    channel: "job_board",
    problem: `Unknown channel "${name}" — reading it as job boards. Valid: ${CHANNELS.map(
      (c) => c.id,
    ).join(", ")}.`,
  };
}

/** Every configured REST endpoint: the JSON list, then the single-endpoint vars. */
function restAdapters(): SourceAdapter[] {
  const { specs, error } = parseRestSources(env("INGEST_HTTP_SOURCES"));
  const adapters: SourceAdapter[] = [];

  if (error) {
    adapters.push({
      id: "http:invalid",
      label: "REST source list",
      channels: null,
      docsUrl: "https://github.com/enginex/enginex#generic-rest-source",
      envVars: ["INGEST_HTTP_SOURCES"],
      configured: false,
      pull: true,
      problem: `INGEST_HTTP_SOURCES is not valid JSON (${error}). No REST source is being pulled.`,
      notes: "A JSON array of REST endpoints. Every source in it is skipped until the value parses.",
      async fetch() {
        return [];
      },
    });
  }

  const seen = new Set<string>();
  specs.forEach((spec, index) => {
    const { channel, problem: channelProblem } = declaredChannel(spec.channel);
    const base = slug(spec.id || spec.label || `rest-${index + 1}`);
    let id = `http:${base}`;
    for (let n = 2; seen.has(id); n++) id = `http:${base}-${n}`;
    seen.add(id);
    const tokenProblem =
      spec.tokenEnv && !env(spec.tokenEnv) ? `${spec.tokenEnv} is not set, so this source will not be pulled.` : null;
    adapters.push(httpAdapter(spec, id, channel, channelProblem ?? tokenProblem));
  });

  // The original single-endpoint shape, kept working. It is a job board unless
  // INGEST_HTTP_CHANNEL says otherwise, exactly as before.
  const url = env("INGEST_HTTP_URL");
  if (url) {
    const { channel, problem } = declaredChannel(env("INGEST_HTTP_CHANNEL"));
    adapters.push(
      httpAdapter(
        {
          label: env("INGEST_HTTP_LABEL") || "Generic REST source",
          url,
          channel: env("INGEST_HTTP_CHANNEL") || undefined,
          token: env("INGEST_HTTP_TOKEN") || undefined,
          method: env("INGEST_HTTP_METHOD") || undefined,
          itemsPath: env("INGEST_HTTP_ITEMS_PATH") || undefined,
          fieldMap: env("INGEST_HTTP_FIELD_MAP") || undefined,
          maxPages: envNumber("INGEST_HTTP_MAX_PAGES", 1),
        },
        "http",
        channel,
        problem,
      ),
    );
  }

  return adapters;
}

/* ------------------------------ push source ------------------------------ */

function pushAdapter(): SourceAdapter {
  return {
    id: "push",
    label: "Push API",
    // Feeds whatever the caller says it feeds: see `channel` on RawCandidate.
    channels: null,
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
    // Synthetic fixtures standing in for every channel, so a dry run still
    // exercises every rule rather than only the ones reading press coverage.
    channels: null,
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

export function listSources(nicheQueries?: string[]): SourceAdapter[] {
  return [webzAdapter(nicheQueries), ...restAdapters(), pushAdapter()];
}

/**
 * Sources EngineX can pull on a schedule (push sources are excluded).
 *
 * Takes the tenant's niche queries so a polled run searches their market, not
 * the default one.
 */
export function pullSources(nicheQueries?: string[]): SourceAdapter[] {
  return listSources(nicheQueries).filter((s) => s.pull && s.configured);
}

export function hasPullSource(): boolean {
  return pullSources().length > 0;
}

/** The adapter for a dry run: same shape, no credentials, no writes. */
export function sampleSource(): SourceAdapter {
  return sampleAdapter();
}

export function sourceStatuses(): SourceStatus[] {
  return listSources().map(
    ({ id, label, channels, docsUrl, envVars, configured, pull, notes, problem }) => ({
      id,
      label,
      channels,
      docsUrl,
      envVars,
      configured,
      pull,
      notes,
      problem: problem ?? null,
    }),
  );
}
