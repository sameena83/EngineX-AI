import { connection } from "next/server";
import { listSignalCorrections } from "@/lib/db";

// The record of signals a human judged wrong — what the engine got wrong, kept
// so it can be reviewed and (later) fed back into calibration.

export async function GET(request: Request) {
  await connection();
  const accountId = Number(new URL(request.url).searchParams.get("accountId"));
  return Response.json({
    corrections: listSignalCorrections(Number.isFinite(accountId) ? accountId : undefined),
  });
}
