// Signal classification: turn a raw source item ("Northwind raises $42M Series C")
// into one of the five tracked signal types, with a strength and a human summary.
//
// Two paths, mirroring the rest of the app: the LLM classifies when a key is
// configured, and a deterministic rule engine does it otherwise, so ingestion
// works offline and produces the same shape either way. The rules are the
// fallback *and* the validator — an LLM answer naming an unknown type is
// discarded rather than trusted.

import { chatJSON, llmEnabled } from "./llm";
import { SIGNAL_DEFINITIONS } from "./seed-data";
import type { SignalType } from "./types";

export interface Classification {
  type: SignalType;
  /** Confidence-ish weight 0..1. Multiplied by the signal's own weight when scoring. */
  strength: number;
  summary: string;
  /** Phrases that justified the type, shown as evidence. */
  evidence: string[];
  by: "llm" | "rules";
}

const SIGNAL_TYPES = Object.keys(SIGNAL_DEFINITIONS) as SignalType[];

// Order matters: earlier types win a tie, so the two urgent, specific signals
// (a live tender, a named appointment) rank above the general ones.
const RULES: { type: SignalType; patterns: RegExp[] }[] = [
  {
    type: "public_rfp",
    patterns: [
      /\btender\b/i,
      /\brfp\b/i,
      /\brfi\b/i,
      /request for (proposals?|tenders?|quotations?|information)/i,
      /\bprocurement\b/i,
      /call for (bids|proposals)/i,
      /invitation to (tender|bid)/i,
      /\bcontract notice\b/i,
    ],
  },
  {
    type: "new_data_leader",
    patterns: [
      /appoint(ed|s|ment)?\b/i,
      /joins? .{0,30}\bas\b/i,
      /(new|first) (chief data officer|head of data|vp of data|director of data)/i,
      /chief data officer/i,
      /\bcdo\b/,
      /new (chief information officer|chief technology officer|chief digital officer)/i,
      /head of (data|analytics)/i,
      /vp of (data|analytics)/i,
      /(hires?|names?) .{0,40}(chief data|head of data|vp of data)/i,
    ],
  },
  {
    type: "funding_ma",
    patterns: [
      /rais(e|es|ed|ing)\b/i,
      /series [a-e]\b/i,
      /funding round/i,
      /\bseed round\b/i,
      /acquir(e|ed|es|ing)\b/i,
      /\bmerger\b/i,
      /\bipo\b/i,
      /investment (of|round|from)/i,
      /\$\s?\d+(\.\d+)?\s?(m|bn|million|billion)\b/i,
    ],
  },
  {
    type: "data_hiring_no_leadership",
    patterns: [
      /\bhiring\b/i,
      /job ads?\b/i,
      /\bvacanc(y|ies)\b/i,
      /is recruiting/i,
      /data engineer/i,
      /analytics engineer/i,
      /data platform (team|engineer)/i,
      /(looking|searching) for (a|an)?\s?(senior\s)?(data|analytics)/i,
      /\bopen roles?\b/i,
    ],
  },
  {
    type: "platform_adoption",
    patterns: [
      /\bmigrat(e|es|ed|ing|ion)\b/i,
      /\badopt(ed|s|ing|ion)?\b/i,
      /\bimplement(ed|s|ing|ation)?\b/i,
      /roll(ing)? out/i,
      /\b(snowflake|databricks|bigquery|redshift|fabric|dbt)\b/i,
      /new data (platform|warehouse|lakehouse|stack)/i,
      /data warehouse/i,
      /machine learning platform/i,
      /\bmodernis(e|ing|ation)\b/i,
    ],
  },
];

/** First sentence-ish slice of the source text, used as the signal summary. */
export function summarise(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function strengthFor(matches: number, type: SignalType): number {
  const base = 0.55 + Math.max(0, matches - 1) * 0.08;
  const definition = SIGNAL_DEFINITIONS[type];
  return Math.min(0.95, Math.max(0.4, Number((base * (0.85 + definition.weight * 0.3)).toFixed(2))));
}

/** Deterministic rules. Returns null when the item is not a tracked signal. */
export function classifyWithRules(text: string): Classification | null {
  let best: { type: SignalType; hits: string[] } | null = null;
  for (const rule of RULES) {
    // Record the phrase that matched, not the pattern: the evidence goes in front
    // of a human who is deciding whether to trust the signal.
    const hits = rule.patterns
      .map((p) => text.match(p)?.[0]?.trim())
      .filter((hit): hit is string => Boolean(hit));
    const unique = [...new Set(hits)].slice(0, 4);
    if (unique.length === 0) continue;
    if (!best || unique.length > best.hits.length) best = { type: rule.type, hits: unique };
  }
  if (!best) return null;
  return {
    type: best.type,
    strength: strengthFor(best.hits.length, best.type),
    summary: summarise(text),
    evidence: best.hits,
    by: "rules",
  };
}

function isSignalType(value: unknown): value is SignalType {
  return typeof value === "string" && (SIGNAL_TYPES as string[]).includes(value);
}

/**
 * Classify one source item. The LLM is asked first when configured; anything it
 * returns that is not a known signal type is discarded in favour of the rules.
 */
export async function classify(text: string): Promise<Classification | null> {
  if (llmEnabled()) {
    const catalogue = SIGNAL_TYPES.map(
      (t) => `- ${t}: ${SIGNAL_DEFINITIONS[t].label} — ${SIGNAL_DEFINITIONS[t].why}`,
    ).join("\n");
    const fromLlm = await chatJSON<{
      type: string;
      strength: number;
      summary: string;
    }>(
      "You classify B2B buying signals for a data and AI consultancy. You only use facts " +
        "present in the text, you never invent numbers or names, and you answer with JSON only.",
      `Classify this source item.\n\nSignal types:\n${catalogue}\n\nItem:\n${text}\n\n` +
        `Return JSON with keys: "type" (one of the type keys above, or "none" if it is not ` +
        `evidence of a live need), "strength" (0..1, how strongly this item implies an active ` +
        `project), "summary" (one factual sentence, max 160 characters, quoting the specifics).`,
    );
    if (fromLlm) {
      if (isSignalType(fromLlm.type)) {
        const strength = Number(fromLlm.strength);
        return {
          type: fromLlm.type,
          strength: Number.isFinite(strength)
            ? Math.min(1, Math.max(0.2, strength))
            : SIGNAL_DEFINITIONS[fromLlm.type].weight,
          summary: summarise(fromLlm.summary || text),
          evidence: [fromLlm.type],
          by: "llm",
        };
      }
      // "none" is a legitimate answer: fall through so the rules can still catch
      // something the model dismissed. They return null if it really is noise.
    }
  }
  return classifyWithRules(text);
}
