import { connection } from "next/server";
import { asChannels } from "@/lib/channels";
import { getProfile, getVocabulary, saveVocabulary } from "@/lib/db";
import { listNiches } from "@/lib/niches";
import { currentTenantId } from "@/lib/tenant";
import type { SignalDefinition } from "@/lib/types";

// The tenant's signal vocabulary: what counts as a buying signal in their
// market, and what each one implies they should sell.
//
//   GET  /api/vocabulary   → the vocabulary, the niche config, and the presets
//                            available to switch to
//   PUT  /api/vocabulary   → replace it (the niche editor)
//
// Editable over HTTP on purpose: tuning which signals a niche tracks is the
// thing a customer is most likely to want to iterate on, and it should not
// require a deployment.

export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  const [vocabulary, profile] = await Promise.all([
    getVocabulary(tenantId),
    getProfile(tenantId),
  ]);
  return Response.json({
    vocabulary,
    niche: profile.nicheConfig,
    niches: listNiches(),
  });
}

/** Coerce one submitted definition, rejecting the shapes that would break scoring. */
function parseDefinition(input: unknown): SignalDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const type = String(raw.type ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!type) return null;
  const label = String(raw.label ?? "").trim() || type;
  const weight = Number(raw.weight);
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v)).filter((v) => v.trim().length > 0) : [];
  return {
    type,
    label,
    shortLabel: String(raw.shortLabel ?? "").trim() || label,
    // Unknown channel names are dropped rather than stored: a rule reading a
    // channel no adapter can feed is a rule that never fires, and it would look
    // configured while being dead.
    sources: asChannels(raw.sources),
    // Only an explicit `false` keeps a rule following the preset for its key, which
    // is what the editor sends back for rules it has not touched. Anything else —
    // including a caller that never heard of the flag — is a choice, because the
    // list of channels came from somewhere that meant it.
    sourcesExplicit: raw.sourcesExplicit !== false,
    // Clamped rather than rejected: a weight outside 0..1 is a typo, not an attack.
    weight: Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0.5,
    why: String(raw.why ?? "").trim(),
    patterns: strings(raw.patterns),
    serviceKeywords: strings(raw.serviceKeywords),
  };
}

export async function PUT(request: Request) {
  const tenantId = await currentTenantId();
  let body: { vocabulary?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.vocabulary)) {
    return Response.json({ error: "vocabulary must be an array" }, { status: 400 });
  }

  const parsed = body.vocabulary
    .map((d) => parseDefinition(d))
    .filter((d): d is SignalDefinition => d !== null);
  if (parsed.length === 0) {
    return Response.json({ error: "At least one signal is required" }, { status: 400 });
  }
  // Keys are the identity of a signal and the join to stored evidence, so two
  // rows sharing one would silently merge unrelated signals.
  const keys = new Set(parsed.map((d) => d.type));
  if (keys.size !== parsed.length) {
    return Response.json({ error: "Signal keys must be unique" }, { status: 400 });
  }

  await saveVocabulary(tenantId, parsed);
  return Response.json({ vocabulary: await getVocabulary(tenantId) });
}
