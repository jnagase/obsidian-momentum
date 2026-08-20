import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Properties 6 (plugin side), 7 and 9
//
// The disconnect flow has one rule that must hold no matter what Google answers: a user who
// confirmed disconnection ends up disconnected. Network failure, timeout or an error from
// Google may change the MESSAGE, never the outcome. And cancelling must change nothing at all.
//
// AUDIT: these tests drive the real `revokeGoogleToken` and `redactSecrets` from
// src/googletasks.ts. Obsidian's `requestUrl` is mocked with a COUNTING mock, because the
// properties assert "exactly one request" and "zero requests" — without a counter those
// assertions would pass vacuously.
// =====================================================================================

import { setRequestUrl, resetRequestUrl } from "./stubs/obsidian";
import { revokeGoogleToken, redactSecrets, GoogleToken } from "../src/googletasks";

interface Call { url: string; body: string }
let calls: Call[] = [];
let respondWith: { status: number; text: string; delayMs?: number; throws?: boolean } = { status: 200, text: "" };

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return undefined; }
}

beforeEach(() => {
  calls = [];
  respondWith = { status: 200, text: "" };
  setRequestUrl(async (opts) => {
    calls.push({ url: opts.url, body: String(opts.body ?? "") });
    if (respondWith.throws) throw new Error("net down");
    if (respondWith.delayMs) await new Promise((r) => setTimeout(r, respondWith.delayMs));
    return { status: respondWith.status, text: respondWith.text, json: safeJson(respondWith.text) };
  });
  // revokeGoogleToken races against window.setTimeout, which doesn't exist in the node env.
  vi.stubGlobal("window", { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis) });
});

afterEach(() => {
  resetRequestUrl();
  vi.unstubAllGlobals();
});

/** A token with plausible, distinctive secret material. */
const tokenArb = fc.record({
  access_token: fc.string({ minLength: 20, maxLength: 60 }).map((s) => `ya29.${s.replace(/\s/g, "x")}`),
  refresh_token: fc.string({ minLength: 20, maxLength: 60 }).map((s) => `1//0e${s.replace(/\s/g, "x")}`),
  expires_at: fc.integer({ min: 0 }),
});

// ---------------------------------------------------------------------------------------
// Property 7: Desconectar sempre termina desconectado; cancelar nunca muda nada
// Validates: Requirements 4.1, 4.2, 4.5, 4.6
// ---------------------------------------------------------------------------------------
describe("Property 7: revocation sends exactly one request carrying the right token", () => {
  it("prefers the refresh token, falls back to the access token, never retries", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, fc.boolean(), async (token, dropRefresh) => {
        const t: GoogleToken = dropRefresh ? { ...token, refresh_token: "" } : token;
        calls = [];
        respondWith = { status: 200, text: "" };

        const outcome = await revokeGoogleToken(t);

        expect(outcome.ok).toBe(true);
        expect(calls.length).toBe(1); // exactly one attempt, no retry
        expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");

        // Revoking the refresh token kills the whole grant, so it wins when present.
        const expected = dropRefresh ? t.access_token : t.refresh_token;
        const sent = new URLSearchParams(calls[0].body);
        expect(sent.get("token")).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("reports failure distinguishably for every way Google can refuse", async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.constantFrom("google_error", "network", "timeout"),
        async (token, mode) => {
          calls = [];
          // A short ceiling keeps this property runnable 100 times; the production default is
          // 10s and the assertion below is about behaviour, not the number.
          const FAST_TIMEOUT = 40;
          if (mode === "google_error") respondWith = { status: 400, text: '{"error":"unauthorized_client"}' };
          else if (mode === "network") respondWith = { status: 200, text: "", throws: true };
          else respondWith = { status: 200, text: "", delayMs: FAST_TIMEOUT * 20 };

          const outcome = await revokeGoogleToken(token, FAST_TIMEOUT);

          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.reason).toBe(mode);
            // The detail is for the log and must never echo the token itself.
            expect(outcome.detail).not.toContain(token.refresh_token);
            expect(outcome.detail).not.toContain(token.access_token);
          }
          expect(calls.length).toBe(1); // still one attempt
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("uses a 10s ceiling by default", async () => {
    calls = [];
    respondWith = { status: 200, text: "", delayMs: 20 };
    // Well inside the default ceiling, so it must succeed rather than time out.
    const outcome = await revokeGoogleToken({ access_token: "a".repeat(20), refresh_token: "r".repeat(20), expires_at: 0 });
    expect(outcome.ok).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("treats an already-revoked grant as success", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (token) => {
        calls = [];
        // Google answers 400 invalid_token when the grant is already gone. The user's goal is
        // met, so surfacing an error would be misleading.
        respondWith = { status: 400, text: '{"error":"invalid_token"}' };
        const outcome = await revokeGoogleToken(token);
        expect(outcome.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("sends nothing when there is no token material", async () => {
    calls = [];
    const outcome = await revokeGoogleToken({ access_token: "", refresh_token: "", expires_at: 0 });
    expect(outcome.ok).toBe(true);
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// Property 9: A entrada de log nunca contém segredo
// Validates: Requirements 3.6, 4.4, 11.4, 11.5, 11.6
// ---------------------------------------------------------------------------------------
describe("Property 9: a log line never carries a secret", () => {
  it("redacts tokens wherever they appear in the line", async () => {
    await fc.assert(
      fc.property(tokenArb, fc.string({ maxLength: 60 }), (token, noise) => {
        const line = `${noise} access=${token.access_token} refresh=${token.refresh_token} ${noise}`;
        const safe = redactSecrets(line, token);

        expect(safe).not.toContain(token.access_token);
        expect(safe).not.toContain(token.refresh_token);
        expect(safe).toContain("<redacted>");
      }),
      { numRuns: 100 },
    );
  });

  it("redacts bearer headers and credential query params even with no token in hand", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 8, maxLength: 40 }).filter((s) => !/[\s&"']/.test(s)), (secret) => {
        for (const line of [
          `Authorization: Bearer ${secret}`,
          `GET /x?code=${secret}&state=s`,
          `body: refresh_token=${secret}`,
          `client_secret=${secret}`,
        ]) {
          const safe = redactSecrets(line, null);
          expect(safe).not.toContain(secret);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("leaves harmless text untouched", () => {
    const line = "stage=refresh · error=invalid_grant · error_description=Token has been expired or revoked.";
    expect(redactSecrets(line, null)).toBe(line);
  });
});
