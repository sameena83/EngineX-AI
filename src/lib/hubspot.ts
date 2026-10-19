// HubSpot CRM adapter.
//
// The other destinations on /integrations are inbound webhooks: EngineX POSTs a
// payload and is done (see ./integrations.ts). HubSpot is not that — it is an API
// the app has to *drive*: find or create the company, open a deal, attach the
// evidence as a note. So it gets its own module, the same way email does.
//
// Auth is a private-app access token sent as a Bearer header, configured once per
// deployment (`HUBSPOT_ACCESS_TOKEN`). Nothing here is per-tenant except the
// pipeline and stage a customer wants deals in, which live on their integration
// row: a token is a deployment credential, not customer data.
//
// With no token — or with HUBSPOT_DRY_RUN=1 — every call returns a *plan* instead
// of a request, so the whole path stays exercisable offline and nothing lands in
// someone's CRM by accident.
//
// API notes (verified against developers.hubspot.com, see README):
//   - Companies are matched on the `domain` unique property, so a re-sync updates
//     the company HubSpot already has rather than creating a duplicate.
//   - Deals take internal pipeline/stage IDs, never their display labels.
//   - Associating two records is the v4 associations endpoint; the standard type
//     ids are fixed constants below (279 contact→company, 341 deal→company).
//   - Evidence is a Note object (`hs_timestamp` + `hs_note_body`). The legacy
//     Engagements v1 API is deliberately not used.
//   - Numeric-versioned paths (v3/v4) are what HubSpot documents today but it now
//     calls them legacy and recommends date-versioned APIs; every path is built
//     from the constants below so switching is a one-line change.

export const HUBSPOT_DEFAULT_BASE_URL = "https://api.hubapi.com";

/** Standard HubSpot-defined association type ids, direction-specific. */
export const HUBSPOT_ASSOCIATION = {
  contactToCompany: 279,
  dealToCompany: 341,
  noteToCompany: 190,
  noteToDeal: 214,
} as const;

export type HubspotMode = "live" | "dry_run";

export function hubspotToken(): string {
  return (process.env.HUBSPOT_ACCESS_TOKEN ?? "").trim();
}

/** Whether this deployment can actually call the HubSpot API. */
export function hubspotConfigured(): boolean {
  return hubspotToken().length > 0;
}

export function hubspotBaseUrl(): string {
  return (process.env.HUBSPOT_BASE_URL ?? HUBSPOT_DEFAULT_BASE_URL).replace(/\/$/, "");
}

/**
 * Live only when a token is present and dry run was not forced.
 *
 * HUBSPOT_DRY_RUN exists so a live token can be verified without writing: point
 * the integration at a real portal, leave it dry, and watch the plans first.
 */
export function hubspotMode(): HubspotMode {
  if (!hubspotConfigured()) return "dry_run";
  return process.env.HUBSPOT_DRY_RUN === "1" ? "dry_run" : "live";
}

/* ------------------------------- pipeline -------------------------------- */

export interface HubspotStage {
  id: string;
  label: string;
  /** HubSpot's own semantics: 0 is closed-lost, 1 is closed-won. */
  probability: number | null;
  closed: "won" | "lost" | "open";
}

export interface HubspotPipeline {
  id: string;
  label: string;
  stages: HubspotStage[];
}

/** Map one raw stage, sorting it into won / lost / open rather than guessing. */
export function parseStage(raw: {
  id?: unknown;
  label?: unknown;
  metadata?: { probability?: unknown } | null;
}): HubspotStage {
  const probability =
    typeof raw.metadata?.probability === "number"
      ? raw.metadata.probability
      : typeof raw.metadata?.probability === "string" && raw.metadata.probability.trim() !== ""
        ? Number(raw.metadata.probability)
        : null;
  const closed: HubspotStage["closed"] =
    probability === 1 ? "won" : probability === 0 ? "lost" : "open";
  return {
    id: String(raw.id ?? ""),
    label: String(raw.label ?? ""),
    probability: Number.isFinite(probability as number) ? (probability as number) : null,
    closed,
  };
}

