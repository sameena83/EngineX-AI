// HubSpot: the part of the integration that can be checked without a portal.
//
// The network calls are thin; what actually decides whether a customer's CRM
// fills with duplicates or empty deals is this mapping. So the plan builder, the
// id parsing and the retry policy are tested here, offline.

import assert from "node:assert/strict";
import test from "node:test";
import {
  HUBSPOT_ASSOCIATION,
  companyUpsertBody,
  dealBody,
  noteBody,
  hubspotSyncAccount,
  parsePipelines,
  parseStage,
  retryDelayMs,
  shouldRetry,
} from "../src/lib/hubspot";
import {
  buildPayload,
  hubspotSettingsOf,
  hubspotPlans,
  type AccountCardData,
} from "../src/lib/integrations";

const card: AccountCardData = {
  accountName: "Harborline Logistics",
  domain: "harborline.example",
  sector: "Logistics",
  employees: 850,
  location: "Chicago, IL",
  score: 84,
  tier: "very_strong",
  signalType: "new_data_leader",
  signalSummary: "New Head of Data hired, first 90 days",
};

/* --------------------------------- parsing -------------------------------- */

test("a stage is classified by probability, not by guessing at its label", () => {
  assert.equal(parseStage({ id: "1", label: "Appointment scheduled", metadata: { probability: 0.2 } }).closed, "open");
  assert.equal(parseStage({ id: "2", label: "Closed won", metadata: { probability: 1 } }).closed, "won");
  assert.equal(parseStage({ id: "3", label: "Closed lost", metadata: { probability: 0 } }).closed, "lost");
  // No metadata at all is the common case for a custom stage.
  assert.equal(parseStage({ id: "4", label: "Whatever" }).closed, "open");
});

test("pipelines are parsed from the real response envelope", () => {
  const pipelines = parsePipelines({
    results: [
      {
        id: "default",
        label: "Sales Pipeline",
        stages: [
          { id: "appointmentscheduled", label: "Appointment scheduled", metadata: { probability: 0.2 } },
          { id: "closedwon", label: "Closed won", metadata: { probability: 1 } },
        ],
      },
    ],
  });
  assert.equal(pipelines.length, 1);
  assert.equal(pipelines[0].id, "default");
  assert.deepEqual(
    pipelines[0].stages.map((s) => s.id),
    ["appointmentscheduled", "closedwon"],
  );
  // Anything that is not a results array is an empty portal, not a crash.
  assert.deepEqual(parsePipelines(null), []);
  assert.deepEqual(parsePipelines({ results: "nope" }), []);
});

/* --------------------------------- bodies --------------------------------- */

test("a company upsert is keyed on the domain, so a re-sync updates", () => {
  const body = companyUpsertBody([{ domain: "harborline.example", name: "Harborline", employees: 850, description: "Logistics · Chicago, IL" }]);
  assert.equal(body.inputs[0].id, "harborline.example");
  assert.equal(body.inputs[0].idProperty, "domain");
  assert.equal(body.inputs[0].properties.numberofemployees, "850");
  // Headcount is a string in HubSpot, and a 0 must not be written as "0".
  assert.equal("numberofemployees" in companyUpsertBody([{ domain: "x.example", name: "X", employees: 0 }]).inputs[0].properties, false);
});

test("a deal carries ids and a truncated name", () => {
  const body = dealBody({ name: "x".repeat(200), pipelineId: "p1", stageId: "s1" });
  assert.equal(body.properties.pipeline, "p1");
  assert.equal(body.properties.dealstage, "s1");
  assert.equal(body.properties.dealname.length, 120);
});

test("a note is associated at creation and always timestamped", () => {
  const at = new Date("2026-10-18T12:00:00.000Z");
  const body = noteBody("evidence", [{ toType: "companies", toId: "123", associationTypeId: HUBSPOT_ASSOCIATION.noteToCompany }], at);
  assert.equal(body.properties.hs_timestamp, at.toISOString());
  assert.equal(body.associations[0].to.id, "123");
  assert.equal(body.associations[0].types[0].associationTypeId, 190);
});

