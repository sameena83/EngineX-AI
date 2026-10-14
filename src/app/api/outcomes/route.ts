import { connection } from "next/server";
import { deleteOutcome, listOutcomes, recordOutcome } from "@/lib/db";
import type { OutcomeKind } from "@/lib/types";

const KINDS: OutcomeKind[] = ["reply", "meeting", "won", "no_response"];

export async function GET(request: Request) {
  await connection();
  const accountId = new URL(request.url).searchParams.get("accountId");
  const all = listOutcomes();
  return Response.json({
    outcomes: accountId
      ? all.filter((o) => o.accountId === Number(accountId))
      : all,
  });
}

export async function POST(request: Request) {
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
  const outcome = recordOutcome(body.accountId, body.kind, body.note ?? null);
  return Response.json({ outcome });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }
  deleteOutcome(id);
  return Response.json({ ok: true });
}
