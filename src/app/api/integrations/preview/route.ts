import { buildPayload, type AccountCardData } from "@/lib/integrations";
import type { IntegrationKind } from "@/lib/types";

// Shows exactly what EngineX will POST to a given webhook, so a user can match
// it against their Slack/Teams/Zapier/Make setup before wiring anything up.

const SAMPLE: AccountCardData = {
  accountName: "Harborline Logistics",
  sector: "Logistics",
  employees: 850,
  location: "Chicago, IL",
  score: 84,
  tier: "very_strong",
  signalType: "new_data_leader",
  signalSummary: "New Head of Data hired, first 90 days",
};

const KINDS: IntegrationKind[] = ["slack", "teams", "make", "zapier"];

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") as IntegrationKind | null;
  if (!kind || !KINDS.includes(kind)) {
    return Response.json({ error: "Unknown integration kind" }, { status: 400 });
  }
  return Response.json({ payload: buildPayload(kind, "account_card", SAMPLE) });
}
