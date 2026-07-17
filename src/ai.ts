import { requestUrl } from "obsidian";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AIConfig {
  provider: string; // "gemini" | "anthropic" | "xai" | "openai"
  apiKey: string;
  model: string;
  baseUrl: string; // used by the OpenAI-compatible provider
}

/** Suggested default model per provider (editable by the user). */
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.5-flash",
  anthropic: "claude-sonnet-4-5",
  xai: "grok-4",
  openai: "gpt-5",
};

/** Route a chat turn to the configured provider and return the reply text. */
export async function aiChat(cfg: AIConfig, system: string, messages: ChatMessage[]): Promise<string> {
  switch (cfg.provider) {
    case "anthropic": return anthropicChat(cfg, system, messages);
    case "xai": return openaiCompatChat({ ...cfg, baseUrl: "https://api.x.ai/v1" }, system, messages);
    case "openai": return openaiCompatChat(cfg, system, messages);
    case "gemini":
    default: return geminiChat(cfg.apiKey, cfg.model, system, messages);
  }
}

function apiError(status: number, json: unknown, fallback: string): Error {
  let msg = `${fallback} (${status})`;
  const j = json as { error?: { message?: string } | string; message?: string };
  if (j) {
    if (typeof j.error === "string") msg = j.error;
    else if (j.error?.message) msg = j.error.message;
    else if (j.message) msg = j.message;
  }
  return new Error(msg);
}

/** Google Gemini (Generative Language API). */
export async function geminiChat(apiKey: string, model: string, system: string, messages: ChatMessage[]): Promise<string> {
  const mdl = (model || DEFAULT_MODELS.gemini).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  const body: Record<string, unknown> = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await requestUrl({ url, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), throw: false });
  if (res.status < 200 || res.status >= 300) throw apiError(res.status, res.json, "Gemini API error");
  const data = res.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text || "").join("").trim() || "(the model returned an empty response)";
}

/** Anthropic Claude (Messages API). */
async function anthropicChat(cfg: AIConfig, system: string, messages: ChatMessage[]): Promise<string> {
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: (cfg.model || DEFAULT_MODELS.anthropic).trim(),
      max_tokens: 1024,
      system: system || undefined,
      messages: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
    }),
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) throw apiError(res.status, res.json, "Anthropic API error");
  const data = res.json as { content?: Array<{ text?: string }> };
  return (data?.content ?? []).map((c) => c.text || "").join("").trim() || "(the model returned an empty response)";
}

/** OpenAI-compatible chat completions (OpenAI, xAI/Grok, OpenRouter, Ollama, Bedrock gateways, …). */
async function openaiCompatChat(cfg: AIConfig, system: string, messages: ChatMessage[]): Promise<string> {
  const base = (cfg.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const msgs: Array<{ role: string; content: string }> = [];
  if (system) msgs.push({ role: "system", content: system });
  messages.forEach((m) => msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));

  const res = await requestUrl({
    url: `${base}/chat/completions`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model.trim(), messages: msgs }),
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) throw apiError(res.status, res.json, "AI API error");
  const data = res.json as { choices?: Array<{ message?: { content?: string } }> };
  return (data?.choices?.[0]?.message?.content ?? "").trim() || "(the model returned an empty response)";
}
