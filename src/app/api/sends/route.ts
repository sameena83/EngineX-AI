import { connection } from "next/server";
import { listSends } from "@/lib/db";
import { configuredProvider } from "@/lib/email";
import { currentTenantId } from "@/lib/tenant";

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json({
    sends: await listSends(tenantId),
    provider: configuredProvider(),
  });
}
