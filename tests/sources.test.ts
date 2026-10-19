// Signal sources: the registry, its configuration errors, and one real fetch.
//
// The registry is the part that used to cap a tenant at one non-news channel,
// because there was exactly one generic REST adapter. These tests pin that down
// from both ends: several endpoints configured at once, and each one declaring the
// kind of evidence it feeds.

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { listSources, pullSources, sourceStatuses } from "../src/lib/sources";

/** Every variable the registry reads, so one test cannot leak into the next. */
const TOUCHED = [
  "WEBZ_API_TOKEN",
  "INGEST_HTTP_URL",
  "INGEST_HTTP_TOKEN",
  "INGEST_HTTP_LABEL",
  "INGEST_HTTP_CHANNEL",
  "INGEST_HTTP_ITEMS_PATH",
  "INGEST_HTTP_FIELD_MAP",
  "INGEST_HTTP_METHOD",
  "INGEST_HTTP_MAX_PAGES",
  "INGEST_HTTP_SOURCES",
];

async function withEnv(vars: Record<string, string>, fn: () => Promise<void> | void): Promise<void> {
  const saved = new Map(TOUCHED.map((key) => [key, process.env[key]]));
  for (const key of TOUCHED) delete process.env[key];
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const key of TOUCHED) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** An HTTP endpoint that returns canned JSON, recording the paths it was asked for. */
async function stub(
  respond: (path: string) => unknown,
): Promise<{ base: string; requests: string[]; tokens: (string | undefined)[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const tokens: (string | undefined)[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    tokens.push(req.headers.authorization);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(respond(req.url ?? "")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    tokens,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("several REST endpoints can be configured at once, one per channel", async () => {
  await withEnv(
    {
      INGEST_HTTP_SOURCES: JSON.stringify([
        { label: "Acme job board", url: "https://jobs.example.com/api", channel: "job_board" },
        { label: "UK tender portal", url: "https://tenders.example.gov.uk/api", channel: "tender" },
        { label: "People provider", url: "https://people.example.com/v1", channel: "people" },
      ]),
    },
    () => {
      const statuses = sourceStatuses();
      const rest = statuses.filter((s) => s.id.startsWith("http:"));
      assert.equal(rest.length, 3);
      assert.equal(new Set(rest.map((s) => s.id)).size, 3, "source ids must be unique");
      assert.deepEqual(
        rest.map((s) => s.channels).flat(),
        ["job_board", "tender", "people"],
      );
      // All three are live and pullable: this is the limitation, gone.
      assert.equal(pullSources().length, 3);
      assert.deepEqual(rest.filter((s) => !s.configured), []);
      for (const s of rest) assert.equal(s.problem ?? null, null);
    },
  );
});

test("the single-endpoint variables still work, and still default to job boards", async () => {
  await withEnv({ INGEST_HTTP_URL: "https://api.example.com/jobs" }, () => {
    const rest = listSources().filter((s) => s.id.startsWith("http"));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].id, "http");
    assert.deepEqual(rest[0].channels, ["job_board"]);
    assert.equal(rest[0].configured, true);
  });

  await withEnv(
    { INGEST_HTTP_URL: "https://api.example.com/tenders", INGEST_HTTP_CHANNEL: "tender" },
    () => {
      const rest = listSources().filter((s) => s.id.startsWith("http"));
      assert.deepEqual(rest[0].channels, ["tender"]);
    },
  );
});

test("a malformed source list is reported, not silently dropped", async () => {
  await withEnv({ INGEST_HTTP_SOURCES: "{not json" }, () => {
    const rest = listSources().filter((s) => s.id.startsWith("http"));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].id, "http:invalid");
    assert.ok(rest[0].problem?.includes("not valid JSON"));
    assert.equal(rest[0].configured, false);
    // A source that cannot be parsed must not be pulled as if it were fine.
    assert.equal(pullSources().length, 0);
  });
});

test("an unknown channel is reported and falls back to job boards", async () => {
  await withEnv(
    {
      INGEST_HTTP_SOURCES: JSON.stringify([
        { label: "Procurement feed", url: "https://p.example.com", channel: "procurement" },
      ]),
    },
    () => {
      const [rest] = listSources().filter((s) => s.id.startsWith("http"));
      assert.deepEqual(rest.channels, ["job_board"]);
      assert.ok(rest.problem?.includes("procurement"));
      assert.ok(rest.problem?.includes("tender"), "the problem should list the valid channels");
    },
  );
});

