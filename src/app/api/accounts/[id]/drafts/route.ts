import { getBundle } from "@/lib/bundle";
import { getProfile, getVocabulary, replaceDrafts } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { generateDrafts } from "@/lib/generate";
import { currentTenantId } from "@/lib/tenant";
import type { Profile } from "@/lib/types";

export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[id]/drafts">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const bundle = await getBundle(tenantId, Number(id));
  if (!bundle) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let overrides: Partial<Pick<Profile, "tone" | "length">> = {};
  try {
    overrides = (await request.json()) as typeof overrides;
  } catch {
    overrides = {};
  }

  const [stored, vocabulary] = await Promise.all([
    getProfile(tenantId),
    getVocabulary(tenantId),
  ]);
  const profile = { ...stored, ...overrides };
  const generated = await generateDrafts(
    profile,
    bundle.account,
    bundle.signals,
    bundle.brief,
    bundle.contacts,
    vocabulary,
  );
  try {
    const drafts = await replaceDrafts(tenantId, bundle.account.id, generated);
    return Response.json({ drafts });
  } catch (err) {
    return errorResponse(err);
  }
}
