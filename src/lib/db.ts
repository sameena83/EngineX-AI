// The data layer: every read and write in the app goes through this module.
//
// Two things changed from the SQLite version:
//
//   1. Storage is Postgres (see ./pg/pool.ts and ./pg/migrations.ts), so every
//      function is async. The schema is applied on demand and recorded in
//      schema_migrations, so a running deployment picks up a new table without
//      a restart.
//
//   2. The app is multi-tenant. Every customer-owned table carries a tenant_id
//      and **every function here takes the tenant id as its first argument**.
//      That is deliberate: you cannot read another consultancy's data by
//      forgetting to scope a query, because the scope is a required parameter
//      rather than an implicit global. A tenant id that does not match simply
//      returns nothing.
//
// Callers resolve the tenant once (see ./tenant.ts) and pass it down.

import { asChannels } from "./channels";
import { DEFAULT_PROFILE, SEED_ACCOUNTS } from "./seed-data";
import { NotFoundError } from "./errors";
import { DEFAULT_NICHE, nichePreset, presetChannelsFor } from "./niches";
import { migrate } from "./pg/migrations";
import { one, query, tx } from "./pg/pool";
import type {
  Account,
  Brief,
  Contact,
  Draft,
  Integration,
  IntegrationKind,
  Member,
  NicheConfig,
  Outcome,
  Profile,
  SendRecord,
  Signal,
  SignalCorrection,
  SignalDefinition,
  Tenant,
  Vocabulary,
} from "./types";
import { nicheConfigFromPreset, presetToVocabulary, resolveImplicitRouting } from "./vocab";

/* --------------------------- schema readiness ---------------------------- */

let readyPromise: Promise<void> | null = null;

/**
 * Apply migrations once per process before the first query. Memoised, so the
 * cost is a no-op after the first call. A failure clears the memo so the next
 * request retries instead of the process being stuck broken until a restart.
 */
function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = migrate()
      .then(() => undefined)
      .catch((err: unknown) => {
        readyPromise = null;
        throw err;
      });
  }
  return readyPromise;
}

async function q<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ready();
  return query<T>(text, params);
}

async function q1<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  await ready();
  return one<T>(text, params);
}

async function txn<T>(fn: Parameters<typeof tx<T>>[0]): Promise<T> {
  await ready();
  return tx(fn);
}

/** Exposed for scripts and tests that need the schema in place up front. */
export async function ensureReady(): Promise<void> {
  await ready();
}

/* ------------------------------- tenants --------------------------------- */

function mapTenant(r: Record<string, unknown>): Tenant {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    plan: String(r.plan) as Tenant["plan"],
    market: String(r.market),
    clerkOrgId: r.clerk_org_id ? String(r.clerk_org_id) : null,
    createdAt: iso(r.created_at),
  };
}

/** The company workspace an organization maps to, if it has one yet. */
export async function getTenantByClerkOrgId(orgId: string): Promise<Tenant | null> {
  const row = await q1("SELECT * FROM tenants WHERE clerk_org_id = $1", [orgId]);
  return row ? mapTenant(row) : null;
}

/**
 * Claim a workspace for an organization.
 *
 * Two requests can arrive together the first time a company signs in, and the
 * unique index is what decides: the loser reads back the winner's row instead of
 * failing, so both requests land in the same workspace.
 */
export async function claimTenantForOrg(tenantId: number, orgId: string): Promise<Tenant> {
  const row = await q1(
    "UPDATE tenants SET clerk_org_id = $2 WHERE id = $1 AND clerk_org_id IS NULL RETURNING *",
    [tenantId, orgId],
  );
  if (row) return mapTenant(row);
  const existing = await getTenantByClerkOrgId(orgId);
  if (existing) return existing;
  // Neither: the row is gone, or another workspace claimed the organization in
  // between. Both are answered by looking the organization up again.
  throw new NotFoundError("Workspace not found");
}

