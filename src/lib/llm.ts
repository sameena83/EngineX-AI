// LLM adapter. EngineX uses a commercial LLM for signal classification, account
// briefs and outreach drafts (see the report's technical architecture).
//
// The adapter speaks the OpenAI chat-completions protocol, so it works with any
// OpenAI-compatible provider or gateway. If no key is configured the app falls
// back to deterministic template generation (see ./generate.ts) and keeps
// working — useful for demos, tests and offline development.

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
  const model = process.env.ENGINEX_MODEL ?? "gpt-4o-mini";
  return { apiKey, baseURL, model };
}

/**
 * Ask the model for a JSON object. Returns null on any failure so callers can
 * fall back to templates rather than surfacing a broken screen.
 */
export async function chatJSON<T>(
  system: string,
  user: string,
): Promise<T | null> {
  if (!llmEnabled()) return null;
  const { apiKey, baseURL, model } = config();
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
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
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
