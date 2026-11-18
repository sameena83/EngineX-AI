// Multi-tenancy, proved against a real database rather than by inspection.
//
// tests/tenant-mode.test.ts pins which workspace a request *decides* on. That is
// a pure function, and it says nothing about the part that actually protects a
// customer: every query in ./src/lib/db.ts takes a tenant id, and a workspace id
// from another tenant has to return nothing rather than someone else's rows.
//
// So these tests drive the real resolver (./src/lib/tenant.ts) into the real data
// layer and assert what a second customer can see. They need a database, and they
// create workspaces in it, so they run only when TEST_DATABASE_URL names a
// scratch database — never the one the app is serving:
//
//   createdb enginex_mt_test
//   TEST_DATABASE_URL=postgres://localhost:5432/enginex_mt_test npm test
//
// With no TEST_DATABASE_URL they skip, which keeps `npm test` green on a machine
// with no Postgres and stops a stray DATABASE_URL from seeding test workspaces
// into a live deployment.

import assert from "node:assert/strict";
import test from "node:test";
import type { Identity } from "../src/lib/identity";

const testUrl = (process.env.TEST_DATABASE_URL ?? "").trim();
// The pool reads DATABASE_URL on first use, so pointing it here — before any
// query — is what keeps these tests off the app's own database.
if (testUrl) process.env.DATABASE_URL = testUrl;

const skip = testUrl
  ? false
  : "set TEST_DATABASE_URL to a scratch Postgres database to run the isolation tests";

// Unique per run, so a re-run against a database that was not dropped cannot
// collide with the previous run's users or organizations.
const run = `mt${Date.now().toString(36)}`;

const alice: Identity = { userId: `${run}-alice`, email: `${run}-alice@example.test` };
const bob: Identity = { userId: `${run}-bob`, email: `${run}-bob@example.test` };

/** Workspaces created here, removed in the final test so the database is left clean. */
const created: number[] = [];

test("two people who sign in get two separate workspaces", { skip }, async () => {
  const { ensureUserTenant } = await import("../src/lib/tenant");
  const { listAccounts, tenantsForUser } = await import("../src/lib/db");

  const aliceTenant = await ensureUserTenant(alice.userId, alice.email);
  const bobTenant = await ensureUserTenant(bob.userId, bob.email);
  created.push(aliceTenant.id, bobTenant.id);

  assert.notEqual(aliceTenant.id, bobTenant.id, "each user owns a different workspace");
  assert.notEqual(aliceTenant.slug, bobTenant.slug);

  // One workspace each, and no shared membership: the `members` row is the whole
  // mapping, so a user with two workspaces would be a bug in onboarding.
  assert.deepEqual((await tenantsForUser(alice.userId)).map((t) => t.id), [aliceTenant.id]);
  assert.deepEqual((await tenantsForUser(bob.userId)).map((t) => t.id), [bobTenant.id]);

  // A new workspace is seeded, so the first thing the customer sees is a feed
  // rather than an empty page.
  assert.ok((await listAccounts(aliceTenant.id)).length > 0, "onboarding seeds a market");
});

