import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROFILE, SEED_ACCOUNTS } from "./seed-data";
import type {
  Account,
  Brief,
  Contact,
  Draft,
  Integration,
  IntegrationKind,
  Outcome,
  Profile,
  SendRecord,
  Signal,
  SignalCorrection,
} from "./types";

// A single SQLite file powers the workspace. The report calls for PostgreSQL in
// production; this local file store keeps the prototype runnable with no external
// services while preserving the same relational shape.

// ENGINEX_DATA_DIR lets tests and demos run against a throwaway database instead
// of the workspace one.
const DATA_DIR = process.env.ENGINEX_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "enginex.db");

declare global {
  var __enginexDb: DatabaseSync | undefined;
}

// Bump when createSchema gains a table or column. Existing databases store the
// version they were built with, so an upgrade is applied without needing a
// restart — see ensureSchema.
const SCHEMA_VERSION = 2;

/**
 * Create or upgrade the schema. Cheap to call on every request: it reads
 * PRAGMA user_version first and only runs the DDL when the schema has moved on.
 * Without this, a process that opened the database before a schema change (a
 * long-lived dev server, an upgraded deployment) would query a missing table.
 */
function ensureSchema(db: DatabaseSync) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  if (Number(row?.user_version ?? 0) === SCHEMA_VERSION) return;
  createSchema(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function createSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      sector TEXT NOT NULL,
      employees INTEGER NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      detected_at TEXT NOT NULL,
      strength REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      email TEXT NOT NULL,
      email_status TEXT NOT NULL,
      provider TEXT NOT NULL,
      linkedin_url TEXT,
      is_decision_maker INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      why_now TEXT NOT NULL,
      likely_pain TEXT NOT NULL,
      case_study_angle TEXT NOT NULL,
      who_to_contact TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      channel TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      tone TEXT NOT NULL,
      length TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      generated_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      events_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signal_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL,
      note TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      draft_id INTEGER NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Signals arrive from external sources that get polled repeatedly, so ingested
  // signals carry a dedupe key and the unique index makes re-ingesting the same
  // event a no-op. Seeded signals keep a NULL key (SQLite allows many NULLs).
  const signalCols = db.prepare("PRAGMA table_info(signals)").all() as {
    name: string;
  }[];
  if (!signalCols.some((c) => c.name === "dedupe_key")) {
    db.exec("ALTER TABLE signals ADD COLUMN dedupe_key TEXT");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS signals_dedupe_key ON signals (dedupe_key)",
  );
}

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO workspace (id, profile_json) VALUES (1, ?)").run(
    JSON.stringify(DEFAULT_PROFILE),
  );

  const insertAccount = db.prepare(
    `INSERT INTO accounts (name, domain, sector, employees, location, description, status)
     VALUES (?, ?, ?, ?, ?, ?, 'new')`,
  );
  const insertSignal = db.prepare(
    `INSERT INTO signals (account_id, type, summary, evidence, source, source_url, detected_at, strength)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertContact = db.prepare(
    `INSERT INTO contacts (account_id, name, title, email, email_status, provider, linkedin_url, is_decision_maker)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = Date.now();
  for (const acc of SEED_ACCOUNTS) {
    const info = insertAccount.run(
      acc.name,
      acc.domain,
      acc.sector,
      acc.employees,
      acc.location,
      acc.description,
    );
    const accountId = Number(info.lastInsertRowid);

    for (const s of acc.signals) {
      insertSignal.run(
        accountId,
        s.type,
        s.summary,
        s.evidence,
        s.source,
        s.sourceUrl ?? null,
        new Date(now - s.daysAgo * 86_400_000).toISOString(),
        s.strength,
      );
    }

    for (const c of acc.contacts) {
      const handle = c.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ");
      const email = `${handle[0]}.${handle[handle.length - 1]}@${acc.domain}`;
      insertContact.run(
        accountId,
        c.name,
        c.title,
        email,
        c.emailStatus ?? "verified",
        "Licensed contact provider (sample)",
        null,
        c.decisionMaker ? 1 : 0,
      );
    }
  }
}

export function getDb(): DatabaseSync {
  if (globalThis.__enginexDb) {
    ensureSchema(globalThis.__enginexDb);
    return globalThis.__enginexDb;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  ensureSchema(db);

  const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
    n: number;
  };
  if (count.n === 0) seed(db);

  const profileRow = db.prepare("SELECT COUNT(*) AS n FROM workspace").get() as {
    n: number;
  };
  if (profileRow.n === 0) {
    db.prepare("INSERT INTO workspace (id, profile_json) VALUES (1, ?)").run(
      JSON.stringify(DEFAULT_PROFILE),
    );
  }

  globalThis.__enginexDb = db;
  return db;
}