export async function getTenant(id: number): Promise<Tenant | null> {
  const row = await q1("SELECT * FROM tenants WHERE id = $1", [id]);
  return row ? mapTenant(row) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const row = await q1("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return row ? mapTenant(row) : null;
}

/**
 * Find a tenant by slug, creating it (and its starter workspace) when absent.
 * Sign-up calls this once per new consultancy.
 */
export async function findOrCreateTenant(input: {
  slug: string;
  name: string;
}): Promise<Tenant> {
  const existing = await getTenantBySlug(input.slug);
  if (existing) return existing;
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name
     RETURNING *`,
    [input.slug, input.name],
  );
  const tenant = mapTenant(row as Record<string, unknown>);
  await seedTenant(tenant.id);
  return tenant;
}

export async function listMembers(tenantId: number): Promise<Member[]> {
  const rows = await q("SELECT * FROM members WHERE tenant_id = $1 ORDER BY id", [tenantId]);
  return rows.map(mapMember);
}

/**
 * Every workspace on the deployment.
 *
 * Only the scheduler wants this: a cron run needs to visit each customer's
 * workspace, because midnight for one is midnight for all. Everything a request
 * does stays scoped to the one tenant it resolved (see ./tenant.ts).
 */
export async function listTenants(): Promise<Tenant[]> {
  const rows = await q("SELECT * FROM tenants ORDER BY id");
  return rows.map(mapTenant);
}

/** Tenants a user can open. Used to pick the active workspace after sign-in. */
export async function tenantsForUser(userId: string): Promise<Tenant[]> {
  const rows = await q(
    `SELECT t.* FROM tenants t
     JOIN members m ON m.tenant_id = t.id
     WHERE m.user_id = $1
     ORDER BY t.created_at`,
    [userId],
  );
  return rows.map(mapTenant);
}

export async function upsertMember(input: {
  tenantId: number;
  userId: string;
  email: string | null;
  role?: Member["role"];
}): Promise<Member> {
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO members (tenant_id, user_id, email, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET
       -- Keep a known address when the provider stops returning one: the session
       -- token only carries an email when the JWT template includes it, so a
       -- null here is "not sent", not "cleared".
       email = COALESCE(excluded.email, members.email),
       role = excluded.role
     RETURNING *`,
    [input.tenantId, input.userId, input.email, input.role ?? "owner"],
  );
  return mapMember(row as Record<string, unknown>);
}

export async function setTenantPlan(tenantId: number, plan: Tenant["plan"]): Promise<void> {
  await q("UPDATE tenants SET plan = $1 WHERE id = $2", [plan, tenantId]);
}

/* --------------------------- the service profile ------------------------- */

export async function getProfile(tenantId: number): Promise<Profile> {
  const row = await q1<{ profile_json: Profile }>(
    "SELECT profile_json FROM profiles WHERE tenant_id = $1",
    [tenantId],
  );
  if (!row) {
    await saveProfile(tenantId, DEFAULT_PROFILE);
    return DEFAULT_PROFILE;
  }
  const parsed = (row.profile_json ?? {}) as Partial<Profile>;
  // Backfill fields added after a workspace was first stored.
  return {
    ...DEFAULT_PROFILE,
    ...parsed,
    idealClient: { ...DEFAULT_PROFILE.idealClient, ...(parsed.idealClient ?? {}) },
    sender: { ...DEFAULT_PROFILE.sender, ...(parsed.sender ?? {}) },
    delivery: { ...DEFAULT_PROFILE.delivery, ...(parsed.delivery ?? {}) },
    niche: parsed.niche ?? DEFAULT_NICHE,
    nicheConfig: mergeNicheConfig(parsed.nicheConfig),
  } as Profile;
}

/**
 * A stored niche config, completed against its preset.
 *
 * `scoring` is merged key by key rather than wholesale: a workspace that stored
 * a config before `halfLifeDays` existed must not come back with `undefined`, or
 * every signal would score as infinitely stale.
 */
function mergeNicheConfig(stored: Partial<NicheConfig> | undefined): NicheConfig {
  const preset = nicheConfigFromPreset(nichePreset(stored?.key));
  if (!stored) return preset;
  return {
    ...preset,
    ...stored,
    scoring: { ...preset.scoring, ...(stored.scoring ?? {}) },
    buyerRoles: stored.buyerRoles ?? preset.buyerRoles,
    exclusions: stored.exclusions ?? preset.exclusions,
    negativeRules: stored.negativeRules ?? preset.negativeRules,
    sourceQueries: stored.sourceQueries ?? preset.sourceQueries,
  };
}

/* ---------------------------- the vocabulary ----------------------------- */

/**
 * A tenant's signal vocabulary. Seeded from their niche preset on first read, so
 * a workspace created before this table existed (or by a niche switch that
 * failed halfway) still comes back with a complete, usable set of signals.
 */
export async function getVocabulary(tenantId: number): Promise<Vocabulary> {
  const rows = await q(
    "SELECT * FROM signal_definitions WHERE tenant_id = $1 ORDER BY position, type",
    [tenantId],
  );
  if (rows.length > 0) {
    // Rows whose channels were never chosen follow the presets for their rule
    // key, resolved here so every reader — classification, scoring, the API, the
    // routing diagnostic — sees the routing that is actually applied.
    return resolveImplicitRouting(rows.map(mapSignalDefinition), presetChannelsFor);
  }

  // Nothing stored yet: fall back to the tenant's preset and persist it, so the
  // next read is a plain query and the user has something to edit.
  const profile = await getProfile(tenantId);
  const vocabulary = presetToVocabulary(nichePreset(profile.niche));
  await saveVocabulary(tenantId, vocabulary);
  return vocabulary;
}

