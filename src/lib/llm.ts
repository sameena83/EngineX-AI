// LLM adapter. EngineX uses a commercial LLM for signal classification, account
// briefs and outreach drafts (see the report's technical architecture).
//
// The adapter speaks the OpenAI chat-completions protocol, so it works with any
// OpenAI-compatible provider or gateway. If no key is configured the app falls
// back to deterministic template generation (see ./generate.ts) and keeps
// working — useful for demos, tests and offline development.
//
// Cost is a first-class concern here, because one operator key pays for every
// customer's generation. So each call declares what it is for (the purpose picks
// the model), and a call made on behalf of a workspace checks that workspace's
// daily cap first and records its tokens afterwards (see ./ai-usage.ts). Over the
// cap, this returns null exactly like an unconfigured deployment: the caller falls
// back to templates and the product keeps working without the model's prose.

import { modelFor, overCap, recordUsage, spentTodayUsd, type AiPurpose } from "./ai-usage";

export function llmEnabled(): boolean {
  return Boolean(process.env.OPENLLM_API_KEY || process.env.OPENAI_API_KEY);
}

function config() {
  const apiKey =
    process.env.OPENLLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const baseURL = (
    process.env.OPENLLM_ENDPOINT ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  return { apiKey, baseURL };
}

export interface LlmCallOptions {
  /**
   * What the call is for. This chooses the model — classification runs on every
   * ingested item and gets the cheaper one — and it is what usage is recorded
   * against, so a workspace's spend can be read per purpose.
   */
  purpose?: AiPurpose;
  /**
   * The workspace on whose behalf the call is made. Required for the daily cap
   * and for usage accounting; a call without one is not counted, which is why
   * every route passes it.
   */
  tenantId?: number;
}

/**
 * Ask the model for a JSON object. Returns null on any failure so callers can
 * fall back to templates rather than surfacing a broken screen. "Failure"
 * includes a workspace that has reached its daily spend cap.
 */
export async function chatJSON<T>(
  system: string,
  user: string,
  options: LlmCallOptions = {},
): Promise<T | null> {
  if (!llmEnabled()) return null;

  const purpose: AiPurpose = options.purpose ?? "draft";
  const model = modelFor(purpose);

  if (options.tenantId) {
    const spent = await spentTodayUsd(options.tenantId);
    if (overCap(spent)) {
      console.warn(
        `[llm] workspace ${options.tenantId} has reached its daily AI cap ` +
          `($${spent.toFixed(2)} spent) — answering "${purpose}" from templates.`,
      );
      return null;
    }
  }

  const { apiKey, baseURL } = config();
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Recorded before parsing: the tokens are already spent whether or not the
    // model returned valid JSON, and a parse failure still costs money.
    if (options.tenantId) {
      await recordUsage({
        tenantId: options.tenantId,
        purpose,
        model,
        promptTokens: Number(data.usage?.prompt_tokens ?? 0),
        completionTokens: Number(data.usage?.completion_tokens ?? 0),
      });
    }

    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function llmProviderLabel(): string {
  if (process.env.OPENLLM_API_KEY) return "OpenLLM gateway";
  if (process.env.OPENAI_API_KEY) return "OpenAI";
  return "Template engine";
}
