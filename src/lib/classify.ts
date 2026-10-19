// Signal classification: turn a raw source item ("Northwind raises $42M Series C")
// into one of the tenant's tracked signal types, with a strength and a summary.
//
// Two paths, mirroring the rest of the app: the LLM classifies when a key is
// configured, and a deterministic rule engine does it otherwise, so ingestion
// works offline and produces the same shape either way. The rules are the
// fallback *and* the validator — an LLM answer naming a type the tenant has not
// defined is discarded rather than trusted.
//
// Both paths are driven by the tenant's vocabulary (see ./vocab.ts), not by a
// hardcoded list. The rules the classifier compiles are the `patterns` rows the
// customer can edit, so tuning what counts as a signal in a niche is data entry
// rather than a release.

import { chatJSON, llmEnabled } from "./llm";
import type { NicheConfig, SignalDefinition, SignalType, Vocabulary } from "./types";
import { compileNegativeRules, compileRules, negativeRuleHit } from "./vocab";

export interface Classification {
  type: SignalType;
  /** Confidence-ish weight 0..1. Multiplied by the signal's own weight when scoring. */
  strength: number;
  summary: string;
  /** Phrases that justified the type, shown as evidence. */
  evidence: string[];
  by: "llm" | "rules";
}

/** First sentence-ish slice of the source text, used as the signal summary. */
export function summarise(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function strengthFor(matches: number, def: SignalDefinition): number {
  const base = 0.55 + Math.max(0, matches - 1) * 0.08;
  return Math.min(0.95, Math.max(0.4, Number((base * (0.85 + def.weight * 0.3)).toFixed(2))));
}

/**
 * Does this item trip a negative rule — vendor marketing, an awards listicle,
 * promotional filler?
 *
 * The counterweight to the positive rules. A niche keyword like "security" or
 * "AI" matches a great deal of the vendor's own content, and this is what stops
 * a noisy market from filling the feed. Checked *before* classification, because
 * the veto is about the item itself, not about what it matched.
 */
export function suppression(
  text: string,
  config: NicheConfig | undefined,
): { rule: string; phrase: string } | null {
  const hit = negativeRuleHit(text, compileNegativeRules(config));
  return hit ? { rule: hit.label, phrase: hit.phrase } : null;
}

/** Deterministic rules. Returns null when the item is not a tracked signal. */
export function classifyWithRules(text: string, vocab: Vocabulary): Classification | null {
  const rules = compileRules(vocab);
  const byType = new Map(vocab.map((d) => [d.type, d]));

  let best: { type: SignalType; hits: string[] } | null = null;
  for (const rule of rules) {
    // Record the phrase that matched, not the pattern: the evidence goes in front
    // of a human who is deciding whether to trust the signal.
    const hits = rule.patterns
      .map((p) => text.match(p)?.[0]?.trim())
      .filter((hit): hit is string => Boolean(hit));
    const unique = [...new Set(hits)].slice(0, 4);
    if (unique.length === 0) continue;
    // Vocabulary order is the tie-break, which is why it is stored: earlier rows
    // are the narrow, urgent events.
    if (!best || unique.length > best.hits.length) best = { type: rule.type, hits: unique };
  }
  if (!best) return null;
  const def = byType.get(best.type);
  if (!def) return null;
  return {
    type: best.type,
    strength: strengthFor(best.hits.length, def),
    summary: summarise(text),
    evidence: best.hits,
    by: "rules",
  };
}

/**
 * Classify one source item. The LLM is asked first when configured; anything it
 * returns that is not one of the tenant's signal types is discarded in favour of
 * the rules.
 */
export async function classify(
  text: string,
  vocab: Vocabulary,
  config?: NicheConfig,
): Promise<Classification | null> {
  if (llmEnabled() && vocab.length > 0) {
    const catalogue = vocab
      .map((d) => `- ${d.type}: ${d.label} — ${d.why}`)
      .join("\n");
    const audience = config?.buyerRoles?.length
      ? ` The consultancy sells to ${config.buyerRoles.join(", ")}.`
      : "";
    const angle = config?.outreachAngle ? ` Their pitch: ${config.outreachAngle}.` : "";
    const fromLlm = await chatJSON<{
      type: string;
      strength: number;
      summary: string;
    }>(
      `You classify B2B buying signals for a ${config?.label ?? "consultancy"}.${audience}${angle} ` +
        "You only use facts present in the text, you never invent numbers or names, " +
        "and you answer with JSON only.",
      `Classify this source item.\n\nSignal types:\n${catalogue}\n\nItem:\n${text}\n\n` +
        `Return JSON with keys: "type" (one of the type keys above, or "none" if it is not ` +
        `evidence of a live need), "strength" (0..1, how strongly this item implies an active ` +
        `project), "summary" (one factual sentence, max 160 characters, quoting the specifics).`,
    );
    if (fromLlm) {
      const def = vocab.find((d) => d.type === fromLlm.type);
      if (def) {
        const strength = Number(fromLlm.strength);
        return {
          type: def.type,
          strength: Number.isFinite(strength)
            ? Math.min(1, Math.max(0.2, strength))
            : def.weight,
          summary: summarise(fromLlm.summary || text),
          evidence: [def.type],
          by: "llm",
        };
      }
      // "none" is a legitimate answer: fall through so the rules can still catch
      // something the model dismissed. They return null if it really is noise.
    }
  }
  return classifyWithRules(text, vocab);
}
