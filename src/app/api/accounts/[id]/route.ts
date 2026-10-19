import { getBundle } from "@/lib/bundle";
import { setAccountStatus } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant";
import type { Account } from "@/lib/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/accounts/[id]">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const bundle = await getBundle(tenantId, Number(id));
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ bundle });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/accounts/[id]">,
) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const { status } = (await request.json()) as { status: Account["status"] };
  await setAccountStatus(tenantId, Number(id), status);
  return Response.json({ ok: true, status });
}