test("one workspace's rows are invisible from another", { skip }, async () => {
  const { ensureUserTenant } = await import("../src/lib/tenant");
  const { getAccount, getDraft, getSignal, listAccounts, listDrafts, listSignals } = await import(
    "../src/lib/db"
  );

  const a = await ensureUserTenant(alice.userId, alice.email);
  const b = await ensureUserTenant(bob.userId, bob.email);

  const aAccounts = await listAccounts(a.id);
  const bAccounts = await listAccounts(b.id);
  assert.ok(aAccounts.length > 0 && bAccounts.length > 0, "both workspaces hold a market");

  // An id from A, handed to B's data layer, must resolve to nothing. This is the
  // exact request shape a cross-tenant URL would produce.
  const foreign = aAccounts[0].id;
  assert.equal(await getAccount(b.id, foreign), null, "another tenant's account id returns nothing");
  assert.deepEqual(await getAccount(a.id, foreign), aAccounts[0], "the owning tenant still reads it");

  const aSignals = await listSignals(a.id);
  assert.ok(aSignals.length > 0);
  assert.equal(await getSignal(b.id, aSignals[0].id), null, "another tenant's signal id returns nothing");

  const aDrafts = await listDrafts(a.id);
  if (aDrafts.length > 0) {
    assert.equal(await getDraft(b.id, aDrafts[0].id), null, "another tenant's draft id returns nothing");
  }

  // Not isolation by emptiness: the two workspaces hold the same seeded market,
  // so the separation above is the tenant filter and not one side being blank.
  assert.equal(aAccounts.length, bAccounts.length);
  const aIds = new Set(aAccounts.map((x) => x.id));
  assert.ok(
    bAccounts.every((x) => !aIds.has(x.id)),
    "no account row is shared between two workspaces",
  );
});

test("colleagues signing in through one organization share one workspace", { skip }, async () => {
  const { ensureOrganizationTenant } = await import("../src/lib/tenant");
  const { listAccounts, listMembers } = await import("../src/lib/db");

  const orgId = `org_${run}`;
  const admin: Identity = { userId: `${run}-admin`, email: `${run}-admin@example.test`, orgId, orgRole: "org:admin" };
  const colleague: Identity = { userId: `${run}-colleague`, email: null, orgId, orgRole: "org:member" };

  const first = await ensureOrganizationTenant(admin);
  const second = await ensureOrganizationTenant(colleague);
  created.push(first.id);

  assert.equal(first.id, second.id, "the same organization lands in the same workspace");
  assert.equal(first.clerkOrgId, orgId);

  const members = await listMembers(first.id);
  const byUser = new Map(members.map((m) => [m.userId, m]));
  assert.equal(byUser.get(admin.userId)?.role, "owner", "an org admin owns the workspace");
  assert.equal(byUser.get(colleague.userId)?.role, "member", "a colleague is recorded as a member");

  // The point of a shared workspace: the colleague sees the firm's accounts, not
  // a fresh empty one of their own.
  assert.ok((await listAccounts(first.id)).length > 0);
});

test("a workspace already claimed by one organization cannot be claimed by another", { skip }, async () => {
  const { claimTenantForOrg } = await import("../src/lib/db");
  const { ensureOrganizationTenant } = await import("../src/lib/tenant");

  const tenant = await ensureOrganizationTenant({
    userId: `${run}-owner`,
    email: null,
    orgId: `org_${run}`,
    orgRole: "org:admin",
  });

  // Re-claiming by the same org resolves to the existing row (the compare-and-set
  // is what makes a first-sign-in race land both requests in one workspace).
  const again = await claimTenantForOrg(tenant.id, `org_${run}`);
  assert.equal(again.id, tenant.id);

  // A different organization pointing at this row must fail rather than take it
  // over: sharing a workspace by accident is worse than a failed sign-in.
  await assert.rejects(() => claimTenantForOrg(tenant.id, `org_${run}_other`));
});

