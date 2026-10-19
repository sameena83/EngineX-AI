import { applyNichePreset, getProfile, getVocabulary } from "@/lib/db";
import { NICHE_PRESETS } from "@/lib/niches";
import { currentTenantId } from "@/lib/tenant";

// Point this workspace at a different market.
//
//   GET  /api/niche   → the presets available
//   POST /api/niche   → { key, replaceServices? }
//
// One call swaps the signal vocabulary, the niche config (buyers, exclusions,
// scoring, source queries) and — unless asked not to — the service list the fit
// matcher reads. Existing signals are kept, so switching market re-labels the
// history rather than erasing it.
export async function GET() {
  const tenantId = await currentTenantId();
  const profile = await getProfile(tenantId);
  return Response.json({
    current: profile.niche,
    niches: Object.values(NICHE_PRESETS).map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      signals: p.signals.map((s) => ({ key: s.key, label: s.label, weight: s.weight })),
      services: p.services.map((s) => s.name),
      buyerRoles: p.buyerRoles,
      sourceQueries: p.sourceQueries,
    })),
  });
}

export async function POST(request: Request) {
  const tenantId = await currentTenantId();
  let body: { key?: string; replaceServices?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = String(body.key ?? "");
  if (!NICHE_PRESETS[key]) {
    return Response.json(
      { error: `Unknown niche "${key}"`, available: Object.keys(NICHE_PRESETS) },
      { status: 400 },
    );
  }
  const { profile } = await applyNichePreset(tenantId, key, {
    replaceServices: body.replaceServices !== false,
  });
  return Response.json({ profile, vocabulary: await getVocabulary(tenantId) });
}
