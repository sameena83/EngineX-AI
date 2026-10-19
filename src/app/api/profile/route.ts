import { connection } from "next/server";
import { getProfile, saveProfile } from "@/lib/db";
import { llmProviderLabel } from "@/lib/llm";
import { currentTenantId } from "@/lib/tenant";
import type { Profile } from "@/lib/types";

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  return Response.json({
    profile: await getProfile(tenantId),
    llmProvider: llmProviderLabel(),
  });
}

export async function PUT(request: Request) {
  const tenantId = await currentTenantId();
  const body = (await request.json()) as Partial<Profile>;
  const current = await getProfile(tenantId);
  const next: Profile = {
    ...current,
    ...body,
    services: body.services ?? current.services,
    caseStudies: body.caseStudies ?? current.caseStudies,
    idealClient: { ...current.idealClient, ...(body.idealClient ?? {}) },
    sender: { ...current.sender, ...(body.sender ?? {}) },
    delivery: { ...current.delivery, ...(body.delivery ?? {}) },
    // The niche is the one field a partial write must not be able to lose: a
    // profile without it would fall back to the default vocabulary. Merged rather
    // than replaced so an edit to one field keeps the rest of the config, with
    // `scoring` merged key by key for the same reason.
    niche: body.niche ?? current.niche,
    nicheConfig: {
      ...current.nicheConfig,
      ...(body.nicheConfig ?? {}),
      key: current.nicheConfig.key,
      scoring: { ...current.nicheConfig.scoring, ...(body.nicheConfig?.scoring ?? {}) },
    },
  };
  await saveProfile(tenantId, next);
  return Response.json({ profile: next });
}
