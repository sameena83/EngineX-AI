// Vocabulary helpers shared by classification, matching and scoring.
//
// Kept dependency-free (types only) so it can be imported from any of them
// without creating a cycle.

import type { Channel } from "./channels";
import type { NichePreset } from "./niches";
import type {
  NicheConfig,
  SignalDefinition,
  SignalType,
  Vocabulary,
} from "./types";

/** "cloud_cost_initiative" → "Cloud cost initiative". */
export function humaniseType(type: string): string {
  const spaced = type.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : type;
}

/**
 * A signal's definition, or a neutral stand-in.
 *
 * The fallback matters: when a tenant switches niche, signals already stored
 * under the previous vocabulary must still score and render. Losing the label
 * must never lose the evidence, so an unknown type contributes at a middling
 * weight and displays its key rather than disappearing.
 */
export function definitionFor(vocab: Vocabulary, type: SignalType): SignalDefinition {
  const found = vocab.find((d) => d.type === type);
  if (found) return found;
  return {
    type,
    label: humaniseType(type),
    shortLabel: humaniseType(type),
    weight: 0.5,
    why: "Stored under an earlier vocabulary; still counted as evidence.",
    patterns: [],
    serviceKeywords: [],
    // No channel restriction: this definition is only ever read when scoring or
    // rendering an existing signal, and restricting it could not un-collect it.
    sources: [],
  };
}

/** Turn a niche preset's signals into the per-tenant vocabulary rows. */
export function presetToVocabulary(preset: NichePreset): Vocabulary {
  return preset.signals.map((s) => ({
    type: s.key,
    label: s.label,
    shortLabel: s.shortLabel,
    weight: s.weight,
    why: s.why,
    patterns: [...s.patterns],
    serviceKeywords: [...s.serviceKeywords],
    // Adopting a market is a deliberate choice, so its routing is explicit from
    // the moment it is written.
    sources: [...s.sources],
    sourcesExplicit: true,
  }));
}

/**
 * Route the rules whose channels were never chosen.
 *
 * The rows migration 5 added a channel column to were already configured when the
 * column arrived, so they were left empty, which means "reads every channel" —
 * tolerant, but it also means a tender pattern kept matching press releases while
 * the UI said nothing was wrong. Migration 6 marks those rows as not-explicit
 * (`sources_explicit = false`), and this resolves them against the presets: the
 * rule key is shared across markets on purpose, so a key that any preset defines
 * has a routing better than "everything".
 *
 * Deliberately narrow, in both directions:
 *
 *   - `sourcesExplicit` rows are returned untouched, so clearing a rule's channels
 *     by hand still means "any channel" and stays that way;
 *   - a key no preset defines keeps its stored value, because there is nothing to
 *     inherit and inventing channels for a rule someone wrote would be a guess.
 *
 * The `channelsFor` lookup is passed in rather than imported so this stays pure
 * and testable against the real presets or a stub.
 */
export function resolveImplicitRouting(
  vocab: Vocabulary,
  channelsFor: (type: SignalType) => Channel[] | undefined,
): Vocabulary {
  return vocab.map((def) => {
    if (def.sourcesExplicit) return def;
    const declared = channelsFor(def.type);
    if (!declared?.length) return def;
    return { ...def, sources: [...declared] };
  });
}

/** The rules that will still match evidence from any channel. */
export function unconstrainedTypes(vocab: Vocabulary): SignalType[] {
  return vocab.filter((def) => def.sources.length === 0).map((def) => def.type);
}

/**
 * Whether a rule reads evidence from this channel.
 *
 * An empty channel list means every channel — so a rule someone wrote by hand, or
 * one stored before channels existed, stays in the pipeline instead of quietly
 * never matching anything.
 */
export function readsChannel(def: SignalDefinition, channel: Channel): boolean {
  return def.sources.length === 0 || def.sources.includes(channel);
}

/**
 * The rules that may be run against a candidate from this channel.
 *
 * Called per candidate during ingestion, so the whole point is that it is a
 * cheap filter: routing a tender item through a hiring rule is not just wasteful,
 * it is how a feed fills with signals that were never there.
 */
export function vocabularyForChannel(vocab: Vocabulary, channel: Channel | null): Vocabulary {
  if (!channel) return vocab;
  return vocab.filter((def) => readsChannel(def, channel));
}

/** Every channel any rule in this vocabulary reads, deduplicated. */
export function channelsRead(vocab: Vocabulary): Channel[] {
  return [...new Set(vocab.flatMap((def) => def.sources))];
}

/** The non-signal half of a niche preset, as the tenant's editable config. */
export function nicheConfigFromPreset(preset: NichePreset): NicheConfig {
  return {
    key: preset.key,
    label: preset.label,
    description: preset.description,
    buyerRoles: [...preset.buyerRoles],
    negativeRules: preset.negativeRules.map((r) => ({ label: r.label, patterns: [...r.patterns] })),
    exclusions: [...preset.exclusions],
    scoring: { ...preset.scoring },
    outreachAngle: preset.outreachAngle,
    sourceQueries: [...preset.sourceQueries],
  };
}

/**
 * The negative rules that veto a source item, as compiled testers.
 *
 * Kept separate from the positive rules and applied *after* them: the veto only
 * matters for an item that looked like a signal, and a malformed pattern is
 * skipped rather than thrown.
 */
export function compileNegativeRules(
  config: NicheConfig | undefined,
): { label: string; patterns: RegExp[] }[] {
  return (config?.negativeRules ?? [])
    .map((rule) => ({
      label: rule.label,
      patterns: rule.patterns.flatMap((src) => {
        try {
          return [new RegExp(src, "i")];
        } catch {
          return [];
        }
      }),
    }))
    .filter((rule) => rule.patterns.length > 0);
}

/**
 * Whether an item trips a negative rule.
 *
 * Matching is on the whole item text, which is why the patterns are narrow —
 * "book a demo" is vendor marketing wherever it appears, but a broad pattern
 * here would silently discard real signals.
 */
export function negativeRuleHit(
  text: string,
  rules: { label: string; patterns: RegExp[] }[],
): { label: string; phrase: string } | null {
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const hit = text.match(pattern)?.[0]?.trim();
      if (hit) return { label: rule.label, phrase: hit };
    }
  }
  return null;
}

/**
 * Whether a company is excluded outright — a consultancy, agency or recruiter is
 * a competitor or a non-buyer, never a prospect, whatever its signals say.
 *
 * Returns the phrase that excluded it so the feed can explain the omission
 * rather than quietly dropping the account.
 */
export function exclusionHit(
  account: { name: string; description?: string | null },
  exclusions: string[] | undefined,
): string | null {
  if (!exclusions?.length) return null;
  const haystack = `${account.name} ${account.description ?? ""}`.toLowerCase();
  for (const term of exclusions) {
    const needle = term.trim().toLowerCase();
    if (needle.length >= 3 && haystack.includes(needle)) return term.trim();
  }
  return null;
}

/**
 * Compile a vocabulary into the rule matcher's form.
 *
 * A pattern that fails to compile is skipped rather than thrown: a malformed
 * entry in one tenant's vocabulary must not break ingestion for them.
 */
export function compileRules(vocab: Vocabulary): { type: SignalType; patterns: RegExp[] }[] {
  return vocab
    .map((d) => ({
      type: d.type,
      patterns: d.patterns.flatMap((src) => {
        try {
          return [new RegExp(src, "i")];
        } catch {
          return [];
        }
      }),
    }))
    .filter((rule) => rule.patterns.length > 0);
}
