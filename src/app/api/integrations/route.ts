import { connection } from "next/server";
import { deleteIntegration, listIntegrations, upsertIntegration } from "@/lib/db";
import { INTEGRATION_META } from "@/lib/integrations";
import { currentTenantId } from "@/lib/tenant";
import type { IntegrationKind } from "@/lib/types";

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json({
    integrations: await listIntegrations(tenantId),
    meta: INTEGRATION_META,
  });
}

export async function POST(request: Request) {
  const tenantId = await currentTenantId();
  const body = (await request.json()) as {
    kind: IntegrationKind;
    label?: string;
    url?: string;
    enabled?: boolean;
    events?: string[];
    /** For an API integration: the pipeline and stage the customer chose. */
    settings?: Record<string, unknown>;
  };
  if (!body.kind || !INTEGRATION_META[body.kind]) {
    return Response.json({ error: "Unknown integration kind" }, { status: 400 });
  }
  const meta = INTEGRATION_META[body.kind];
  const url = (body.url ?? "").trim();
  // A webhook destination is its URL, so an unusable one is a hard error. An API
  // destination (`transport: "api"`) is reached with a deployment token instead,
  // and its per-tenant state is the settings below.
  if (meta.transport === "webhook" && !/^https?:\/\//.test(url)) {
    return Response.json({ error: "Webhook URL must start with http(s)://" }, { status: 400 });
  }
  const saved = await upsertIntegration(tenantId, {
    kind: body.kind,
    label: body.label || meta.label,
    url,
    enabled: body.enabled ?? true,
    events: body.events?.length
      ? body.events
      : ["digest", "account_card", "send_log"],
    settings: meta.transport === "api" ? settingsFrom(body.settings) : undefined,
  });
  return Response.json({ integration: saved });
}

/**
 * Keep only the settings a kind understands, so a stray key in the request body
 * cannot end up in the tenant's row (and so the shape stays predictable).
 */
function settingsFrom(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const s = input ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    pipelineId: str(s.pipelineId),
    dealStageId: str(s.dealStageId),
    createDeals: s.createDeals === undefined ? true : Boolean(s.createDeals),
  };
}

export async function DELETE(request: Request) {
  const tenantId = await currentTenantId();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }
  await deleteIntegration(tenantId, id);
  return Response.json({ ok: true });
}