/** Replace the whole vocabulary. A signal's key is its identity, so this is a diff. */
export async function saveVocabulary(
  tenantId: number,
  vocabulary: Vocabulary,
): Promise<void> {
  await txn(async (client) => {
    await client.query(
      "DELETE FROM signal_definitions WHERE tenant_id = $1 AND NOT (type = ANY($2::text[]))",
      [tenantId, vocabulary.map((d) => d.type)],
    );
    for (const [position, def] of vocabulary.entries()) {
      await client.query(
        `INSERT INTO signal_definitions
           (tenant_id, type, label, short_label, weight, why, patterns, service_keywords, sources, sources_explicit, position, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, now())
         ON CONFLICT (tenant_id, type) DO UPDATE SET
           label = excluded.label,
           short_label = excluded.short_label,
           weight = excluded.weight,
           why = excluded.why,
           patterns = excluded.patterns,
           service_keywords = excluded.service_keywords,
           sources = excluded.sources,
           sources_explicit = excluded.sources_explicit,
           position = excluded.position,
           updated_at = now()`,
        [
          tenantId,
          def.type,
          def.label,
          def.shortLabel,
          def.weight,
          def.why,
          JSON.stringify(def.patterns),
          JSON.stringify(def.serviceKeywords),
          JSON.stringify(def.sources ?? []),
          // Undefined means the caller had no opinion, which can only mean the
          // channels were deliberately set — the one path that writes rows
          // without the flag is the preset itself.
          def.sourcesExplicit !== false,
          position,
        ],
      );
    }
  });
}

/**
 * Point a workspace at a different niche in one step: swap the signal
 * vocabulary, the niche config, and (by default) the service list that the
 * service matcher reads.
 *
 * Existing signals are deliberately left alone. They were real evidence when
 * they were collected, and the scorer still counts them at a neutral weight (see
 * `definitionFor`), so switching market does not silently erase history — it
 * re-labels it. The feed shows the old signals under `out` only if they no
 * longer fit the new services.
 */
export async function applyNichePreset(
  tenantId: number,
  key: string,
  options: { replaceServices?: boolean } = {},
): Promise<{ profile: Profile; vocabulary: Vocabulary }> {
  const preset = nichePreset(key);
  const vocabulary = presetToVocabulary(preset);
  await saveVocabulary(tenantId, vocabulary);

  const current = await getProfile(tenantId);
  const next: Profile = {
    ...current,
    niche: preset.key,
    nicheConfig: nicheConfigFromPreset(preset),
    services:
      options.replaceServices === false
        ? current.services
        : preset.services.map((s) => ({ ...s })),
  };
  await saveProfile(tenantId, next);
  return { profile: next, vocabulary };
}

export async function saveProfile(tenantId: number, profile: Profile): Promise<void> {
  await q(
    `INSERT INTO profiles (tenant_id, profile_json, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       updated_at = now()`,
    [tenantId, JSON.stringify(profile)],
  );
}

/* ------------------------------- reads ---------------------------------- */

export async function listAccounts(tenantId: number): Promise<Account[]> {
  const rows = await q("SELECT * FROM accounts WHERE tenant_id = $1 ORDER BY name", [tenantId]);
  return rows.map(mapAccount);
}

