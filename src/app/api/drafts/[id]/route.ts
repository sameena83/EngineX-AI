import { getDraft, setDraftStatus, updateDraftText } from "@/lib/db";
import type { Draft } from "@/lib/types";

export async function PATCH(request: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const { id } = await ctx.params;
  const draftId = Number(id);
  const body = (await request.json()) as {
    status?: Draft["status"];
    subject?: string | null;
    body?: string;
  };

  let draft = getDraft(draftId);
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  if (typeof body.body === "string") {
    draft = updateDraftText(draftId, body.subject ?? draft.subject, body.body) ?? draft;
  }
  if (body.status) {
    setDraftStatus(draftId, body.status);
    draft = { ...draft, status: body.status };
  }
  return Response.json({ draft });
}
