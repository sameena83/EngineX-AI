// What this workspace has spent on the model.
//
// One operator key pays for every customer's generation (see ./src/lib/ai-usage.ts),
// so cost is a per-customer number the operator has to be able to read: a plan
// priced on ten researched accounts a week is unprofitable if one workspace
// generates two hundred briefs a day. This endpoint answers that for the workspace
// the request belongs to, and never for another one — the tenant id comes from the
// session, not from the query string.
//
// It is also the honest place to look when briefs stop arriving from the model:
// `atCap: true` means the daily ceiling was reached and the template engine is
// answering, which is a deliberate fallback rather than an outage.

import { aiConfig, dailyCapUsd, dayKey, recentUsage, spentTodayUsd } from "@/lib/ai-usage";
import { errorResponse } from "@/lib/errors";
import { currentTenantId } from "@/lib/tenant";

export async function GET() {
  try {
    const tenantId = await currentTenantId();
    // Independent reads, so they run together; the cap check on the hot path does
    // exactly one of these.
    const [spent, recent] = await Promise.all([
      spentTodayUsd(tenantId),
      recentUsage(tenantId),
    ]);
    const cap = dailyCapUsd();
    const finite = Number.isFinite(spent);
    return Response.json({
      day: dayKey(),
      capUsd: cap,
      // An unreadable total is reported as null rather than 0: "we could not read
      // it" and "nothing spent" must not look the same to whoever reads this.
      spentTodayUsd: finite ? Number(spent.toFixed(4)) : null,
      remainingUsd: finite ? Number(Math.max(0, cap - spent).toFixed(4)) : null,
      atCap: finite ? spent >= cap : true,
      ...aiConfig(),
      recent,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