/* --------------------------------- retry ---------------------------------- */

test("retry waits on Retry-After, then backs off with jitter", () => {
  assert.equal(retryDelayMs(0, "2"), 2000);
  // A header that would stall a run is capped.
  assert.equal(retryDelayMs(0, "600"), 10_000);
  assert.ok(retryDelayMs(2, null, () => 0) > retryDelayMs(1, null, () => 0));
  assert.ok(retryDelayMs(0, null, () => 0.999) < 1000);
});

test("only rate limits and server faults are retried", () => {
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(500), true);
  assert.equal(shouldRetry(400), false);
  assert.equal(shouldRetry(401), false);
});

/* ---------------------------------- plans --------------------------------- */

test("a strong-signal alert opens a deal and attaches the evidence", () => {
  const { plans, skipped } = hubspotPlans("account_card", card, {
    pipelineId: "default",
    dealStageId: "appointmentscheduled",
    createDeals: true,
  });
  assert.deepEqual(skipped, []);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].plan.company.domain, card.domain);
  assert.equal(plans[0].plan.deal?.stageId, "appointmentscheduled");
  assert.ok(plans[0].plan.note?.text.includes(card.signalSummary));
  // The note hangs off both the company and the deal it was opened for.
  assert.deepEqual(
    plans[0].plan.note?.links.map((l) => l.toType),
    ["companies", "deals"],
  );
});

test("a digest keeps companies current and opens no deals", () => {
  const { plans } = hubspotPlans(
    "digest",
    { accounts: [card, { ...card, accountName: "Second", domain: "second.example" }], generatedAt: "" },
    { pipelineId: "default", dealStageId: "appointmentscheduled", createDeals: true },
  );
  assert.equal(plans.length, 2);
  for (const { plan } of plans) {
    assert.equal(plan.deal, undefined);
    assert.equal(plan.note, undefined);
  }
});

test("no pipeline yet still syncs the company, and says why there is no deal", () => {
  const { plans, skipped } = hubspotPlans("account_card", card, { createDeals: true });
  assert.equal(plans[0].plan.deal, undefined);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /pipeline and stage/);
});

test("with deals switched off nothing is skipped", () => {
  const { plans, skipped } = hubspotPlans("account_card", card, { createDeals: false });
  assert.equal(plans[0].plan.deal, undefined);
  assert.deepEqual(skipped, []);
});

test("an account with no domain is skipped rather than duplicated by name", () => {
  const { plans, skipped } = hubspotPlans("account_card", { ...card, domain: "" }, {
    pipelineId: "p",
    dealStageId: "s",
    createDeals: true,
  });
  assert.equal(plans.length, 0);
  assert.match(skipped[0], /no domain/);
});

test("a send log becomes a note on the account's company", () => {
  const { plans } = hubspotPlans(
    "send_log",
    {
      accountName: "Harborline Logistics",
      domain: "harborline.example",
      toEmail: "ops@harborline.example",
      subject: "A quick idea",
      status: "sent",
      provider: "resend",
    },
    { createDeals: true },
  );
  assert.equal(plans[0].plan.deal, undefined);
  assert.match(plans[0].plan.note!.text, /ops@harborline\.example/);
});

test("stored settings survive a round trip and default to creating deals", () => {
  assert.deepEqual(hubspotSettingsOf({ settings: {} }), {
    pipelineId: undefined,
    dealStageId: undefined,
    createDeals: true,
  });
  assert.deepEqual(
    hubspotSettingsOf({ settings: { pipelineId: " p1 ", dealStageId: "s1", createDeals: false } }),
    { pipelineId: "p1", dealStageId: "s1", createDeals: false },
  );
});

/* --------------------------------- the sync ------------------------------- */