test("a source whose token variable is unset says so instead of failing at run time", async () => {
  await withEnv(
    {
      INGEST_HTTP_SOURCES: JSON.stringify([
        { label: "Tender portal", url: "https://t.example.com", channel: "tender", tokenEnv: "TENDER_API_TOKEN" },
      ]),
    },
    () => {
      const [unset] = listSources().filter((s) => s.id.startsWith("http"));
      assert.equal(unset.configured, false);
      assert.ok(unset.problem?.includes("TENDER_API_TOKEN"));
      assert.ok(unset.envVars.includes("TENDER_API_TOKEN"));
      assert.equal(pullSources().length, 0);
    },
  );

  await withEnv(
    {
      TENDER_API_TOKEN: "",
      INGEST_HTTP_SOURCES: JSON.stringify([
        { label: "Tender portal", url: "https://t.example.com", channel: "tender", tokenEnv: "TENDER_API_TOKEN" },
      ]),
    },
    () => {
      const [unset] = listSources().filter((s) => s.id.startsWith("http"));
      assert.ok(unset.problem?.includes("TENDER_API_TOKEN"));
      assert.equal(pullSources().length, 0);
    },
  );
});

test("a source fetches, maps fields and stamps the declared channel", async () => {
  const server = await stub(() => ({
    data: {
      items: [
        {
          buyer: { name: "Civic Water Authority" },
          description: "Civic Water Authority issues a public tender for a cloud data warehouse",
          notice_url: "https://tenders.example.gov.uk/notice/1",
        },
      ],
    },
  }));
  try {
    await withEnv(
      {
        TENDER_API_TOKEN: "secret-token",
        INGEST_HTTP_SOURCES: JSON.stringify([
          {
            label: "UK tender portal",
            url: `${server.base}/search`,
            channel: "tender",
            tokenEnv: "TENDER_API_TOKEN",
            itemsPath: "data.items",
            fieldMap: { companyName: "buyer.name", text: "description", url: "notice_url" },
          },
        ]),
      },
      async () => {
        const [adapter] = pullSources();
        const candidates = await adapter.fetch();
        assert.equal(candidates.length, 1);
        assert.equal(candidates[0].companyName, "Civic Water Authority");
        assert.equal(candidates[0].channel, "tender");
        assert.equal(candidates[0].source, "UK tender portal");
        assert.equal(candidates[0].url, "https://tenders.example.gov.uk/notice/1");
        // The token is read from the variable the source names, not from the
        // generic one, so two endpoints can hold different keys.
        assert.deepEqual(server.tokens, ["Bearer secret-token"]);
      },
    );
  } finally {
    await server.close();
  }
});

test("a {page} endpoint pages in order and stops when a page is empty", async () => {
  const pages: Record<string, number> = {};
  const server = await stub((path) => {
    const page = Number(new URL(path, "http://x").searchParams.get("page") ?? "1");
    pages[String(page)] = (pages[String(page)] ?? 0) + 1;
    const byPage: Record<number, unknown[]> = {
      1: [{ company: "Alpha Ltd", description: "Alpha Ltd is hiring data engineers" }],
      2: [{ company: "Beta Ltd", description: "Beta Ltd is hiring data engineers" }],
      3: [],
    };
    return { items: byPage[page] ?? [] };
  });
  try {
    await withEnv(
      {
        INGEST_HTTP_SOURCES: JSON.stringify([
          {
            label: "Job board",
            url: `${server.base}/jobs?page={page}`,
            channel: "job_board",
            maxPages: 5,
            fieldMap: { companyName: "company" },
          },
        ]),
      },
      async () => {
        const [adapter] = pullSources();
        const candidates = await adapter.fetch();
        assert.deepEqual(
          candidates.map((c) => c.companyName),
          ["Alpha Ltd", "Beta Ltd"],
        );
        // Three requests: the empty third page stops the walk rather than asking
        // for the fourth and fifth.
        assert.deepEqual(server.requests, ["/jobs?page=1", "/jobs?page=2", "/jobs?page=3"]);
        assert.deepEqual(pages, { 1: 1, 2: 1, 3: 1 });
      },
    );
  } finally {
    await server.close();
  }
});

test("the push and sample pipes feed every channel", async () => {
  await withEnv({}, () => {
    const statuses = sourceStatuses();
    const push = statuses.find((s) => s.id === "push");
    assert.equal(push?.channels, null);
    assert.equal(push?.pull, false);
    // With nothing configured there is no pull source, and a scheduled run pulls
    // nothing rather than inventing data.
    assert.equal(pullSources().length, 0);
  });
});
