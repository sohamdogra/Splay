const DEFAULT_BASE_URL = "https://model.service-inference.ai";
const DEFAULT_TEXT_MODEL = "gpt-4.1-mini";

type FetchLike = typeof fetch;

export type TokenMartTextOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  fetch?: FetchLike;
};

export function tokenMartTextConfigured(): boolean {
  return Boolean(process.env.TOKENMART_API_KEY?.trim());
}

export function tokenMartTextModel(): string {
  return process.env.TOKENMART_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

export async function generateTokenMartJson(prompt: string, options: TokenMartTextOptions = {}): Promise<string | null> {
  const apiKey = options.apiKey?.trim() || process.env.TOKENMART_API_KEY?.trim() || "";
  if (!apiKey) return null;
  const baseUrl = (options.baseUrl?.trim() || process.env.TOKENMART_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = options.model?.trim() || tokenMartTextModel();
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: options.maxTokens ?? 1_100
  };
  if (options.temperature !== undefined) requestBody.temperature = options.temperature;

  try {
    const response = await (options.fetch ?? fetch)(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const message = choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>).message
      : undefined;
    const content = message && typeof message === "object"
      ? (message as Record<string, unknown>).content
      : undefined;
    return typeof content === "string" && content.trim() ? content : null;
  } catch {
    return null;
  }
}
