import { connection } from "next/server";
import { computeAllWonAnalytics } from "@/lib/analytics";
import { currentTenantId } from "@/lib/tenant";

// Accounts won over time, bucketed weekly, monthly and yearly. All three views
// come back in one response so the page can switch tabs without refetching.

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json(await computeAllWonAnalytics(tenantId));
}
