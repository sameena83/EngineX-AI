// Deployment readiness.
//
// A host needs one unauthenticated question answered: can this instance serve
// requests? Two things can stop it, and they are not the same failure — the
// database is unreachable, or the instance has no workspace to serve (production
// with neither an identity provider nor SINGLE_TENANT_SLUG refuses every data
// request by design; see ./src/lib/tenant.ts).
//
// So both are checked, and either one turns this into a 503. A deployment that
// answers "healthy" while every page 500s is worse than one that fails its probe
// and gets replaced or flagged.
//
// The rest of the payload is configuration, not health: which adapters are live.
// It makes a misconfigured deploy visible from outside — a key that was never
// added to the host's environment shows up here as `false` — without leaking a
// secret value. Anything that needs a network call (an actual LLM request, a
// provider ping) is deliberately absent: a probe runs constantly and must stay
// cheap and honest.

import { connection } from "next/server";
import { configuredProvider } from "@/lib/email";
import { INGEST_PUSH_GUARD, RESET_GUARD, guardConfigured } from "@/lib/guards";
import { llmProviderLabel } from "@/lib/llm";
import { schemaVersion } from "@/lib/pg/migrations";
import { getPool } from "@/lib/pg/pool";
import { hasPullSource, sourceStatuses } from "@/lib/sources";
import { configuredTenant } from "@/lib/tenant";

export async function GET() {
  await connection();

  let databaseOk = true;
  let schema: number | null = null;
  let databaseError: string | null = null;
  try {
    await getPool().query("SELECT 1");
    schema = await schemaVersion();
  } catch (err) {
    databaseOk = false;
    databaseError = err instanceof Error ? err.message : "unreachable";
  }

  const tenant = configuredTenant();
  const workspaceOk = tenant.kind !== "refuse";

  const sources = sourceStatuses();
  const ok = databaseOk && workspaceOk;

  return Response.json(
    {
      ok,
      checks: {
        database: {
          ok: databaseOk,
          schemaVersion: schema,
          error: databaseError,
        },
        workspace:
          tenant.kind === "refuse"
            ? { ok: false, mode: "refuse", reason: tenant.reason }
            : { ok: true, mode: tenant.kind, slug: tenant.slug },
        llm: { configured: llmProviderLabel() !== "Template engine", provider: llmProviderLabel() },
        email: { configured: configuredProvider() !== "dry-run", provider: configuredProvider() },
        sources: {
          pullConfigured: hasPullSource(),
          configured: sources.filter((s) => s.configured).map((s) => s.id),
          problems: sources.filter((s) => s.problem).map((s) => ({ id: s.id, problem: s.problem })),
        },
        // Whether the destructive endpoints are closed. Read this when deciding
        // if a deployment may be left on a public URL: a single-tenant install
        // with neither guarded still lets anyone who finds the host wipe the
        // workspace or inject signals.
        access: {
          resetGuarded: guardConfigured(RESET_GUARD),
          ingestPushGuarded: guardConfigured(INGEST_PUSH_GUARD),
        },
      },
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
