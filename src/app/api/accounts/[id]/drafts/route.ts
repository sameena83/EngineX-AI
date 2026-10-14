import { getBundle } from "@/lib/bundle";
import { getProfile, replaceDrafts } from "@/lib/db";
import { generateDrafts } from "@/lib/generate";
import type { Profile } from "@/lib/types";

export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[id]/drafts">) {
  const { id } = await ctx.params;
  const bundle = getBundle(Number(id));
  if (!bundle) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let overrides: Partial<Pick<Profile, "tone" | "length">> = {};
  try {
    overrides = (await request.json()) as typeof overrides;
  } catch {
    overrides = {};
  }

  const profile = { ...getProfile(), ...overrides };
  const generated = await generateDrafts(
    profile,
    bundle.account,
    bundle.signals,
    bundle.brief,
    bundle.contacts,
  );
  const drafts = replaceDrafts(bundle.account.id, generated);
  return Response.json({ drafts });
}