export async function getAccount(tenantId: number, id: number): Promise<Account | null> {
  const row = await q1("SELECT * FROM accounts WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  return row ? mapAccount(row) : null;
}

export async function listSignals(tenantId: number): Promise<Signal[]> {
  const rows = await q(
    "SELECT * FROM signals WHERE tenant_id = $1 ORDER BY detected_at DESC",
    [tenantId],
  );
  return rows.map(mapSignal);
}

export async function getSignalsForAccount(
  tenantId: number,
  accountId: number,
): Promise<Signal[]> {
  const rows = await q(
    "SELECT * FROM signals WHERE tenant_id = $1 AND account_id = $2 ORDER BY detected_at DESC",
    [tenantId, accountId],
  );
  return rows.map(mapSignal);
}

export async function getContactsForAccount(
  tenantId: number,
  accountId: number,
): Promise<Contact[]> {
  const rows = await q(
    `SELECT * FROM contacts
     WHERE tenant_id = $1 AND account_id = $2
     ORDER BY is_decision_maker DESC, name`,
    [tenantId, accountId],
  );
  return rows.map(mapContact);
}

export async function getBriefForAccount(
  tenantId: number,
  accountId: number,
): Promise<Brief | null> {
  const row = await q1(
    "SELECT * FROM briefs WHERE tenant_id = $1 AND account_id = $2 ORDER BY id DESC LIMIT 1",
    [tenantId, accountId],
  );
  return row ? mapBrief(row) : null;
}

export async function getDraftsForAccount(
  tenantId: number,
  accountId: number,
): Promise<Draft[]> {
  const rows = await q(
    "SELECT * FROM drafts WHERE tenant_id = $1 AND account_id = $2 ORDER BY id",
    [tenantId, accountId],
  );
  return rows.map(mapDraft);
}

export async function listDrafts(tenantId: number): Promise<Draft[]> {
  const rows = await q(
    "SELECT * FROM drafts WHERE tenant_id = $1 ORDER BY created_at DESC",
    [tenantId],
  );
  return rows.map(mapDraft);
}

export async function listDraftsWithAccount(
  tenantId: number,
): Promise<(Draft & { accountName: string; accountDomain: string })[]> {
  const rows = await q(
    `SELECT d.*, a.name AS account_name, a.domain AS account_domain
     FROM drafts d JOIN accounts a ON a.id = d.account_id
     WHERE d.tenant_id = $1
     ORDER BY d.created_at DESC, d.id`,
    [tenantId],
  );
  return rows.map((r) => ({
    ...mapDraft(r),
    accountName: String(r.account_name),
    accountDomain: String(r.account_domain),
  }));
}

export async function getSignal(tenantId: number, id: number): Promise<Signal | null> {
  const row = await q1("SELECT * FROM signals WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  return row ? mapSignal(row) : null;
}

export async function getDraft(tenantId: number, id: number): Promise<Draft | null> {
  const row = await q1("SELECT * FROM drafts WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  return row ? mapDraft(row) : null;
}

/* --------------------- ingestion: accounts and signals ------------------ */

/**
 * Create an account discovered by a signal source. Used by the ingestion path
 * (see ./ingest.ts); the sample market seed is the only other writer.
 */
export async function insertAccount(
  tenantId: number,
  input: {
    name: string;
    domain: string;
    sector: string;
    employees: number;
    location: string;
    description: string;
  },
): Promise<Account> {
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO accounts (tenant_id, name, domain, sector, employees, location, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
     RETURNING *`,
    [
      tenantId,
      input.name,
      input.domain,
      input.sector,
      input.employees,
      input.location,
      input.description,
    ],
  );
  return mapAccount(row as Record<string, unknown>);
}

/**
 * Fill in blanks on an account we already know. A source must never overwrite a
 * good value with "Unknown", so only empty placeholders are replaced.
 */
export async function enrichAccount(
  tenantId: number,
  id: number,
  patch: Partial<Pick<Account, "domain" | "sector" | "employees" | "location">>,
): Promise<void> {
  const current = await getAccount(tenantId, id);
  if (!current) return;
  const next = {
    domain: current.domain || patch.domain || "",
    sector: isEmptyPlaceholder(current.sector) ? patch.sector ?? current.sector : current.sector,
    employees: current.employees > 0 ? current.employees : Math.max(0, patch.employees ?? 0),
    location: isEmptyPlaceholder(current.location)
      ? patch.location ?? current.location
      : current.location,
  };
  if (
    next.domain === current.domain &&
    next.sector === current.sector &&
    next.employees === current.employees &&
    next.location === current.location
  ) {
    return;
  }
  await q(
    "UPDATE accounts SET domain = $1, sector = $2, employees = $3, location = $4 WHERE tenant_id = $5 AND id = $6",
    [next.domain, next.sector, next.employees, next.location, tenantId, id],
  );
}

/**
 * Confirm an account belongs to the calling tenant before writing against it.
 *
 * The composite foreign keys in migration 2 already make a cross-tenant write
 * impossible, but they surface as a database error. This turns the same mistake
 * into a clean 404, and makes the tenant check explicit at the call site.
 */
async function assertAccount(tenantId: number, accountId: number): Promise<void> {
  const row = await q1(
    "SELECT 1 AS ok FROM accounts WHERE tenant_id = $1 AND id = $2",
    [tenantId, accountId],
  );
  if (!row) throw new NotFoundError("Account not found");
}

function isEmptyPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || v === "unknown" || v === "n/a";
}

/**
 * Insert a signal unless an equivalent one already exists. The partial unique
 * index on (tenant_id, dedupe_key) does the checking, so a repeated sighting of
 * the same event is a no-op rather than an error. Returns null when it was a
 * duplicate.
 */
export async function insertSignalIfNew(
  tenantId: number,
  input: {
    accountId: number;
    type: Signal["type"];
    summary: string;
    evidence: string;
    source: string;
    sourceUrl: string | null;
    /** When the event happened, from the source. */
    eventAt: string;
    /** When we first saw it. */
    detectedAt: string;
    strength: number;
    dedupeKey: string;
  },
): Promise<Signal | null> {
  await assertAccount(tenantId, input.accountId);
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO signals
       (tenant_id, account_id, type, summary, evidence, source, source_url, event_at, detected_at, strength, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      tenantId,
      input.accountId,
      input.type,
      input.summary,
      input.evidence,
      input.source,
      input.sourceUrl,
      input.eventAt,
      input.detectedAt,
      input.strength,
      input.dedupeKey,
    ],
  );
  return row ? mapSignal(row) : null;
}

/* --------------------------- trust corrections -------------------------- */

/** Remove a signal a human judged wrong. Returns whether there was one to remove. */
export async function deleteSignal(tenantId: number, id: number): Promise<boolean> {
  const rows = await q("DELETE FROM signals WHERE tenant_id = $1 AND id = $2 RETURNING id", [
    tenantId,
    id,
  ]);
  return rows.length > 0;
}

/**
 * Keep the evidence of a rejected signal. The row is a record of what the engine
 * got wrong — it never counts towards a score, because the signal itself is gone.
 */
export async function recordSignalCorrection(
  tenantId: number,
  input: { signal: Signal; reason: string | null },
): Promise<SignalCorrection> {
  const s = input.signal;
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO signal_corrections
       (tenant_id, signal_id, account_id, type, summary, evidence, source, source_url, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING *`,
    [tenantId, s.id, s.accountId, s.type, s.summary, s.evidence, s.source, s.sourceUrl, input.reason],
  );
  return mapSignalCorrection(row as Record<string, unknown>);
}

export async function listSignalCorrections(
  tenantId: number,
  accountId?: number,
): Promise<SignalCorrection[]> {
  const rows = accountId
    ? await q(
        `SELECT * FROM signal_corrections
         WHERE tenant_id = $1 AND account_id = $2
         ORDER BY created_at DESC, id DESC`,
        [tenantId, accountId],
      )
    : await q(
        `SELECT * FROM signal_corrections
         WHERE tenant_id = $1
         ORDER BY created_at DESC, id DESC`,
        [tenantId],
      );
  return rows.map(mapSignalCorrection);
}

/* ------------------------------- writes --------------------------------- */

export async function setAccountStatus(
  tenantId: number,
  id: number,
  status: Account["status"],
): Promise<void> {
  await q("UPDATE accounts SET status = $1 WHERE tenant_id = $2 AND id = $3", [
    status,
    tenantId,
    id,
  ]);
}

export async function saveBrief(
  tenantId: number,
  accountId: number,
  b: Omit<Brief, "id" | "accountId" | "createdAt">,
): Promise<Brief> {
  await assertAccount(tenantId, accountId);
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO briefs
       (tenant_id, account_id, why_now, likely_pain, case_study_angle, who_to_contact, generated_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [
      tenantId,
      accountId,
      b.whyNow,
      b.likelyPain,
      b.caseStudyAngle,
      b.whoToContact,
      b.generatedBy,
    ],
  );
  return mapBrief(row as Record<string, unknown>);
}

export async function replaceDrafts(
  tenantId: number,
  accountId: number,
  drafts: Omit<Draft, "id" | "accountId" | "createdAt">[],
): Promise<Draft[]> {
  await assertAccount(tenantId, accountId);
  // Replace is all-or-nothing: a partial failure must not leave an account with
  // half a new set of drafts.
  return txn(async (client) => {
    await client.query("DELETE FROM drafts WHERE tenant_id = $1 AND account_id = $2", [
      tenantId,
      accountId,
    ]);
    const out: Draft[] = [];
    for (const d of drafts) {
      const res = await client.query<Record<string, unknown>>(
        `INSERT INTO drafts
           (tenant_id, account_id, channel, subject, body, tone, length, status, generated_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING *`,
        [
          tenantId,
          accountId,
          d.channel,
          d.subject,
          d.body,
          d.tone,
          d.length,
          d.status,
          d.generatedBy,
        ],
      );
      out.push(mapDraft(res.rows[0]));
    }
    return out;
  });
}

export async function setDraftStatus(
  tenantId: number,
  id: number,
  status: Draft["status"],
): Promise<void> {
  await q("UPDATE drafts SET status = $1 WHERE tenant_id = $2 AND id = $3", [
    status,
    tenantId,
    id,
  ]);
}

/** Persist a human or agent correction to a draft's text. */
export async function updateDraftText(
  tenantId: number,
  id: number,
  subject: string | null,
  body: string,
): Promise<Draft | null> {
  const row = await q1(
    "UPDATE drafts SET subject = $1, body = $2 WHERE tenant_id = $3 AND id = $4 RETURNING *",
    [subject, body, tenantId, id],
  );
  return row ? mapDraft(row) : null;
}

/* --------------------------- integrations ------------------------------- */

export async function listIntegrations(tenantId: number): Promise<Integration[]> {
  const rows = await q(
    "SELECT * FROM integrations WHERE tenant_id = $1 ORDER BY kind",
    [tenantId],
  );
  return rows.map(mapIntegration);
}

export async function upsertIntegration(
  tenantId: number,
  input: Omit<Integration, "id">,
): Promise<Integration> {
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO integrations (tenant_id, kind, label, url, enabled, events_json, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (tenant_id, kind) DO UPDATE SET
       label = excluded.label,
       url = excluded.url,
       enabled = excluded.enabled,
       events_json = excluded.events_json,
       settings = excluded.settings
     RETURNING *`,
    [
      tenantId,
      input.kind,
      input.label,
      input.url,
      input.enabled ? 1 : 0,
      JSON.stringify(input.events),
      JSON.stringify(input.settings ?? {}),
    ],
  );
  return mapIntegration(row as Record<string, unknown>);
}

export async function deleteIntegration(tenantId: number, id: number): Promise<void> {
  await q("DELETE FROM integrations WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

/* ------------------------------- sends ---------------------------------- */

export async function recordSend(
  tenantId: number,
  input: Omit<SendRecord, "id" | "createdAt">,
): Promise<SendRecord> {
  await assertAccount(tenantId, input.accountId);
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO sends
       (tenant_id, account_id, draft_id, to_email, subject, body, provider, status, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING *`,
    [
      tenantId,
      input.accountId,
      input.draftId,
      input.toEmail,
      input.subject,
      input.body,
      input.provider,
      input.status,
      input.error,
    ],
  );
  return mapSend(row as Record<string, unknown>);
}

export async function listSends(
  tenantId: number,
): Promise<(SendRecord & { accountName: string })[]> {
  const rows = await q(
    `SELECT s.*, a.name AS account_name
     FROM sends s JOIN accounts a ON a.id = s.account_id
     WHERE s.tenant_id = $1
     ORDER BY s.created_at DESC, s.id DESC`,
    [tenantId],
  );
  return rows.map((r) => ({ ...mapSend(r), accountName: String(r.account_name) }));
}

/* ---------------------------- runtime state ----------------------------- */

// Small key/value store for scheduler bookkeeping (last digest run, which
// accounts have already been alerted) — not user-facing configuration.
export async function getState(tenantId: number, key: string): Promise<string | null> {
  const row = await q1<{ value: string }>(
    "SELECT value FROM runtime_state WHERE tenant_id = $1 AND key = $2",
    [tenantId, key],
  );
  return row ? row.value : null;
}

export async function setState(tenantId: number, key: string, value: string): Promise<void> {
  await q(
    `INSERT INTO runtime_state (tenant_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
    [tenantId, key, value],
  );
}

/* ------------------------------ outcomes -------------------------------- */

export async function listOutcomes(
  tenantId: number,
): Promise<(Outcome & { accountName: string })[]> {
  const rows = await q(
    `SELECT o.*, a.name AS account_name
     FROM outcomes o JOIN accounts a ON a.id = o.account_id
     WHERE o.tenant_id = $1
     ORDER BY o.occurred_at DESC, o.id DESC`,
    [tenantId],
  );
  return rows.map((r) => ({ ...mapOutcome(r), accountName: String(r.account_name) }));
}

export async function getOutcomesForAccount(
  tenantId: number,
  accountId: number,
): Promise<Outcome[]> {
  const rows = await q(
    `SELECT * FROM outcomes
     WHERE tenant_id = $1 AND account_id = $2
     ORDER BY occurred_at DESC, id DESC`,
    [tenantId, accountId],
  );
  return rows.map(mapOutcome);
}

export async function recordOutcome(
  tenantId: number,
  accountId: number,
  kind: Outcome["kind"],
  note: string | null,
): Promise<Outcome> {
  await assertAccount(tenantId, accountId);
  const row = await q1<Record<string, unknown>>(
    `INSERT INTO outcomes (tenant_id, account_id, kind, note, occurred_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING *`,
    [tenantId, accountId, kind, note],
  );
  return mapOutcome(row as Record<string, unknown>);
}

export async function deleteOutcome(tenantId: number, id: number): Promise<void> {
  await q("DELETE FROM outcomes WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

/** Account ids that have had at least one email sent. */
export async function contactedAccountIds(tenantId: number): Promise<Set<number>> {
  const rows = await q(
    "SELECT DISTINCT account_id FROM sends WHERE tenant_id = $1",
    [tenantId],
  );
  return new Set(rows.map((r) => Number(r.account_id)));
}

/* ---------------------------- ai usage ---------------------------------- */

/**
 * Add one completed call to a workspace's day.
 *
 * An upsert rather than an insert: the cap is read on every generation, so the
 * table is a per-day counter, and a customer generating twenty briefs writes
 * twenty increments to one row instead of twenty rows to sum.
 */
export async function recordAiUsage(input: {
  tenantId: number;
  day: string;
  model: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}): Promise<void> {
  await q(
    `INSERT INTO ai_usage
       (tenant_id, day, model, purpose, calls, prompt_tokens, completion_tokens, cost_usd, updated_at)
     VALUES ($1, $2::date, $3, $4, 1, $5, $6, $7, now())
     ON CONFLICT (tenant_id, day, model, purpose) DO UPDATE SET
       calls = ai_usage.calls + 1,
       prompt_tokens = ai_usage.prompt_tokens + EXCLUDED.prompt_tokens,
       completion_tokens = ai_usage.completion_tokens + EXCLUDED.completion_tokens,
       cost_usd = ai_usage.cost_usd + EXCLUDED.cost_usd,
       updated_at = now()`,
    [
      input.tenantId,
      input.day,
      input.model,
      input.purpose,
      Math.max(0, Math.round(input.promptTokens)),
      Math.max(0, Math.round(input.completionTokens)),
      input.costUsd,
    ],
  );
}

/** USD this workspace has spent on the model on `day` (UTC). */
export async function aiUsageSpent(tenantId: number, day: string): Promise<number> {
  const row = await q1<{ total: string }>(
    "SELECT COALESCE(SUM(cost_usd), 0)::text AS total FROM ai_usage WHERE tenant_id = $1 AND day = $2::date",
    [tenantId, day],
  );
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** Per-day usage totals for the last `days` days, newest first. */
export async function listAiUsage(tenantId: number, days = 14) {
  const rows = await q(
    `SELECT day::text AS day,
            SUM(calls)::int AS calls,
            SUM(prompt_tokens)::int AS prompt_tokens,
            SUM(completion_tokens)::int AS completion_tokens,
            SUM(cost_usd)::text AS cost_usd
       FROM ai_usage
      WHERE tenant_id = $1
        AND day > (CURRENT_DATE - ($2::int * INTERVAL '1 day'))
      GROUP BY day
      ORDER BY day DESC`,
    [tenantId, Math.max(1, Math.min(365, Math.round(days)))],
  );
  return rows.map((r) => ({
    day: String(r.day),
    calls: Number(r.calls),
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
    costUsd: Number(r.cost_usd),
  }));
}

/* ------------------------------ seeding --------------------------------- */

/**
 * Give a new tenant the sample market so the workspace is never empty on first
 * sign-in. Idempotent: does nothing if the tenant already has accounts.
 */
export async function seedTenant(tenantId: number): Promise<void> {
  // The vocabulary is seeded separately from the sample market: a workspace
  // already holding accounts (or upgraded from before this table existed) still
  // needs its signal definitions, and getVocabulary() would otherwise fall back
  // to a preset the customer has since moved away from.
  const definitions = await q1<{ n: string }>(
    "SELECT COUNT(*) AS n FROM signal_definitions WHERE tenant_id = $1",
    [tenantId],
  );
  if (Number(definitions?.n ?? 0) === 0) {
    await saveVocabulary(tenantId, presetToVocabulary(nichePreset(DEFAULT_PROFILE.niche)));
  }

  const count = await q1<{ n: string }>(
    "SELECT COUNT(*) AS n FROM accounts WHERE tenant_id = $1",
    [tenantId],
  );
  if (Number(count?.n ?? 0) > 0) return;

  await txn(async (client) => {
    // The check above is not enough on its own: a first page load fires several
    // API requests at once, and every one of them sees an empty workspace and
    // seeds it — the sample market arriving in duplicate. The lock serialises
    // those first calls, and the re-check inside it is what makes seeding happen
    // once. Keyed on the tenant, so seeding one workspace never blocks another.
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      918_273_646 + tenantId,
    ]);
    const inside = await client.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM accounts WHERE tenant_id = $1",
      [tenantId],
    );
    if (Number(inside.rows[0]?.n ?? 0) > 0) return;

    await client.query(
      `INSERT INTO profiles (tenant_id, profile_json) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, JSON.stringify(DEFAULT_PROFILE)],
    );

    const now = Date.now();
    for (const acc of SEED_ACCOUNTS) {
      const a = await client.query<{ id: string }>(
        `INSERT INTO accounts (tenant_id, name, domain, sector, employees, location, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
         RETURNING id`,
        [
          tenantId,
          acc.name,
          acc.domain,
          acc.sector,
          acc.employees,
          acc.location,
          acc.description,
        ],
      );
      const accountId = Number(a.rows[0].id);

      for (const s of acc.signals) {
        // Sample signals carry a single age, so event and detection dates match.
        const at = new Date(now - s.daysAgo * 86_400_000).toISOString();
        await client.query(
          `INSERT INTO signals
             (tenant_id, account_id, type, summary, evidence, source, source_url, event_at, detected_at, strength)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            tenantId,
            accountId,
            s.type,
            s.summary,
            s.evidence,
            s.source,
            s.sourceUrl ?? null,
            at,
            at,
            s.strength,
          ],
        );
      }

      for (const c of acc.contacts) {
        const handle = c.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ");
        const email = `${handle[0]}.${handle[handle.length - 1]}@${acc.domain}`;
        await client.query(
          `INSERT INTO contacts
             (tenant_id, account_id, name, title, email, email_status, provider, linkedin_url, is_decision_maker)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tenantId,
            accountId,
            c.name,
            c.title,
            email,
            c.emailStatus ?? "verified",
            "Licensed contact provider (sample)",
            null,
            c.decisionMaker ? 1 : 0,
          ],
        );
      }
    }
  });
}

