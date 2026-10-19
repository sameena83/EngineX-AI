import { listIntegrations } from "@/lib/db";
import { INTEGRATION_META, testIntegration } from "@/lib/integrations";
import { currentTenantId } from "@/lib/tenant";
import type { IntegrationKind } from "@/lib/types";

export async function POST(request: Request) {
  const tenantId = await currentTenantId();
  const body = (await request.json()) as {
    kind: IntegrationKind;
    url?: string;
    label?: string;
    /** For an API integration: the pipeline and stage being chosen right now. */
    settings?: Record<string, unknown>;
  };
  if (!body.kind || !INTEGRATION_META[body.kind]) {
    return Response.json({ error: "Unknown integration kind" }, { status: 400 });
  }
  const meta = INTEGRATION_META[body.kind];
  // Test what is being typed, falling back to what was saved for this kind.
  const saved = (await listIntegrations(tenantId)).find((i) => i.kind === body.kind);
  const url = body.url || saved?.url || "";
  if (meta.transport === "webhook" && !url) {
    return Response.json({ error: "No webhook URL to test" }, { status: 400 });
  }
  const result = await testIntegration({
    kind: body.kind,
    url,
    label: body.label || saved?.label || meta.label,
    settings: body.settings ?? saved?.settings,
  });
  return Response.json({ result });
}
