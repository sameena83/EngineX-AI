import { getBundle } from "@/lib/bundle";
import { getProfile, getVocabulary, saveBrief } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { generateBrief } from "@/lib/generate";
import { currentTenantId } from "@/lib/tenant";

export async function POST(_req: Request, ctx: RouteContext<"/api/accounts/[id]/brief">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const bundle = await getBundle(tenantId, Number(id));
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });

  const profile = await getProfile(tenantId);
  const generated = await generateBrief(
    profile,
    bundle.account,
    bundle.signals,
    bundle.contacts,
    await getVocabulary(tenantId),
  );
  try {
    const brief = await saveBrief(tenantId, bundle.account.id, generated);
    return Response.json({ brief });
  } catch (err) {
    return errorResponse(err);
  }
}