/** Drop all data and re-seed the sample market. Used by the demo reset action. */
export function resetDb() {
  const db = getDb();
  db.exec(`
    DELETE FROM drafts;
    DELETE FROM briefs;
    DELETE FROM contacts;
    DELETE FROM signal_corrections;
    DELETE FROM signals;
    DELETE FROM accounts;
    DELETE FROM workspace;
    DELETE FROM sqlite_sequence;
  `);
  seed(db);
}

/* ------------------------------- reads ---------------------------------- */

export function getProfile(): Profile {
  const db = getDb();
  const row = db
    .prepare("SELECT profile_json FROM workspace WHERE id = 1")
    .get() as { profile_json: string };
  const parsed = JSON.parse(row.profile_json) as Partial<Profile>;
  // Backfill fields added after a workspace was first stored.
  return {
    ...DEFAULT_PROFILE,
    ...parsed,
    idealClient: { ...DEFAULT_PROFILE.idealClient, ...(parsed.idealClient ?? {}) },
    sender: { ...DEFAULT_PROFILE.sender, ...(parsed.sender ?? {}) },
    delivery: { ...DEFAULT_PROFILE.delivery, ...(parsed.delivery ?? {}) },
  } as Profile;
}

export function saveProfile(profile: Profile) {
  const db = getDb();
  db.prepare("UPDATE workspace SET profile_json = ? WHERE id = 1").run(
    JSON.stringify(profile),
  );
}

export function listAccounts(): Account[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM accounts ORDER BY name")
    .all() as Record<string, unknown>[];
  return rows.map(mapAccount);
}

export function getAccount(id: number): Account | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapAccount(row) : null;
}

export function listSignals(): Signal[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM signals ORDER BY detected_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(mapSignal);
}

export function getSignalsForAccount(accountId: number): Signal[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM signals WHERE account_id = ? ORDER BY detected_at DESC",
    )
    .all(accountId) as Record<string, unknown>[];
  return rows.map(mapSignal);
}

export function getContactsForAccount(accountId: number): Contact[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM contacts WHERE account_id = ? ORDER BY is_decision_maker DESC, name",
    )
    .all(accountId) as Record<string, unknown>[];
  return rows.map(mapContact);
}

export function getBriefForAccount(accountId: number): Brief | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM briefs WHERE account_id = ? ORDER BY id DESC LIMIT 1")
    .get(accountId) as Record<string, unknown> | undefined;
  return row ? mapBrief(row) : null;
}

export function getDraftsForAccount(accountId: number): Draft[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM drafts WHERE account_id = ? ORDER BY id")
    .all(accountId) as Record<string, unknown>[];
  return rows.map(mapDraft);
}

export function listDrafts(): Draft[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM drafts ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(mapDraft);
}

/* --------------------- ingestion: accounts and signals ------------------ */

/**
 * Create an account discovered by a signal source. Used by the ingestion path
 * (see ./ingest.ts); the sample market seed is the only other writer.
 */
export function insertAccount(input: {
  name: string;
  domain: string;
  sector: string;
  employees: number;
  location: string;
  description: string;
}): Account {
  const info = getDb()
    .prepare(
      `INSERT INTO accounts (name, domain, sector, employees, location, description, status)
       VALUES (?, ?, ?, ?, ?, ?, 'new')`,
    )
    .run(
      input.name,
      input.domain,
      input.sector,
      input.employees,
      input.location,
      input.description,
    );
  return { id: Number(info.lastInsertRowid), status: "new", ...input };
}

/**
 * Fill in blanks on an account we already know. A source must never overwrite a
 * good value with "Unknown", so only empty placeholders are replaced.
 */
export function enrichAccount(
  id: number,
  patch: Partial<Pick<Account, "domain" | "sector" | "employees" | "location">>,
) {
  const current = getAccount(id);
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
  getDb()
    .prepare(
      "UPDATE accounts SET domain = ?, sector = ?, employees = ?, location = ? WHERE id = ?",
    )
    .run(next.domain, next.sector, next.employees, next.location, id);
}

function isEmptyPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || v === "unknown" || v === "n/a";
}

/**
 * Insert a signal unless an equivalent one already exists. The unique index on
 * dedupe_key does the checking, so a repeated sighting of the same event is a
 * no-op rather than an error.
 */
