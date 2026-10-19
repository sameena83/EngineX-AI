// Schema migrations.
//
// Replaces the old `PRAGMA user_version` scheme: each migration runs once, in
// order, inside a transaction, and is recorded in schema_migrations. That makes
// a schema change safe to ship to an already-running deployment — the failure
// mode the SQLite version had to work around, where a process that opened the
// database before a change queried a table that did not exist yet.
//
// Adding a table or column means appending an entry here. Never edit an entry
// that has already shipped: existing databases have already applied it.

import { getPool, tx } from "./pool";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Every tenant-owned table carries tenant_id. Nothing is shared between
 * consultancies, and every query in src/lib/db.ts filters on it.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "multi-tenant core",
    sql: `
      -- One row per consultancy (the paying customer).
      CREATE TABLE tenants (
        id          bigserial PRIMARY KEY,
        slug        text NOT NULL UNIQUE,
        name        text NOT NULL,
        -- Billing plan, kept here so entitlement checks never need Stripe at
        -- read time. Stripe webhooks (Phase 2) are the only writer.
        plan        text NOT NULL DEFAULT 'trial',
        -- Multi-market expansion: which region/language this tenant sells into.
        market      text NOT NULL DEFAULT 'us',
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      -- Maps an identity-provider user (Clerk) to the tenant they belong to.
      -- A user may belong to several tenants; each is a separate workspace.
      CREATE TABLE members (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id     text NOT NULL,
        email       text,
        role        text NOT NULL DEFAULT 'owner',
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, user_id)
      );
      CREATE INDEX members_user_idx ON members (user_id);

      -- The service profile, one per tenant. jsonb so the shape can evolve
      -- without a migration.
      CREATE TABLE profiles (
        tenant_id    bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        profile_json jsonb NOT NULL,
        updated_at   timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE accounts (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        text NOT NULL,
        domain      text NOT NULL DEFAULT '',
        sector      text NOT NULL DEFAULT 'Unknown',
        employees   integer NOT NULL DEFAULT 0,
        location    text NOT NULL DEFAULT 'Unknown',
        description text NOT NULL DEFAULT '',
        status      text NOT NULL DEFAULT 'new',
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX accounts_tenant_idx ON accounts (tenant_id, name);

      CREATE TABLE signals (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        type        text NOT NULL,
        summary     text NOT NULL,
        evidence    text NOT NULL,
        source      text NOT NULL,
        source_url  text,
        detected_at timestamptz NOT NULL,
        strength    double precision NOT NULL,
        dedupe_key  text
      );
      CREATE INDEX signals_tenant_idx ON signals (tenant_id, detected_at DESC);
      CREATE INDEX signals_account_idx ON signals (account_id);
      -- Dedupe is per tenant: the same article may matter to two customers.
      CREATE UNIQUE INDEX signals_dedupe_uniq
        ON signals (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE contacts (
        id                bigserial PRIMARY KEY,
        tenant_id         bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id        bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name              text NOT NULL,
        title             text NOT NULL,
        email             text NOT NULL,
        email_status      text NOT NULL,
        provider          text NOT NULL,
        linkedin_url      text,
        is_decision_maker integer NOT NULL DEFAULT 0
      );
      CREATE INDEX contacts_account_idx ON contacts (account_id);

      CREATE TABLE briefs (
        id              bigserial PRIMARY KEY,
        tenant_id       bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id      bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        why_now         text NOT NULL,
        likely_pain     text NOT NULL,
        case_study_angle text NOT NULL,
        who_to_contact  text NOT NULL,
        generated_by    text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX briefs_account_idx ON briefs (account_id);

      CREATE TABLE drafts (
        id           bigserial PRIMARY KEY,
        tenant_id    bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        channel      text NOT NULL,
        subject      text,
        body         text NOT NULL,
        tone         text NOT NULL,
        length       text NOT NULL,
        status       text NOT NULL DEFAULT 'draft',
        generated_by text NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX drafts_tenant_idx ON drafts (tenant_id, created_at DESC);

      -- One row per tenant per destination kind.
      CREATE TABLE integrations (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        kind        text NOT NULL,
        label       text NOT NULL,
        url         text NOT NULL,
        enabled     integer NOT NULL DEFAULT 1,
        events_json text NOT NULL DEFAULT '[]',
        UNIQUE (tenant_id, kind)
      );

      -- A signal a human judged wrong. Kept as a record of what the engine got
      -- wrong; the signal itself is deleted so it stops scoring.
      CREATE TABLE signal_corrections (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        signal_id   bigint NOT NULL,
        account_id  bigint NOT NULL,
        type        text NOT NULL,
        summary     text NOT NULL,
        evidence    text NOT NULL,
        source      text NOT NULL,
        source_url  text,
        reason      text,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX corrections_tenant_idx ON signal_corrections (tenant_id, created_at DESC);

      CREATE TABLE outcomes (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind        text NOT NULL,
        note        text,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX outcomes_tenant_idx ON outcomes (tenant_id, occurred_at DESC);

      CREATE TABLE sends (
        id          bigserial PRIMARY KEY,
        tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        draft_id    bigint NOT NULL,
        to_email    text NOT NULL,
        subject     text NOT NULL,
        body        text NOT NULL,
        provider    text NOT NULL,
        status      text NOT NULL,
        error       text,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX sends_tenant_idx ON sends (tenant_id, created_at DESC);

      -- Scheduler bookkeeping per tenant: last digest run, which accounts were
      -- already alerted, the last ingestion report.
      CREATE TABLE runtime_state (
        tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key       text NOT NULL,
        value     text NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
    `,
  },

  {
    version: 2,
    name: "enforce tenant integrity at the database",
    sql: `
      -- Tenant scoping in application code is necessary but not sufficient: a
      -- write that referenced another tenant's account id passed the plain
      -- account_id foreign key (the row exists) and then leaked that tenant's
      -- account name through a join. These composite foreign keys make a
      -- cross-tenant reference impossible at the database level, so no future
      -- code path — route, script or background job — can reintroduce it.
      --
      -- A child row must match the parent on BOTH id and tenant_id, so an
      -- account belonging to tenant A can never be referenced from tenant B.
      ALTER TABLE accounts
        ADD CONSTRAINT accounts_id_tenant_uniq UNIQUE (id, tenant_id);

      ALTER TABLE signals DROP CONSTRAINT signals_account_id_fkey;
      ALTER TABLE signals ADD CONSTRAINT signals_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;

      ALTER TABLE contacts DROP CONSTRAINT contacts_account_id_fkey;
      ALTER TABLE contacts ADD CONSTRAINT contacts_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;

      ALTER TABLE briefs DROP CONSTRAINT briefs_account_id_fkey;
      ALTER TABLE briefs ADD CONSTRAINT briefs_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;

      ALTER TABLE drafts DROP CONSTRAINT drafts_account_id_fkey;
      ALTER TABLE drafts ADD CONSTRAINT drafts_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;

      ALTER TABLE outcomes DROP CONSTRAINT outcomes_account_id_fkey;
      ALTER TABLE outcomes ADD CONSTRAINT outcomes_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;

      ALTER TABLE sends DROP CONSTRAINT sends_account_id_fkey;
      ALTER TABLE sends ADD CONSTRAINT sends_account_tenant_fk
        FOREIGN KEY (account_id, tenant_id) REFERENCES accounts (id, tenant_id)
        ON DELETE CASCADE;
    `,
  },
  {
    version: 3,
    name: "separate event date from detection date",
    sql: `
      -- An event's date and the date we noticed it are different facts, and the
      -- difference is the whole point of a recency signal: a tender published
      -- three weeks ago that we only just picked up is not a fresh opportunity.
      --
      -- detected_at stays "when EngineX first saw this"; event_at is "when it
      -- happened", taken from the source's own published timestamp when it has
      -- one. Existing rows are backfilled from detected_at, which is the best
      -- available approximation for signals stored before the split.
      ALTER TABLE signals ADD COLUMN event_at timestamptz;
      UPDATE signals SET event_at = detected_at WHERE event_at IS NULL;
      ALTER TABLE signals ALTER COLUMN event_at SET NOT NULL;

      -- Freshness and staleness are computed from event_at, so index it.
      CREATE INDEX signals_tenant_event_idx ON signals (tenant_id, event_at DESC);
    `,
  },
  {
    version: 4,
    name: "per-tenant signal vocabulary",
    sql: `
      -- What counts as a buying signal is niche-specific: a Snowflake migration
      -- for a data practice, a SOC 2 audit for a security practice, a Kubernetes
      -- move for a platform practice. Previously the five signal types were a
      -- hardcoded union in TypeScript, so reaching a new market was a code change
      -- and a release.
      --
      -- Moving the vocabulary into rows makes a niche configuration: the
      -- classifier compiles its rules from these rows, the matcher reads the
      -- service keywords from them, and the scorer reads the weights from them.
      -- The key stays plain text rather than a database enum, so a tenant can
      -- define a signal this version of the app has never heard of.
      CREATE TABLE signal_definitions (
        tenant_id        bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type             text NOT NULL,
        label            text NOT NULL,
        short_label      text NOT NULL,
        -- Base strength 0..1: how much this alone implies a live need.
        weight           real NOT NULL DEFAULT 0.5,
        why              text NOT NULL DEFAULT '',
        -- Regex sources for the fallback rule classifier, and the terms matched
        -- against the consultancy's own service descriptions. jsonb because both
        -- are edited by the customer and neither is ever queried element-wise.
        patterns         jsonb NOT NULL DEFAULT '[]'::jsonb,
        service_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
        -- Display order, and tie-break order for the rule classifier: earlier
        -- rows win, so narrow urgent events are listed above general ones.
        position         integer NOT NULL DEFAULT 0,
        updated_at       timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, type)
      );

      CREATE INDEX signal_definitions_tenant_position_idx
        ON signal_definitions (tenant_id, position);
    `,
  },
  {
    version: 5,
    name: "evidence channels per signal",
    sql: `
      -- Which kind of evidence a rule reads: a tender portal, a job board, press
      -- coverage, people data, funding data.
      --
      -- A pattern is only meaningful against the right evidence. "Public RFP" run
      -- over press coverage invents opportunities; "hiring three data engineers"
      -- is invisible in news and obvious on a job board. Until now every rule was
      -- matched against every source, which meant a niche's rules could only be as
      -- precise as its noisiest feed.
      --
      -- jsonb for the same reason patterns are: it is a small customer-edited list
      -- that is never queried element-wise. An empty list is meaningful and is the
      -- default — it means "reads every channel", so rules written before this
      -- column existed keep working rather than dropping out of the pipeline.
      ALTER TABLE signal_definitions
        ADD COLUMN sources jsonb NOT NULL DEFAULT '[]'::jsonb;
    `,
  },
  {
    version: 6,
    name: "distinguish inherited channel routing from chosen",
    sql: `
      -- Migration 5 added a channel list that defaults to empty, and empty means
      -- "reads every channel". That default was the right call for rows that
      -- already existed: it kept every stored rule in the pipeline. But it also
      -- meant a rule written before the column existed kept matching the wrong
      -- kind of evidence — a tender pattern running over press coverage — and
      -- nothing anywhere said so.
      --
      -- This flag separates the two cases an empty list can be:
      --
      --   true  the channels were chosen, here or by the preset that was adopted.
      --         An empty list therefore means "any channel" on purpose.
      --   false nothing recorded a choice, so the app inherits the routing the
      --         presets declare for that rule key instead of reading everything
      --         (see resolveImplicitRouting in src/lib/vocab.ts).
      --
      -- Rows that already hold a non-empty list were written by code that had the
      -- channel feature, so they are marked chosen. Rows with an empty list are
      -- marked not-chosen; the one case this misreads is a customer who cleared a
      -- rule's channels on purpose in the time between migrations 5 and 6, and the
      -- UI offers the choice back to them on the rule itself.
      ALTER TABLE signal_definitions
        ADD COLUMN sources_explicit boolean NOT NULL DEFAULT false;

      UPDATE signal_definitions
         SET sources_explicit = true
       WHERE jsonb_array_length(sources) > 0;
    `,
  },
  {
    version: 7,
    name: "integration settings",
    sql: `
      -- Every integration so far has been an inbound webhook: a URL and a set of
      -- events, which is exactly what this table modelled. HubSpot is the first
      -- destination that is not — EngineX calls *its* API, so what a customer
      -- configures is not a URL but a choice of pipeline and stage their deals
      -- should open in.
      --
      -- Rather than a column per future option, one jsonb bag per integration. It
      -- is small, edited only through the API, and never queried element-wise — the
      -- same reasoning as a rule's channel list. Webhook rows simply keep it empty.
      ALTER TABLE integrations
        ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;
    `,
  },
];

export interface MigrationResult {
  applied: number[];
  alreadyApplied: number[];
}

/**
 * Apply any migrations the database has not seen. Safe to call on every boot and
 * from several instances at once: an advisory lock serialises the runners so two
 * deployments starting together cannot both apply the same migration.
 */
export async function migrate(): Promise<MigrationResult> {
  const applied: number[] = [];
  const alreadyApplied: number[] = [];

  await tx(async (client) => {
    // Lock key is arbitrary but must be stable and app-wide.
    await client.query("SELECT pg_advisory_xact_lock($1)", [918_273_645]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const done = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    const seen = new Set(done.rows.map((r) => Number(r.version)));

    for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
      if (seen.has(m.version)) {
        alreadyApplied.push(m.version);
        continue;
      }
      await client.query(m.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [m.version, m.name],
      );
      applied.push(m.version);
    }
  });

  return { applied, alreadyApplied };
}

/** Whether the schema is already in place, without applying anything. */
export async function schemaVersion(): Promise<number> {
  const res = await getPool().query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations`,
  );
  return Number(res.rows[0]?.version ?? 0);
}
