import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AUTH_HOST, CANONICAL_REDIRECT_URI } from "../src/appdomain";
// @ts-expect-error - plain JS Worker module
import { CANONICAL_REDIRECT_URI as WORKER_REDIRECT, AUTH_HOST as WORKER_AUTH_HOST } from "../worker/src/config.js";

// =====================================================================================
// Feature: google-oauth-verification
// Example tests — Worker configuration guards
//
// Three regressions these catch, each of which would be silent until it hit users:
//   1. wrangler.toml's route drifting from app-domain.json (TOML cannot import JSON, so this
//      is the ONLY thing tying the pair together).
//   2. workers_dev flipping to false, which would cut off every already-installed plugin at
//      once — they all have the legacy hostname compiled into main.js.
//   3. a storage binding appearing, which would contradict the privacy policy's statement
//      that the broker is stateless and persists nothing.
//
// Validates: Requirements 3.5, 6.1, 6.3, 7.1, 7.5
// =====================================================================================

const wrangler = readFileSync("worker/wrangler.toml", "utf8");

/** Values of every `pattern = "..."` entry in the TOML. */
const routePatterns = [...wrangler.matchAll(/^\s*pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);

describe("wrangler.toml stays in sync with app-domain.json", () => {
  it("routes the custom domain to the configured auth host", () => {
    expect(routePatterns).toContain(AUTH_HOST);
  });

  it("marks the route as a custom domain", () => {
    expect(wrangler).toMatch(/custom_domain\s*=\s*true/);
  });
});

describe("the legacy workers.dev hostname stays alive", () => {
  it("keeps workers_dev enabled explicitly", () => {
    // Not merely "absent" — explicitly true, so a future config cleanup has to argue with a
    // comment explaining that turning it off breaks every existing install.
    expect(wrangler).toMatch(/^\s*workers_dev\s*=\s*true\s*$/m);
    expect(wrangler).not.toMatch(/workers_dev\s*=\s*false/);
  });
});

describe("the broker is stateless", () => {
  it("declares no storage binding", () => {
    for (const binding of [
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "durable_objects",
      "queues",
      "hyperdrive",
      "vectorize",
    ]) {
      expect(wrangler).not.toContain(binding);
    }
  });

  it("never references a storage or cache API in the Worker source", () => {
    const src = readFileSync("worker/src/index.js", "utf8");
    for (const api of ["caches.", "env.KV", "env.DB", "env.BUCKET", "DurableObject"]) {
      expect(src).not.toContain(api);
    }
  });
});

describe("plugin and Worker derive the same canonical redirect", () => {
  it("agrees on the redirect URI byte for byte", () => {
    // Divergence here is exactly what produces redirect_uri_mismatch, and it would only show
    // up when a real user tried to connect. Both sides read the same JSON, so this asserts
    // the derivation templates match too.
    expect(WORKER_REDIRECT).toBe(CANONICAL_REDIRECT_URI);
    expect(WORKER_AUTH_HOST).toBe(AUTH_HOST);
  });

  it("uses https and the /callback path", () => {
    expect(CANONICAL_REDIRECT_URI).toBe(`https://${AUTH_HOST}/callback`);
    expect(CANONICAL_REDIRECT_URI.startsWith("https://")).toBe(true);
    expect(CANONICAL_REDIRECT_URI.endsWith("/callback")).toBe(true);
  });
});

describe("the requested scope never widens", () => {
  it("asks for the single Google Tasks scope", () => {
    const src = readFileSync("worker/src/index.js", "utf8");
    const scopes = [...src.matchAll(/const SCOPES\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(scopes).toEqual(["https://www.googleapis.com/auth/tasks"]);
    // A readonly variant or an extra identity scope would change what the consent screen
    // shows and invalidate the verification submission.
    expect(src).not.toContain("tasks.readonly");
    expect(src).not.toContain("userinfo");
    expect(src).not.toContain("openid");
  });
});