export function insertSignalIfNew(input: {
  accountId: number;
  type: Signal["type"];
  summary: string;
  evidence: string;
  source: string;
  sourceUrl: string | null;
  detectedAt: string;
  strength: number;
  dedupeKey: string;
}): Signal | null {
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO signals (account_id, type, summary, evidence, source, source_url, detected_at, strength, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.accountId,
        input.type,
        input.summary,
        input.evidence,
        input.source,
        input.sourceUrl,
        input.detectedAt,
        input.strength,
        input.dedupeKey,
      );
    return { id: Number(info.lastInsertRowid), ...input };
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return null;
    }
    throw err;
  }
}

/* --------------------------- trust corrections -------------------------- */

export function getSignal(id: number): Signal | null {
  const row = getDb().prepare("SELECT * FROM signals WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSignal(row) : null;
}

/** Remove a signal a human judged wrong. Returns whether there was one to remove. */
export function deleteSignal(id: number): boolean {
  const info = getDb().prepare("DELETE FROM signals WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

/**
 * Keep the evidence of a rejected signal. The row is a record of what the engine
 * got wrong — it never counts towards a score, because the signal itself is gone.
 */
export function recordSignalCorrection(input: {
  signal: Signal;
  reason: string | null;
}): SignalCorrection {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const s = input.signal;
  const info = db
    .prepare(
      `INSERT INTO signal_corrections
         (signal_id, account_id, type, summary, evidence, source, source_url, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.id,
      s.accountId,
      s.type,
      s.summary,
      s.evidence,
      s.source,
      s.sourceUrl,
      input.reason,
      createdAt,
    );
  return {
    id: Number(info.lastInsertRowid),
    signalId: s.id,
    accountId: s.accountId,
    type: s.type,
    summary: s.summary,
    evidence: s.evidence,
    source: s.source,
    sourceUrl: s.sourceUrl,
    reason: input.reason,
    createdAt,
  };
}

export function listSignalCorrections(accountId?: number): SignalCorrection[] {
  const db = getDb();
  const rows = (accountId
    ? db
        .prepare(
          "SELECT * FROM signal_corrections WHERE account_id = ? ORDER BY created_at DESC, id DESC",
        )
        .all(accountId)
    : db
        .prepare("SELECT * FROM signal_corrections ORDER BY created_at DESC, id DESC")
        .all()) as Record<string, unknown>[];
  return rows.map(mapSignalCorrection);
}

/* ------------------------------- writes --------------------------------- */

export function listDraftsWithAccount(): (Draft & {
  accountName: string;
  accountDomain: string;
})[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.*, a.name AS account_name, a.domain AS account_domain
       FROM drafts d JOIN accounts a ON a.id = d.account_id
       ORDER BY d.created_at DESC, d.id`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapDraft(r),
    accountName: String(r.account_name),
    accountDomain: String(r.account_domain),
  }));
}

export function setAccountStatus(id: number, status: Account["status"]) {
  getDb().prepare("UPDATE accounts SET status = ? WHERE id = ?").run(status, id);
}

export function saveBrief(
  accountId: number,
  b: Omit<Brief, "id" | "accountId" | "createdAt">,
): Brief {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO briefs (account_id, why_now, likely_pain, case_study_angle, who_to_contact, generated_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      b.whyNow,
      b.likelyPain,
      b.caseStudyAngle,
      b.whoToContact,
      b.generatedBy,
      createdAt,
    );
  return {
    id: Number(info.lastInsertRowid),
    accountId,
    createdAt,
    ...b,
  };
}

export function replaceDrafts(
  accountId: number,
  drafts: Omit<Draft, "id" | "accountId" | "createdAt">[],
): Draft[] {
  const db = getDb();
  db.prepare("DELETE FROM drafts WHERE account_id = ?").run(accountId);
  const stmt = db.prepare(
    `INSERT INTO drafts (account_id, channel, subject, body, tone, length, status, generated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const createdAt = new Date().toISOString();
  const out: Draft[] = [];
  for (const d of drafts) {
    const info = stmt.run(
      accountId,
      d.channel,
      d.subject,
      d.body,
      d.tone,
      d.length,
      d.status,
      d.generatedBy,
      createdAt,
    );
    out.push({ id: Number(info.lastInsertRowid), accountId, createdAt, ...d });
  }
  return out;
}

export function setDraftStatus(id: number, status: Draft["status"]) {
  getDb()
    .prepare("UPDATE drafts SET status = ? WHERE id = ?")
    .run(status, id);
}

/** Persist a human or agent correction to a draft's text. */
export function updateDraftText(
  id: number,
  subject: string | null,
  body: string,
): Draft | null {
  const db = getDb();
  db.prepare("UPDATE drafts SET subject = ?, body = ? WHERE id = ?").run(
    subject,
    body,
    id,
  );
  const row = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapDraft(row) : null;
}

export function getDraft(id: number): Draft | null {
  const row = getDb().prepare("SELECT * FROM drafts WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapDraft(row) : null;
}

/* --------------------------- integrations ------------------------------- */

export function listIntegrations(): Integration[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM integrations ORDER BY kind")
    .all() as Record<string, unknown>[];
  return rows.map(mapIntegration);
}

export function upsertIntegration(
  input: Omit<Integration, "id">,
): Integration {
  const db = getDb();
  db.prepare(
    `INSERT INTO integrations (kind, label, url, enabled, events_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET
       label = excluded.label,
       url = excluded.url,
       enabled = excluded.enabled,
       events_json = excluded.events_json`,
  ).run(
    input.kind,
    input.label,
    input.url,
    input.enabled ? 1 : 0,
    JSON.stringify(input.events),
  );
  const row = db
    .prepare("SELECT * FROM integrations WHERE kind = ?")
    .get(input.kind) as Record<string, unknown>;
  return mapIntegration(row);
}

export function deleteIntegration(id: number) {
  getDb().prepare("DELETE FROM integrations WHERE id = ?").run(id);
}

/* ------------------------------- sends ---------------------------------- */

export function recordSend(
  input: Omit<SendRecord, "id" | "createdAt">,
): SendRecord {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO sends (account_id, draft_id, to_email, subject, body, provider, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.draftId,
      input.toEmail,
      input.subject,
      input.body,
      input.provider,
      input.status,
      input.error,
      createdAt,
    );
  return { id: Number(info.lastInsertRowid), createdAt, ...input };
}

export function listSends(): (SendRecord & { accountName: string })[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, a.name AS account_name
       FROM sends s JOIN accounts a ON a.id = s.account_id
       ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapSend(r),
    accountName: String(r.account_name),
  }));
}

/* ---------------------------- runtime state ----------------------------- */

// Small key/value store for scheduler bookkeeping (last digest run, which
// accounts have already been alerted) — not user-facing configuration.
export function getState(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM runtime_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setState(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO runtime_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/* ------------------------------ outcomes -------------------------------- */

export function listOutcomes(): (Outcome & { accountName: string })[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.*, a.name AS account_name
       FROM outcomes o JOIN accounts a ON a.id = o.account_id
       ORDER BY o.occurred_at DESC, o.id DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({ ...mapOutcome(r), accountName: String(r.account_name) }));
}

export function getOutcomesForAccount(accountId: number): Outcome[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM outcomes WHERE account_id = ? ORDER BY occurred_at DESC, id DESC")
    .all(accountId) as Record<string, unknown>[];
  return rows.map(mapOutcome);
}

export function recordOutcome(
  accountId: number,
  kind: Outcome["kind"],
  note: string | null,
): Outcome {
  const db = getDb();
  const occurredAt = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO outcomes (account_id, kind, note, occurred_at) VALUES (?, ?, ?, ?)",
    )
    .run(accountId, kind, note, occurredAt);
  return { id: Number(info.lastInsertRowid), accountId, kind, note, occurredAt };
}

export function deleteOutcome(id: number) {
  getDb().prepare("DELETE FROM outcomes WHERE id = ?").run(id);
}

/** Account ids that have had at least one email sent. */
export function contactedAccountIds(): Set<number> {
  const rows = getDb()
    .prepare("SELECT DISTINCT account_id FROM sends")
    .all() as Record<string, unknown>[];
  return new Set(rows.map((r) => Number(r.account_id)));
}

/* ------------------------------ mappers --------------------------------- */

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
    detectedAt: String(r.detected_at),
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
    createdAt: String(r.created_at),
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
    createdAt: String(r.created_at),
  };
}

function mapIntegration(r: Record<string, unknown>): Integration {
  let events: string[] = [];
  try {
    events = JSON.parse(String(r.events_json)) as string[];
  } catch {
    events = [];
  }
  return {
    id: Number(r.id),
    kind: String(r.kind) as IntegrationKind,
    label: String(r.label),
    url: String(r.url),
    enabled: Number(r.enabled) === 1,
    events,
  };
}

function mapOutcome(r: Record<string, unknown>): Outcome {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    kind: String(r.kind) as Outcome["kind"],
    note: r.note == null ? null : String(r.note),
    occurredAt: String(r.occurred_at),
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
    createdAt: String(r.created_at),
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
    createdAt: String(r.created_at),
  };
}
