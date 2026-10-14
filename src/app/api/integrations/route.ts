import { connection } from "next/server";
import { deleteIntegration, listIntegrations, upsertIntegration } from "@/lib/db";
import { INTEGRATION_META } from "@/lib/integrations";
import type { IntegrationKind } from "@/lib/types";

export async function GET() {
  await connection();
  return Response.json({
    integrations: listIntegrations(),
    meta: INTEGRATION_META,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind: IntegrationKind;
    label?: string;
    url: string;
    enabled?: boolean;
    events?: string[];
  };
  if (!body.kind || !INTEGRATION_META[body.kind]) {
    return Response.json({ error: "Unknown integration kind" }, { status: 400 });
  }
  if (!/^https?:\/\//.test(body.url ?? "")) {
    return Response.json({ error: "Webhook URL must start with http(s)://" }, { status: 400 });
  }
  const saved = upsertIntegration({
    kind: body.kind,
    label: body.label || INTEGRATION_META[body.kind].label,
    url: body.url,
    enabled: body.enabled ?? true,
    events: body.events?.length
      ? body.events
      : ["digest", "account_card", "send_log"],
  });
  return Response.json({ integration: saved });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }
  deleteIntegration(id);
  return Response.json({ ok: true });
}
