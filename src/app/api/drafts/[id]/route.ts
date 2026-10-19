import { getDraft, setDraftStatus, updateDraftText } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant";
import type { Draft } from "@/lib/types";

export async function PATCH(request: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const draftId = Number(id);
  const body = (await request.json()) as {
    status?: Draft["status"];
    subject?: string | null;
    body?: string;
  };

  let draft = await getDraft(tenantId, draftId);
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  if (typeof body.body === "string") {
    // `undefined` means "leave the subject alone"; an explicit null clears it, so
    // deleting a subject in the editor actually deletes it.
    const subject = body.subject === undefined ? draft.subject : body.subject;
    draft = (await updateDraftText(tenantId, draftId, subject, body.body)) ?? draft;
  }
  if (body.status) {
    await setDraftStatus(tenantId, draftId, body.status);
    draft = { ...draft, status: body.status };
  }
  return Response.json({ draft });
}