export function parsePipelines(payload: unknown): HubspotPipeline[] {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.map((raw) => {
    const row = raw as { id?: unknown; label?: unknown; stages?: unknown };
    return {
      id: String(row.id ?? ""),
      label: String(row.label ?? ""),
      stages: Array.isArray(row.stages)
        ? row.stages.map((s) => parseStage(s as Parameters<typeof parseStage>[0]))
        : [],
    };
  });
}

/* ------------------------------ request bodies --------------------------- */

export interface HubspotCompanyInput {
  /** The company's domain, which is what HubSpot matches on. */
  domain: string;
  name: string;
  employees?: number | null;
  /**
   * Free text we do control: sector, headcount and location as EngineX knows them.
   * Deliberately not split into HubSpot's city/country properties — "Chicago, IL"
   * and "Rotterdam, NL" do not parse into the same fields, and a wrong city is
   * worse than none.
   */
  description?: string | null;
}

/**
 * Batch upsert by domain.
 *
 * `idProperty: "domain"` is the whole point: it makes the call idempotent, so the
 * nightly digest updating a company and the alert opening a deal for it cannot
 * produce two records for one customer.
 */
export function companyUpsertBody(companies: HubspotCompanyInput[]) {
  return {
    inputs: companies.map((c) => ({
      id: c.domain,
      idProperty: "domain",
      properties: {
        name: c.name,
        domain: c.domain,
        ...(typeof c.employees === "number" && c.employees > 0
          ? { numberofemployees: String(c.employees) }
          : {}),
        ...(c.description ? { description: c.description.slice(0, 1000) } : {}),
      },
    })),
  };
}

export interface HubspotDealInput {
  name: string;
  pipelineId: string;
  stageId: string;
  description?: string | null;
  /** ISO date; HubSpot wants UTC midnight for the date-only closedate property. */
  closeDate?: string | null;
}

export function dealBody(deal: HubspotDealInput) {
  return {
    properties: {
      dealname: deal.name.slice(0, 120),
      pipeline: deal.pipelineId,
      dealstage: deal.stageId,
      ...(deal.closeDate ? { closedate: deal.closeDate } : {}),
      ...(deal.description ? { description: deal.description.slice(0, 65000) } : {}),
    },
  };
}

export interface HubspotNoteLink {
  toType: "companies" | "deals" | "contacts";
  toId: string;
  associationTypeId: number;
}

/** A Note object, linked at creation. `hs_timestamp` is required by HubSpot. */
export function noteBody(text: string, links: HubspotNoteLink[], at: Date) {
  return {
    properties: {
      hs_timestamp: at.toISOString(),
      hs_note_body: text.slice(0, 65000),
    },
    associations: links.map((l) => ({
      to: { id: l.toId },
      types: [
        { associationCategory: "HUBSPOT_DEFINED" as const, associationTypeId: l.associationTypeId },
      ],
    })),
  };
}

/* --------------------------------- retry --------------------------------- */

/** Burst limits are per ten seconds, so a short wait is enough for the first 429. */
export const HUBSPOT_MAX_ATTEMPTS = 3;

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * `Retry-After` wins when HubSpot sends it — the docs do not promise it on every
 * 429 — and is capped so a bad header cannot stall an ingestion run. Otherwise:
 * exponential backoff with jitter, because several accounts syncing at once hit
 * the same limit and would otherwise retry in lockstep.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterHeader?: string | null,
  random: () => number = Math.random,
): number {
  const header = (retryAfterHeader ?? "").trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      const wait = asDate - Date.now();
      if (wait > 0) return Math.min(wait, 10_000);
      return 0;
    }
  }
  const base = 250 * 2 ** attempt;
  return Math.min(base + Math.floor(random() * 100), 10_000);
}

export function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/* -------------------------------- requests ------------------------------- */

export class HubspotError extends Error {
  readonly status: number | null;
  readonly detail: string;

