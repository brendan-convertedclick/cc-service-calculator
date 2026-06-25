// Thin wrapper around the Anthropic Messages API. Optional cache_control on
// the system prompt for prompt-cache hits across repeated calls with the same
// system prompt (used by all four AI edge functions today).

// A message's content can be a plain string (the common case) or an array of
// content blocks — used to attach a PDF/image alongside a text instruction.
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type AnthropicMessage =
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | { role: "assistant"; content: string | AnthropicContentBlock[] };

export type CallAnthropicInput = {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  cacheSystem?: boolean;
};

export type AnthropicResponse = {
  content: Array<{ type: string; text: string }>;
  // permissive; callers narrow as needed
  [key: string]: unknown;
};

export async function callAnthropic(input: CallAnthropicInput): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const systemBlock = input.cacheSystem
    ? [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }]
    : input.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      system: systemBlock,
      messages: input.messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }
  return await res.json() as AnthropicResponse;
}
