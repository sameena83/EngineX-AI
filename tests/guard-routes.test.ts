// The reset handler is the one route whose mistake is unrecoverable, so the
// refusal is pinned at the route, not only in the pure rule: with no
// RESET_SECRET the handler must answer 503 *before* it resolves a workspace,
// which is what makes the check safe on a host with no configuration at all.
//
// The handler is importable because tests/ts-hooks.mjs resolves the `@/` alias
// the same way the app does.

import assert from "node:assert/strict";
import test from "node:test";

test("POST /api/reset refuses without a secret, before touching the database", async () => {
  const secret = process.env.RESET_SECRET;
  const demo = process.env.ALLOW_UNGUARDED_DEMO;
  delete process.env.RESET_SECRET;
  delete process.env.ALLOW_UNGUARDED_DEMO;
  try {
    const { POST } = await import("../src/app/api/reset/route");
    const res = await POST(new Request("http://localhost/api/reset", { method: "POST" }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    // The operator's only clue, so it has to name the variable and the header.
    assert.match(body.error ?? "", /RESET_SECRET/);
    assert.match(body.error ?? "", /x-reset-secret/);
  } finally {
    if (secret !== undefined) process.env.RESET_SECRET = secret;
    if (demo !== undefined) process.env.ALLOW_UNGUARDED_DEMO = demo;
  }
});
