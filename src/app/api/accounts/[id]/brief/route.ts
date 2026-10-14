import { getBundle } from "@/lib/bundle";
import { getProfile, saveBrief } from "@/lib/db";
import { generateBrief } from "@/lib/generate";

export async function POST(_req: Request, ctx: RouteContext<"/api/accounts/[id]/brief">) {
  const { id } = await ctx.params;
  const bundle = getBundle(Number(id));
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });

  const profile = getProfile();
  const generated = await generateBrief(
    profile,
    bundle.account,
    bundle.signals,
    bundle.contacts,
  );
  const brief = saveBrief(bundle.account.id, generated);
  return Response.json({ brief });
}