/**
 * Drop a tenant's workspace and re-seed the sample market. Scoped strictly to
 * one tenant, so the demo reset can never touch another customer's data.
 */
export async function resetTenant(tenantId: number): Promise<void> {
  // A reset clears the workspace, not the customer's market. The sample market
  // is data & AI, but a tenant on another niche must come back on their own
  // vocabulary rather than silently reverting to the default one.
  const before = await getProfile(tenantId).catch(() => null);

  await txn(async (client) => {
    // Ordered by dependency; ON DELETE CASCADE would cover it, but being
    // explicit keeps the intent readable.
    await client.query("DELETE FROM sends WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM outcomes WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM signal_corrections WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM drafts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM briefs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM contacts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM signals WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM accounts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM signal_definitions WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM profiles WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM runtime_state WHERE tenant_id = $1", [tenantId]);
  });
  await seedTenant(tenantId);

  if (before && before.niche !== DEFAULT_NICHE) {
    await applyNichePreset(tenantId, before.niche);
  }
}

/* ------------------------------ mappers --------------------------------- */

/** timestamptz comes back as a Date; the API surface is ISO strings. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** jsonb comes back already parsed; a malformed value must not break scoring. */
function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function mapSignalDefinition(r: Record<string, unknown>): SignalDefinition {
  return {
    type: String(r.type),
    label: String(r.label),
    shortLabel: String(r.short_label),
    weight: Number(r.weight),
    why: String(r.why ?? ""),
    patterns: jsonArray(r.patterns),
    serviceKeywords: jsonArray(r.service_keywords),
    // Filtered rather than trusted: a channel name that this build does not know
    // is dropped instead of becoming a rule that can never match anything.
    sources: asChannels(jsonArray(r.sources)),
    // `false` means the channels were never chosen, so the routers resolve them
    // from the presets rather than reading everything.
    sourcesExplicit: r.sources_explicit === true,
  };
}

