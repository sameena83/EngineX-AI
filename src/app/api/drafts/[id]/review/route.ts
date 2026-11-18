import { getBundle } from "@/lib/bundle";
import { getDraft, getProfile, getVocabulary } from "@/lib/db";
import { reviewDraft } from "@/lib/agent";
import { currentTenantId } from "@/lib/tenant";

export async function POST(_req: Request, ctx: RouteContext<"/api/drafts/[id]/review">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const draft = await getDraft(tenantId, Number(id));
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }
  const bundle = await getBundle(tenantId, draft.accountId);
  if (!bundle) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  const review = await reviewDraft(
    await getProfile(tenantId),
    bundle.account,
    bundle.signals,
    bundle.brief,
    draft,
    bundle.contacts,
    await getVocabulary(tenantId),
    tenantId,
  );
  return Response.json({ review });
}
