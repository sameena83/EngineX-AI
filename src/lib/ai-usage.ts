// What a workspace spends on the model.
//
// EngineX runs on one operator-owned key, so every customer's generation is paid
// for by the operator: margin is the price the customer pays minus what their
// briefs and drafts cost. That makes two things necessary and neither is optional
// once the app is sold:
//
//   - the cost has to be a number per workspace, not an inference from a monthly
//     invoice, so a customer who generates far more than they use is visible;
//   - there has to be a ceiling, so a bug, a retry loop or an abusive session
//     cannot run up a bill before anyone notices.
//
// The ceiling is a daily cap, and it fails soft: over the cap, ./llm.ts returns
// null and the caller falls back to the template engine, which is the same path a
// deployment with no key at all takes. A customer over their ceiling loses the
// model's prose, not the product.
//
// Classification is pinned to its own model (`ENGINEX_CLASSIFY_MODEL`) because it
// runs on every source item and does not need the model that writes briefs. That
// one split is usually the single biggest cost lever.
//
// Prices below are list prices per million tokens, approximate on purpose — this
// is margin accounting, not billing — and a deployment on a gateway or a
// negotiated rate overrides them with AI_PRICE_OVERRIDES rather than editing code.

export type AiPurpose = "classify" | "brief" | "draft" | "review";

interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * Approximate list prices, matched by longest model-name prefix so a dated
 * snapshot (`gpt-4o-mini-2024-07-18`) uses its family's price.
 *
 * These are deliberately editable at runtime: see AI_PRICE_OVERRIDES.
 */
const DEFAULT_PRICES: Record<string, Price> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
};

/** Used for a model no prefix matches: better a visible over-estimate than a
 *  silent zero that would let an unknown model spend without counting. */
const FALLBACK_PRICE: Price = { input: 1, output: 3 };

/** Cost of one call, in USD, from its token counts. */
export function costUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  prices: Record<string, Price> = pricesFromEnv(),
): number {
  const price = priceFor(model, prices);
  const inTok = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0;
  const outTok = Number.isFinite(completionTokens) ? Math.max(0, completionTokens) : 0;
  return (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
}

function priceFor(model: string, prices: Record<string, Price>): Price {
  const name = model.toLowerCase();
  let best: { prefix: string; price: Price } | null = null;
  for (const [prefix, price] of Object.entries(prices)) {
    if (!name.includes(prefix.toLowerCase())) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, price };
  }
  return best?.price ?? FALLBACK_PRICE;
}

/** A deployment's own price list, merged over the defaults. */
export function pricesFromEnv(): Record<string, Price> {
  const merged = { ...DEFAULT_PRICES };
  const raw = (process.env.AI_PRICE_OVERRIDES ?? "").trim();
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    for (const [model, entry] of Object.entries(parsed)) {
      const input = Number(entry?.input);
      const output = Number(entry?.output);
      if (Number.isFinite(input) && Number.isFinite(output)) {
        merged[model.toLowerCase()] = { input: Math.max(0, input), output: Math.max(0, output) };
      }
    }
  } catch {
    // A malformed override must not stop generation: the default prices are an
    // over-estimate by design, so falling back to them errs on the safe side.
  }
  return merged;
}

/** The model that answers a given kind of call. */
export function modelFor(purpose: AiPurpose): string {
  const main = (process.env.ENGINEX_MODEL ?? "").trim() || "gpt-4o-mini";
  if (purpose !== "classify") return main;
  // Classification runs on every ingested item, so it gets its own — normally
  // cheaper — model. Unset means "same as everything else", not a silent switch
  // to a different provider.
  return (process.env.ENGINEX_CLASSIFY_MODEL ?? "").trim() || main;
}

/** USD a workspace may spend on the model per UTC day. */
export function dailyCapUsd(): number {
  const raw = (process.env.AI_DAILY_USD_CAP ?? "").trim();
  const parsed = Number(raw);
  // A non-positive or unparseable value means "no ceiling was intended", so the
  // documented default applies rather than silently disabling the cap.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Whether a day's spend has reached the cap. */
export function overCap(spentUsd: number, capUsd: number = dailyCapUsd()): boolean {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return false;
  return spentUsd >= capUsd;
}

/** The UTC day a call belongs to, as `YYYY-MM-DD`. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface AiUsageTotals {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * What this workspace has spent today.
 *
 * Read before every model call, so it has to be cheap: one indexed sum over at
 * most a handful of rows. A database failure is treated as "at the cap" — the
 * template fallback is a complete product, and a cap that fails open is not a
 * cap. The error is logged rather than swallowed silently.
 */
export async function spentTodayUsd(tenantId: number, now: Date = new Date()): Promise<number> {
  const { aiUsageSpent } = await import("./db");
  try {
    return await aiUsageSpent(tenantId, dayKey(now));
  } catch (err) {
    console.warn(
      `[ai-usage] could not read today's spend for workspace ${tenantId}: ` +
        `${err instanceof Error ? err.message : String(err)} — falling back to templates.`,
    );
    return Number.POSITIVE_INFINITY;
  }
}

/** Record one completed call. Never throws: usage tracking must not fail a brief. */
export async function recordUsage(input: {
  tenantId: number;
  purpose: AiPurpose;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  const cost = costUsd(input.model, input.promptTokens, input.completionTokens);
  try {
    const { recordAiUsage } = await import("./db");
    await recordAiUsage({
      tenantId: input.tenantId,
      day: dayKey(),
      model: input.model,
      purpose: input.purpose,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costUsd: cost,
    });
  } catch (err) {
    console.warn(
      `[ai-usage] could not record usage for workspace ${input.tenantId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The last `days` days of usage for a workspace, newest first. */
export async function recentUsage(tenantId: number, days = 14): Promise<AiUsageTotals[]> {
  const { listAiUsage } = await import("./db");
  const rows = await listAiUsage(tenantId, days);
  return rows;
}

/** What the model configuration looks like, for /api/health and the UI. */
export function aiConfig() {
  return {
    model: modelFor("brief"),
    classifyModel: modelFor("classify"),
    dailyCapUsd: dailyCapUsd(),
  };
}
