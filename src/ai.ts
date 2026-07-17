import { Platform, requestUrl } from "obsidian";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AIConfig {
  provider: string; // "gemini" | "anthropic" | "xai" | "openai" | "local"
  apiKey: string;
  model: string;
  baseUrl: string; // used by the OpenAI-compatible provider
  command: string; // used by the local-command provider (desktop only)
  args: string;    // args for the local command; use {prompt} to pass the prompt as an argument
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
    case "local": return localCommandChat(cfg, system, messages);
    case "gemini":
    default: return geminiChat(cfg.apiKey, cfg.model, system, messages);
  }
}

/** Remove ANSI escape/color codes a CLI may emit, without a literal control char in the source. */
function stripAnsi(s: string): string {
  const esc = String.fromCharCode(27);
  return s.replace(new RegExp(esc + "\\[[0-9;?]*[A-Za-z]", "g"), "");
}

/** Clean a headless CLI's stdout: drop color codes, the leading "> " marker and a credits/time footer. */
function cleanCliOutput(s: string): string {
  const lines = stripAnsi(s)
    .split("\n")
    .filter((l) => !/Credits:\s*[\d.]+/i.test(l) && !/^\s*[▸>].*Time:/i.test(l));
  return lines.join("\n").replace(/^\s*>\s?/, "").trim();
}

/** Flatten the system prompt + conversation into a single text prompt for a one-shot CLI. */
function buildPrompt(system: string, messages: ChatMessage[]): string {
  const parts: string[] = [];
  if (system) parts.push(system);
  for (const m of messages) parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.text}`);
  parts.push("Assistant:");
  return parts.join("\n\n");
}

/**
 * Personal, desktop-only bridge: run a local CLI (e.g. a Kiro/Q CLI in headless mode),
 * pass the prompt via stdin (or a {prompt} arg placeholder) and return its stdout.
 * Not for the community build — executing local binaries is desktop-only and not review-safe.
 */
async function localCommandChat(cfg: AIConfig, system: string, messages: ChatMessage[]): Promise<string> {
  // Guarded by a build-time flag so the community build tree-shakes this whole block
  // (and its child_process import) out. Only a personal MOMENTUM_LOCAL=1 build keeps it.
  if (MOMENTUM_LOCAL_CMD) {
    if (!Platform.isDesktopApp) throw new Error("The local command provider only works on desktop.");
    const cmd = (cfg.command || "").trim();
    if (!cmd) throw new Error("Set the command path in Settings → AI assistant → Command.");

    const prompt = buildPrompt(system, messages);
    const raw = (cfg.args || "").trim();
    const usesPlaceholder = raw.includes("{prompt}");
    const args = raw.length ? raw.split(/\s+/).map((a) => a.replace("{prompt}", prompt)) : [];

    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules, no-undef -- personal desktop-only bridge, excluded from the community build
    const cp = require("child_process") as typeof import("child_process");
    return await new Promise<string>((resolve, reject) => {
      let out = "";
      let err = "";
      const child = cp.spawn(cmd, args, { shell: false });
      const timer = window.setTimeout(() => { child.kill(); reject(new Error("Command timed out after 120s.")); }, 120000);
      child.stdout.on("data", (d: unknown) => { out += String(d); });
      child.stderr.on("data", (d: unknown) => { err += String(d); });
      child.on("error", (e: Error) => { window.clearTimeout(timer); reject(new Error(`Failed to run command: ${e.message}`)); });
      child.on("close", (code: number | null) => {
        window.clearTimeout(timer);
        if (code === 0) resolve(cleanCliOutput(out) || "(the command returned no output)");
        else reject(new Error(stripAnsi(err).trim() || `Command exited with code ${code}`));
      });
      if (!usesPlaceholder && child.stdin) { child.stdin.write(prompt); child.stdin.end(); }
    });
  }
  throw new Error("The local command provider is not available in this build.");
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
