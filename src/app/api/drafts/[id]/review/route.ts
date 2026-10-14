import { getBundle } from "@/lib/bundle";
import { getDraft, getProfile } from "@/lib/db";
import { reviewDraft } from "@/lib/agent";

export async function POST(_req: Request, ctx: RouteContext<"/api/drafts/[id]/review">) {
  const { id } = await ctx.params;
  const draft = getDraft(Number(id));
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }
  const bundle = getBundle(draft.accountId);
  if (!bundle) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  const review = await reviewDraft(
    getProfile(),
    bundle.account,
    bundle.signals,
    bundle.brief,
    draft,
    bundle.contacts,
  );
  return Response.json({ review });
}
