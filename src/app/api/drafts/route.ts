import { connection } from "next/server";
import { listDraftsWithAccount } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant";

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json({ drafts: await listDraftsWithAccount(tenantId) });
}
