import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
import { setRequestUrl, resetRequestUrl } from "./stubs/obsidian";
import {
  refreshToken, ensureFreshToken, revokeGoogleToken,
  GoogleAuthExpiredError, isUserCapError, GoogleToken,
} from "../src/googletasks";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Property 8 — Falha de autenticação não destrói estado
//
//   ∀ Google refusal (refresh refused, authorisation refused for the project's user cap, or a
//   revocation that fails): no stored token is silently discarded, no re-authorisation is
//   triggered automatically, and the refused call does not reach the Tasks API.
//
// The reason this matters: a refusal is exactly the moment when destructive "recovery" is
// tempting. Dropping the refresh token on a transient 500, or auto-reopening consent, would turn
// a temporary Google problem into data the user has to rebuild.
//
// Validates: Requirements 4.3, 7.10, 11.7
//
// AUDIT: exercises the real refreshToken / ensureFreshToken / revokeGoogleToken. Vault-level
// preservation (notes and google_id untouched) is not unit-testable here — that is gate I4 in
// the plan, run against a real account.
// =====================================================================================

interface Seen { host: string }
let seen: Seen[] = [];
let respondWith: { status: number; text: string } = { status: 400, text: "" };

beforeEach(() => {
  seen = [];
  setRequestUrl(async (opts) => {
    seen.push({ host: new URL(opts.url).hostname });
    return { status: respondWith.status, text: respondWith.text, json: safeJson(respondWith.text) };
  });
  vi.stubGlobal("window", { setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis) });
});

afterEach(() => {
  resetRequestUrl();
  vi.unstubAllGlobals();
});

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return undefined; }
}

const tokenArb: fc.Arbitrary<GoogleToken> = fc.record({
  access_token: fc.string({ minLength: 10, maxLength: 30 }).map((s) => `ya29.${s.replace(/\s/g, "x")}`),
  refresh_token: fc.string({ minLength: 10, maxLength: 30 }).map((s) => `1//0e${s.replace(/\s/g, "x")}`),
  expires_at: fc.integer({ min: 0, max: 1 }), // already expired, so refresh is attempted
});

/** Every shape of refusal Google can return on a token call. */
const refusalArb = fc.constantFrom(
  { status: 400, text: '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}' },
  { status: 400, text: '{"error":"invalid_request"}' },
  { status: 401, text: '{"error":"invalid_client","error_description":"Unauthorized"}' },
  { status: 403, text: '{"error":"rate_limit_exceeded"}' },
  { status: 500, text: "internal error" },
  { status: 504, text: '{"error":"timeout","error_description":"Google did not respond within 10s"}' },
);

describe("Property 8: an authentication failure never destroys state", () => {
  it("leaves the stored token untouched whatever the refusal", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, refusalArb, async (token, refusal) => {
        const before = { ...token };
        respondWith = refusal;

        await expect(refreshToken(token)).rejects.toThrow();

        // The token object handed in is not mutated: the caller still holds a usable refresh
        // token to retry with later.
        expect(token).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  it("never touches the Tasks API while authenticating", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, refusalArb, async (token, refusal) => {
        seen = [];
        respondWith = refusal;

        await expect(ensureFreshToken(token)).rejects.toThrow();

        // A failed refresh must not have reached the data plane.
        expect(seen.every((s) => s.host !== "tasks.googleapis.com")).toBe(true);
        expect(seen.length).toBe(1); // exactly the refresh attempt, no retry
      }),
      { numRuns: 100 },
    );
  });

  it("classifies an expired grant so the caller can ask for a reconnect, not retry", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, async (token) => {
        respondWith = { status: 400, text: '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}' };

        // A dedicated error type is what lets the UI say "reconnect" instead of showing a
        // generic failure the user cannot act on — and it must NOT trigger a retry loop.
        await expect(refreshToken(token)).rejects.toBeInstanceOf(GoogleAuthExpiredError);
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the token when revocation itself fails", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, refusalArb, async (token, refusal) => {
        const before = { ...token };
        respondWith = refusal;

        const outcome = await revokeGoogleToken(token, 200);

        // invalid_token means the grant is already gone, which counts as success.
        if (refusal.text.includes("invalid_token")) expect(outcome.ok).toBe(true);
        // Either way, revokeGoogleToken never mutates what it was given; clearing the stored
        // token is the caller's decision.
        expect(token).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  it("recognises the project user cap so the message can name the real cause", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "403 — rate_limit_exceeded",
          "Google returned: RATE_LIMIT_EXCEEDED",
          "admin_policy_enforced",
          "the app has reached its user cap",
        ),
        (message) => {
          expect(isUserCapError(message)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not mistake an ordinary error for the user cap", () => {
    for (const message of [
      "Token refresh failed: 400 — invalid_grant",
      "GET /users/@me/lists failed: 500",
      "network error",
    ]) {
      expect(isUserCapError(message)).toBe(false);
    }
  });
});