/**
 * bigint columns come back as strings from the driver (it cannot know they fit
 * in a JS number), so ids are converted explicitly.
 */
function mapAccount(r: Record<string, unknown>): Account {
  return {
    id: Number(r.id),
    name: String(r.name),
    domain: String(r.domain),
    sector: String(r.sector),
    employees: Number(r.employees),
    location: String(r.location),
    description: String(r.description),
    status: String(r.status) as Account["status"],
  };
}

function mapSignal(r: Record<string, unknown>): Signal {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    type: String(r.type) as Signal["type"],
    summary: String(r.summary),
    evidence: String(r.evidence),
    source: String(r.source),
    sourceUrl: r.source_url == null ? null : String(r.source_url),
    // Older rows predate the split, so fall back to the detection date.
    eventAt: iso(r.event_at ?? r.detected_at),
    detectedAt: iso(r.detected_at),
    strength: Number(r.strength),
  };
}

function mapSignalCorrection(r: Record<string, unknown>): SignalCorrection {
  return {
    id: Number(r.id),
    signalId: Number(r.signal_id),
    accountId: Number(r.account_id),
    type: String(r.type) as SignalCorrection["type"],
    summary: String(r.summary),
    evidence: String(r.evidence),
    source: String(r.source),
    sourceUrl: r.source_url == null ? null : String(r.source_url),
    reason: r.reason == null ? null : String(r.reason),
    createdAt: iso(r.created_at),
  };
}

