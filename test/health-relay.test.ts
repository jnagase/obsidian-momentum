import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - plain JS Worker module, bundled by wrangler, not typed
import worker from "../worker-health/src/index.js";
// @ts-expect-error - plain JS Worker module
import { CANONICAL_REDIRECT_URI, RELAY_HOST } from "../worker-health/src/config.js";

// The Google Health relay (bring-your-own-client): it must ONLY bounce the code back into
// Obsidian. No secret, no Google call, no storage, and never the Tasks/Drive deep-links.

const src = readFileSync("worker-health/src/index.js", "utf8");
const call = (path: string, method = "GET"): Promise<Response> =>
  worker.fetch(new Request(`https://${RELAY_HOST}${path}`, { method }), {});

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("the relay must never make a network call")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("health relay", () => {
  it("derives its host and redirect from health-domain.json", () => {
    const cfg = JSON.parse(readFileSync("health-domain.json", "utf8")) as { healthRelayHost: string };
    expect(RELAY_HOST).toBe(cfg.healthRelayHost);
    expect(CANONICAL_REDIRECT_URI).toBe(`https://${cfg.healthRelayHost}/callback`);
    expect(readFileSync("worker-health/wrangler.toml", "utf8")).toContain(`pattern = "${cfg.healthRelayHost}"`);
  });

  it("deep-links the code and state into obsidian://momentum-health", async () => {
    const r = await call("/callback?code=4%2FabcD&state=s1");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain("obsidian://momentum-health?code=4%2FabcD&state=s1");
    expect(html).toContain("location.replace");
    expect(html).not.toContain("obsidian://momentum-google");
    expect(html).not.toContain("obsidian://momentum-drive");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on a Google error shows it and does NOT auto-redirect", async () => {
    const html = await (await call("/callback?error=access_denied&state=s1")).text();
    expect(html).toContain("access_denied");
    expect(html).not.toContain("location.replace");
  });

  it("escapes what Google sends back (no HTML injection)", async () => {
    const html = await (await call("/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("serves home and privacy pages, and nothing else echoes input", async () => {
    expect(await (await call("/")).text()).toContain(CANONICAL_REDIRECT_URI);
    expect(await (await call("/privacy")).text()).toContain("Privacy Policy");
    const other = await (await call("/whatever?x=%3Cb%3E")).text();
    expect(other).not.toContain("<b>");
    expect((await call("/callback", "POST")).status).toBe(405);
  });

  it("holds no secret, no Google endpoint and no storage", () => {
    for (const s of ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "client_secret", "oauth2.googleapis.com",
      "env.", "caches.", "env.KV", "DurableObject", "console.log"]) {
      expect(src).not.toContain(s);
    }
  });
});