  constructor(message: string, status: number | null, detail = "") {
    super(message);
    this.name = "HubspotError";
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One authenticated call, with the retry policy applied.
 *
 * `path` is a HubSpot path (`/crm/v3/objects/deals`). The caller supplies no
 * headers: the token never travels through a caller's code.
 */
export async function hubspotFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
  options: { sleepMs?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<unknown> {
  const token = hubspotToken();
  if (!token) {
    throw new HubspotError(
      "HUBSPOT_ACCESS_TOKEN is not set, so no HubSpot request can be made",
      null,
    );
  }
  const wait = options.sleepMs ?? sleep;
  const url = `${hubspotBaseUrl()}${path}`;
  let last: HubspotError | null = null;

  for (let attempt = 0; attempt < HUBSPOT_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (err) {
      // A transport failure is worth one more try; a 4xx is not.
      last = new HubspotError(
        `HubSpot request failed: ${err instanceof Error ? err.message : "network error"}`,
        null,
      );
      if (attempt === HUBSPOT_MAX_ATTEMPTS - 1) throw last;
      await wait(retryDelayMs(attempt, null, options.random));
      continue;
    }

    if (res.ok) {
      if (res.status === 204) return null;
      return await res.json().catch(() => null);
    }

    const text = await res.text().catch(() => "");
    last = new HubspotError(
      `HubSpot HTTP ${res.status}`,
      res.status,
      text.slice(0, 400),
    );
    if (!shouldRetry(res.status) || attempt === HUBSPOT_MAX_ATTEMPTS - 1) throw last;
    await wait(retryDelayMs(attempt, res.headers.get("retry-after"), options.random));
  }

  throw last ?? new HubspotError("HubSpot request failed", null);
}

/* -------------------------------- operations ----------------------------- */

function firstId(payload: unknown, key = "results"): string | null {
  const rows = (payload as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const id = (rows[0] as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

/** Create or update one company, matched on its domain. Returns its HubSpot id. */
export async function hubspotUpsertCompany(
  company: HubspotCompanyInput,
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<{ id: string; payload: unknown }> {
  const payload = companyUpsertBody([company]);
  const result = await hubspotFetch(
    "/crm/v3/objects/companies/batch/upsert",
    { method: "POST", body: payload },
    options,
  );
  const id = firstId(result);
  if (!id) throw new HubspotError("HubSpot returned no company id for the upsert", null);
  return { id, payload };
}

export async function hubspotCreateDeal(
  deal: HubspotDealInput,
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<{ id: string; payload: unknown }> {
  const payload = dealBody(deal);
  const result = await hubspotFetch("/crm/v3/objects/deals", { method: "POST", body: payload }, options);
  const id = (result as { id?: unknown } | null)?.id;
  if (id === undefined || id === null) {
    throw new HubspotError("HubSpot returned no deal id", null);
  }
  return { id: String(id), payload };
}

export async function hubspotAssociate(
  fromType: "deals" | "contacts" | "notes",
  fromId: string,
  toType: "companies" | "deals" | "contacts",
  toId: string,
  associationTypeId: number,
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<unknown> {
  return hubspotFetch(
    `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
    {
      method: "PUT",
      body: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId }],
    },
    options,
  );
}

export async function hubspotCreateNote(
  text: string,
  links: HubspotNoteLink[],
  at: Date,
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<{ id: string | null; payload: unknown }> {
  const payload = noteBody(text, links, at);
  const result = await hubspotFetch("/crm/v3/objects/notes", { method: "POST", body: payload }, options);
  const id = (result as { id?: unknown } | null)?.id;
  return { id: id === undefined || id === null ? null : String(id), payload };
}

/** Read-only: the pipelines and stages this portal actually has. */
export async function hubspotPipelines(
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<HubspotPipeline[]> {
  return parsePipelines(await hubspotFetch("/crm/v3/pipelines/deals", {}, options));
}

/* ---------------------------------- sync --------------------------------- */

export type HubspotCompanyPlan = HubspotCompanyInput;
export type HubspotDealPlan = HubspotDealInput;
export interface HubspotNotePlan {
  text: string;
  links: HubspotNoteLink[];
}

export interface HubspotSyncPlan {
  company: HubspotCompanyPlan;
  deal?: HubspotDealPlan;
  note?: HubspotNotePlan;
}

export interface HubspotAction {
  step: "company" | "deal" | "associate" | "note";
  ok: boolean;
  id: string | null;
  detail: string;
}

export interface HubspotSyncResult {
  mode: HubspotMode;
  ok: boolean;
  companyId: string | null;
  dealId: string | null;
  noteId: string | null;
  actions: HubspotAction[];
  /** Populated in dry-run: exactly what would have been sent, in order. */
  planned: { path: string; body: unknown }[];
  error: string | null;
}

/**
 * Run one account through HubSpot: company first, then the deal and/or the note
 * attached to it.
 *
 * Company first is not an implementation detail, it is the contract: a deal that
 * is not attached to a company is not something a salesperson can work, and a note
 * with nothing to hang off would be orphaned.
 */
export async function hubspotSyncAccount(
  plan: HubspotSyncPlan,
  at: Date = new Date(),
  options?: Parameters<typeof hubspotFetch>[2],
): Promise<HubspotSyncResult> {
  const mode = hubspotMode();
  const actions: HubspotAction[] = [];
  const planned: { path: string; body: unknown }[] = [];

  if (mode === "dry_run") {
    planned.push({
      path: "/crm/v3/objects/companies/batch/upsert",
      body: companyUpsertBody([plan.company]),
    });
    if (plan.deal) {
      planned.push({ path: "/crm/v3/objects/deals", body: dealBody(plan.deal) });
      planned.push({
        path: "/crm/v4/objects/deals/{dealId}/associations/companies/{companyId}",
        body: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HUBSPOT_ASSOCIATION.dealToCompany }],
      });
    }
    if (plan.note) {
      planned.push({
        path: "/crm/v3/objects/notes",
        body: noteBody(
          plan.note.text,
          plan.note.links.map((l) => ({ ...l, toId: l.toId || "{companyId}" })),
          at,
        ),
      });
    }
    return {
      mode,
      ok: true,
      companyId: null,
      dealId: null,
      noteId: null,
      actions: [
        {
          step: "company",
          ok: true,
          id: null,
          detail: "Dry run: nothing was written to HubSpot. Set HUBSPOT_ACCESS_TOKEN to go live.",
        },
      ],
      planned,
      error: null,
    };
  }

  try {
    const company = await hubspotUpsertCompany(plan.company, options);
    actions.push({ step: "company", ok: true, id: company.id, detail: plan.company.domain });

    let dealId: string | null = null;
    if (plan.deal) {
      const deal = await hubspotCreateDeal(plan.deal, options);
      dealId = deal.id;
      actions.push({ step: "deal", ok: true, id: deal.id, detail: plan.deal.name });
      await hubspotAssociate("deals", deal.id, "companies", company.id, HUBSPOT_ASSOCIATION.dealToCompany, options);
      actions.push({
        step: "associate",
        ok: true,
        id: deal.id,
        detail: `deal ${deal.id} → company ${company.id}`,
      });
    }

    let noteId: string | null = null;
    if (plan.note) {
      // The note's links point at the records this run just created, which is why
      // they are resolved here rather than by the caller.
      const links: HubspotNoteLink[] = plan.note.links.map((l) => ({
        ...l,
        toId: l.toType === "companies" ? company.id : (dealId ?? l.toId),
        associationTypeId:
          l.toType === "companies" ? HUBSPOT_ASSOCIATION.noteToCompany : HUBSPOT_ASSOCIATION.noteToDeal,
      }));
      const note = await hubspotCreateNote(plan.note.text, links, at, options);
      noteId = note.id;
      actions.push({ step: "note", ok: true, id: note.id, detail: `${links.length} link(s)` });
    }

    return {
      mode,
      ok: true,
      companyId: company.id,
      dealId,
      noteId,
      actions,
      planned: [],
      error: null,
    };
  } catch (err) {
    const message = err instanceof HubspotError ? err.message : "HubSpot sync failed";
    const detail = err instanceof HubspotError ? err.detail : "";
    actions.push({
      step: "company",
      ok: false,
      id: null,
      detail: detail ? `${message} — ${detail}` : message,
    });
    return {
      mode,
      ok: false,
      companyId: null,
      dealId: null,
      noteId: null,
      actions,
      planned: [],
      error: detail ? `${message}: ${detail}` : message,
    };
  }
}
