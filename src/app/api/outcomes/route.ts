import { connection } from "next/server";
import { deleteOutcome, listOutcomes, recordOutcome } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { currentTenantId } from "@/lib/tenant";
import type { OutcomeKind } from "@/lib/types";

const KINDS: OutcomeKind[] = ["reply", "meeting", "won", "no_response"];

export async function GET(request: Request) {
  await connection();
  const tenantId = await currentTenantId();
  const accountId = new URL(request.url).searchParams.get("accountId");
  const all = await listOutcomes(tenantId);
  return Response.json({
    outcomes: accountId
      ? all.filter((o) => o.accountId === Number(accountId))
      : all,
  });
}

export async function POST(request: Request) {
  const tenantId = await currentTenantId();
  const body = (await request.json()) as {
    accountId: number;
    kind: OutcomeKind;
    note?: string;
  };
  if (!Number.isFinite(body.accountId)) {
    return Response.json({ error: "accountId required" }, { status: 400 });
  }
  if (!KINDS.includes(body.kind)) {
    return Response.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  }
  try {
    const outcome = await recordOutcome(
      tenantId,
      body.accountId,
      body.kind,
      body.note ?? null,
    );
    return Response.json({ outcome });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const tenantId = await currentTenantId();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }
  await deleteOutcome(tenantId, id);
  return Response.json({ ok: true });
}