/** Run `fn` with stubbed env and fetch, then put both back. */
async function withHubspot<T>(
  env: Record<string, string>,
  handler: (url: string, body: unknown) => Response,
  fn: (calls: { url: string; body: unknown }[]) => Promise<T>,
): Promise<T> {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  Object.assign(process.env, env);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a live sync writes the company, then the deal, then the evidence", async () => {
  const { plans } = hubspotPlans("account_card", card, {
    pipelineId: "default",
    dealStageId: "appointmentscheduled",
    createDeals: true,
  });
  const result = await withHubspot(
    { HUBSPOT_ACCESS_TOKEN: "test-token", HUBSPOT_DRY_RUN: "0", HUBSPOT_BASE_URL: "https://hs.test" },
    (url) =>
      url.endsWith("/companies/batch/upsert")
        ? json({ results: [{ id: "c1" }] })
        : json({ id: url.includes("/deals") ? "d1" : "n1" }),
    (calls) => hubspotSyncAccount(plans[0].plan).then((r) => ({ r, calls })),
  );

  assert.equal(result.r.ok, true);
  assert.equal(result.r.companyId, "c1");
  assert.equal(result.r.dealId, "d1");
  // Order matters: the note needs ids the earlier calls produced.
  assert.deepEqual(
    result.calls.map((c) => c.url.replace("https://hs.test", "")),
    [
      "/crm/v3/objects/companies/batch/upsert",
      "/crm/v3/objects/deals",
      "/crm/v4/objects/deals/d1/associations/companies/c1",
      "/crm/v3/objects/notes",
    ],
  );
  // The token goes out as a bearer header, and the note is linked to both records.
  const note = result.calls[3].body as { associations: { to: { id: string } }[] };
  assert.deepEqual(note.associations.map((a) => a.to.id), ["c1", "d1"]);
});

test("a rate limit is waited out and retried, and a 400 is not", async () => {
  let attempts = 0;
  const result = await withHubspot(
    { HUBSPOT_ACCESS_TOKEN: "test-token", HUBSPOT_DRY_RUN: "0", HUBSPOT_BASE_URL: "https://hs.test" },
    () => {
      attempts += 1;
      return attempts === 1 ? json({ message: "rate limited" }, 429) : json({ results: [{ id: "c1" }] });
    },
    () => hubspotSyncAccount({ company: { domain: "x.example", name: "X" } }),
  );
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("a 401 is surfaced with HubSpot's own message, once", async () => {
  let attempts = 0;
  const result = await withHubspot(
    { HUBSPOT_ACCESS_TOKEN: "bad", HUBSPOT_DRY_RUN: "0", HUBSPOT_BASE_URL: "https://hs.test" },
    () => {
      attempts += 1;
      return json({ message: "Invalid credentials" }, 401);
    },
    () => hubspotSyncAccount({ company: { domain: "x.example", name: "X" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(attempts, 1);
  assert.match(result.error ?? "", /401/);
});

test("without a token nothing is even attempted", async () => {
  const result = await withHubspot(
    { HUBSPOT_ACCESS_TOKEN: "", HUBSPOT_DRY_RUN: "0", HUBSPOT_BASE_URL: "https://hs.test" },
    () => json({}, 500),
    (calls) => hubspotSyncAccount({ company: { domain: "x.example", name: "X" } }).then((r) => ({ r, calls })),
  );
  assert.equal(result.r.ok, true);
  assert.equal(result.r.mode, "dry_run");
  assert.equal(result.calls.length, 0);
  assert.equal(result.r.planned.length, 1);
});

test("the HubSpot preview shows a deal with placeholder ids", () => {
  const payload = buildPayload("hubspot", "account_card", card) as {
    plans: { plan: { deal?: { pipelineId: string; stageId: string } } }[];
  };
  // The preview exists so the customer can see what a deal looks like before
  // they have chosen ids, so the deal must not be hidden.
  assert.equal(payload.plans[0].plan.deal?.pipelineId, "<pipeline-id>");
  assert.equal(payload.plans[0].plan.deal?.stageId, "<deal-stage-id>");
});
