import { listIntegrations } from "@/lib/db";
import { INTEGRATION_META, testIntegration } from "@/lib/integrations";
import type { IntegrationKind } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind: IntegrationKind;
    url?: string;
    label?: string;
  };
  if (!body.kind || !INTEGRATION_META[body.kind]) {
    return Response.json({ error: "Unknown integration kind" }, { status: 400 });
  }
  // Test the URL being typed, falling back to the saved one for this kind.
  const saved = listIntegrations().find((i) => i.kind === body.kind);
  const url = body.url || saved?.url;
  if (!url) {
    return Response.json({ error: "No webhook URL to test" }, { status: 400 });
  }
  const result = await testIntegration({
    kind: body.kind,
    url,
    label: body.label || saved?.label || INTEGRATION_META[body.kind].label,
  });
  return Response.json({ result });
}
