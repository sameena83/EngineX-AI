import { connection } from "next/server";
import { computePerformance } from "@/lib/stats";
import { currentTenantId } from "@/lib/tenant";

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json(await computePerformance(tenantId));
}