test("model spend is counted per workspace and per UTC day", { skip }, async () => {
  const { ensureUserTenant } = await import("../src/lib/tenant");
  const { aiUsageSpent, listAiUsage, recordAiUsage } = await import("../src/lib/db");
  const { costUsd, dayKey } = await import("../src/lib/ai-usage");

  const a = await ensureUserTenant(alice.userId, alice.email);
  const b = await ensureUserTenant(bob.userId, bob.email);
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const callCost = costUsd("gpt-4o-mini", 1000, 500);

  for (let i = 0; i < 2; i++) {
    await recordAiUsage({
      tenantId: a.id,
      day: today,
      model: "gpt-4o-mini",
      purpose: "brief",
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: callCost,
    });
  }

  // The cap reads this number, so it has to be exact enough to trust: two calls
  // in, one row, and the sum is what the two calls cost.
  const spent = await aiUsageSpent(a.id, today);
  assert.ok(Math.abs(spent - callCost * 2) < 1e-6, `expected ~${callCost * 2}, got ${spent}`);

  // One operator key pays for everyone, so the whole point is that the cost lands
  // on the workspace that caused it and nowhere else.
  assert.equal(await aiUsageSpent(b.id, today), 0, "another workspace is not charged");

  // A cap is per day: yesterday's spend must not eat today's allowance.
  await recordAiUsage({
    tenantId: a.id,
    day: yesterday,
    model: "gpt-4o-mini",
    purpose: "brief",
    promptTokens: 4000,
    completionTokens: 2000,
    costUsd: callCost * 4,
  });
  assert.ok(
    Math.abs((await aiUsageSpent(a.id, today)) - callCost * 2) < 1e-6,
    "yesterday's spend is not counted against today",
  );

  const rows = await listAiUsage(a.id, 14);
  const todayRow = rows.find((r) => r.day === today);
  assert.equal(todayRow?.calls, 2, "both calls are aggregated into one day's row");
  assert.ok(rows.some((r) => r.day === yesterday), "yesterday is still readable");
});

test("under the cap the model is called and its tokens are recorded", { skip }, async () => {
  const { ensureUserTenant } = await import("../src/lib/tenant");
  const { aiUsageSpent } = await import("../src/lib/db");
  const { chatJSON } = await import("../src/lib/llm");
  const { dayKey } = await import("../src/lib/ai-usage");

  const t = await ensureUserTenant(`${run}-under`, null);
  created.push(t.id);
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"whyNow":"because"}' } }],
        usage: { prompt_tokens: 1200, completion_tokens: 400 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const out = await chatJSON<{ whyNow: string }>("system", "user", {
      purpose: "brief",
      tenantId: t.id,
    });
    assert.deepEqual(out, { whyNow: "because" });
    assert.equal(calls, 1, "one provider call was made");

    // The tokens the provider reported are what the workspace is charged for, so
    // the cap has a number to read on the next call.
    const spent = await aiUsageSpent(t.id, dayKey());
    assert.ok(spent > 0, `spend should have been recorded, got ${spent}`);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  }
});

test("over the cap the provider is never called and templates answer", { skip }, async () => {
  const { ensureUserTenant } = await import("../src/lib/tenant");
  const { recordAiUsage } = await import("../src/lib/db");
  const { chatJSON } = await import("../src/lib/llm");
  const { dailyCapUsd, dayKey } = await import("../src/lib/ai-usage");

  const t = await ensureUserTenant(`${run}-capped`, null);
  created.push(t.id);
  // Push the workspace to its ceiling for today.
  await recordAiUsage({
    tenantId: t.id,
    day: dayKey(),
    model: "gpt-4o-mini",
    purpose: "brief",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: dailyCapUsd(),
  });

  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("the provider must not be called over the cap");
  }) as typeof fetch;

  try {
    const out = await chatJSON("system", "user", { purpose: "brief", tenantId: t.id });
    assert.equal(out, null, "null is the signal the caller falls back to templates");
    assert.equal(calls, 0, "no request reached the provider");
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  }
});

test("the workspaces these tests created are removed", { skip }, async () => {
  const { query, closePool } = await import("../src/lib/pg/pool");
  const ids = [...new Set(created)];
  if (ids.length > 0) {
    await query("DELETE FROM members WHERE tenant_id = ANY($1::int[])", [ids]);
    await query("DELETE FROM tenants WHERE id = ANY($1::int[])", [ids]);
    const left = await query<{ n: string }>("SELECT count(*)::text AS n FROM tenants WHERE id = ANY($1::int[])", [ids]);
    assert.equal(left[0].n, "0", "the test workspaces are gone");
  }
  await closePool();
});
