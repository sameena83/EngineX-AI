import { deleteSignal, getSignal, recordSignalCorrection } from "@/lib/db";
import { getBundle } from "@/lib/bundle";

// The "this is wrong" verdict. One call does three things: records what the
// engine claimed (so the mistake is auditable), removes the signal so it stops
// inflating the account, and returns the recomputed bundle so the page can show
// the corrected score without a second round trip.

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/signals/[id]/reject">,
) {
  const { id } = await ctx.params;
  const signalId = Number(id);
  if (!Number.isFinite(signalId)) {
    return Response.json({ error: "Bad signal id" }, { status: 400 });
  }

  const signal = getSignal(signalId);
  if (!signal) {
    return Response.json({ error: "Signal not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const correction = recordSignalCorrection({ signal, reason });
  deleteSignal(signalId);

  return Response.json({
    correction,
    removed: signal,
    bundle: getBundle(signal.accountId),
  });
}