function mapContact(r: Record<string, unknown>): Contact {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    name: String(r.name),
    title: String(r.title),
    email: String(r.email),
    emailStatus: String(r.email_status) as Contact["emailStatus"],
    provider: String(r.provider),
    linkedinUrl: r.linkedin_url == null ? null : String(r.linkedin_url),
    isDecisionMaker: Number(r.is_decision_maker) === 1,
  };
}

function mapBrief(r: Record<string, unknown>): Brief {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    whyNow: String(r.why_now),
    likelyPain: String(r.likely_pain),
    caseStudyAngle: String(r.case_study_angle),
    whoToContact: String(r.who_to_contact),
    generatedBy: String(r.generated_by) as Brief["generatedBy"],
    createdAt: iso(r.created_at),
  };
}

function mapIntegration(r: Record<string, unknown>): Integration {
  let events: string[] = [];
  try {
    events = JSON.parse(String(r.events_json)) as string[];
  } catch {
    events = [];
  }
  // A row written before migration 7 has no settings column value to read; an
  // empty object is the same thing as "nothing configured yet".
  let settings: Record<string, unknown> = {};
  const rawSettings = r.settings;
  if (rawSettings && typeof rawSettings === "object") {
    settings = rawSettings as Record<string, unknown>;
  } else if (typeof rawSettings === "string") {
    try {
      const parsed = JSON.parse(rawSettings) as unknown;
      if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  return {
    id: Number(r.id),
    kind: String(r.kind) as IntegrationKind,
    label: String(r.label),
    url: String(r.url),
    enabled: Number(r.enabled) === 1,
    events,
    settings,
  };
}

function mapOutcome(r: Record<string, unknown>): Outcome {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    kind: String(r.kind) as Outcome["kind"],
    note: r.note == null ? null : String(r.note),
    occurredAt: iso(r.occurred_at),
  };
}

function mapSend(r: Record<string, unknown>): SendRecord {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    draftId: Number(r.draft_id),
    toEmail: String(r.to_email),
    subject: String(r.subject),
    body: String(r.body),
    provider: String(r.provider),
    status: String(r.status) as SendRecord["status"],
    error: r.error == null ? null : String(r.error),
    createdAt: iso(r.created_at),
  };
}

function mapDraft(r: Record<string, unknown>): Draft {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    channel: String(r.channel) as Draft["channel"],
    subject: r.subject == null ? null : String(r.subject),
    body: String(r.body),
    tone: String(r.tone),
    length: String(r.length),
    status: String(r.status) as Draft["status"],
    generatedBy: String(r.generated_by) as Draft["generatedBy"],
    createdAt: iso(r.created_at),
  };
}

function mapMember(r: Record<string, unknown>): Member {
  return {
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    userId: String(r.user_id),
    email: r.email == null ? null : String(r.email),
    role: String(r.role) as Member["role"],
    createdAt: iso(r.created_at),
  };
}
