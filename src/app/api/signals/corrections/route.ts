import { connection } from "next/server";
import { listSignalCorrections } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant";

// The record of signals a human judged wrong — what the engine got wrong, kept
// so it can be reviewed and (later) fed back into calibration.

export async function GET(request: Request) {
  await connection();
  const tenantId = await currentTenantId();
  const accountId = Number(new URL(request.url).searchParams.get("accountId"));
  return Response.json({
    corrections: await listSignalCorrections(
      tenantId,
      Number.isFinite(accountId) ? accountId : undefined,
    ),
  });
}
