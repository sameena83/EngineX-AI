import { connection } from "next/server";
import { listIntegrations } from "@/lib/db";
import { hubspotConfigured, hubspotMode, hubspotPipelines } from "@/lib/hubspot";
import { hubspotSettingsOf } from "@/lib/integrations";
import { currentTenantId } from "@/lib/tenant";

/**
 * The pipelines and stages this HubSpot portal actually has, so the customer can
 * pick by label instead of typing an internal id.
 *
 * Read-only, and deliberately so: the question being answered here is "is the
 * token right, and what does this portal look like?", never "let me write
 * something". Nothing about the account is mutated, which is what makes it safe
 * to call on page load.
 *
 * Returns `configured: false` rather than an error when there is no token — an
 * unconfigured deployment is a state the UI renders, not a failure.
 */
export async function GET() {
  await connection();
  if (!hubspotConfigured()) {
    return Response.json({
      configured: false,
      mode: hubspotMode(),
      pipelines: [],
      settings: {},
    });
  }

  const tenantId = await currentTenantId();
  const saved = (await listIntegrations(tenantId)).find((i) => i.kind === "hubspot");

  try {
    const pipelines = await hubspotPipelines();
    return Response.json({
      configured: true,
      mode: hubspotMode(),
      pipelines,
      settings: hubspotSettingsOf({ settings: saved?.settings }),
    });
  } catch (err) {
    // A bad token is the most likely cause, and the message from HubSpot says
    // which: surface it instead of an empty pipeline list the user can't act on.
    return Response.json({
      configured: true,
      mode: hubspotMode(),
      pipelines: [],
      settings: hubspotSettingsOf({ settings: saved?.settings }),
      error: err instanceof Error ? err.message : "HubSpot request failed",
    });
  }
}
