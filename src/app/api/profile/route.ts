import { connection } from "next/server";
import { getProfile, saveProfile } from "@/lib/db";
import { llmProviderLabel } from "@/lib/llm";
import type { Profile } from "@/lib/types";

export async function GET() {
  await connection();
  return Response.json({
    profile: getProfile(),
    llmProvider: llmProviderLabel(),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<Profile>;
  const current = getProfile();
  const next: Profile = {
    ...current,
    ...body,
    services: body.services ?? current.services,
    caseStudies: body.caseStudies ?? current.caseStudies,
    idealClient: { ...current.idealClient, ...(body.idealClient ?? {}) },
    sender: { ...current.sender, ...(body.sender ?? {}) },
    delivery: { ...current.delivery, ...(body.delivery ?? {}) },
  };
  saveProfile(next);
  return Response.json({ profile: next });
}
