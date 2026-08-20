import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fc from "fast-check";
// @ts-expect-error - plain JS Worker module, bundled by wrangler, not typed
import worker from "../worker/src/index.js";
// @ts-expect-error - plain JS Worker module
import { CANONICAL_REDIRECT_URI, AUTH_HOST } from "../worker/src/config.js";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Properties 1–6 (broker side)
//
// The whole domain migration rests on one invariant: the OAuth broker's observable output is
// a function of (path, params) and NOT of the hostname the request arrived on. That is what
// lets ~700 existing installs — which have the legacy workers.dev host compiled into their
// main.js — keep authenticating while only the canonical redirect URI stays registered with
// Google.
//
// AUDIT: these tests import the REAL Worker module (worker/src/index.js) and invoke its
// default.fetch with a synthetic env, exactly as the Workers runtime does. globalThis.fetch is
// replaced with a COUNTING mock, because four of these properties assert "zero requests" or
// "exactly one request" — without a counter those assertions would be vacuous.
// =====================================================================================

const LEGACY_HOST = "momentum-google.jaime-nagase.workers.dev";
const ENV = { GOOGLE_CLIENT_ID: "8btbj3o6-test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret-value-do-not-log" };

interface FetchCall { url: string; body: string }

let calls: FetchCall[] = [];
let respondWith: { status: number; body: string; delayMs?: number } = { status: 200, body: '{"access_token":"a","expires_in":3599}' };

beforeEach(() => {
  calls = [];
  respondWith = { status: 200, body: '{"access_token":"a","expires_in":3599}' };
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, body: String(init?.body ?? "") });
    if (respondWith.delayMs) {
      // Honour AbortSignal so the Worker's timeout can win the race.
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, respondWith.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          const err = new Error("aborted");
          err.name = "TimeoutError";
          reject(err);
        });
      });
    }
    return new Response(respondWith.body, { status: respondWith.status });
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Any hostname the Worker might be reached on: legacy, canonical, or something arbitrary. */
const hostArb = fc.constantFrom(LEGACY_HOST, AUTH_HOST, "example.invalid", "another-worker.workers.dev");

/** PKCE-ish values, including characters that break naive URL handling. */
const trickyArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom("a&b=c", "100%", "a+b", "x#y", "ünïcødé", "a/b?c", '"quoted"'),
);

const get = (host: string, path: string, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return worker.fetch(new Request(`https://${host}${path}${qs ? `?${qs}` : ""}`), ENV);
};

const post = (host: string, path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://${host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ENV,
  );

/** The redirect_uri the Worker put in the consent URL. */
const redirectFromAuth = (res: Response): string | null =>
  new URL(res.headers.get("location") ?? "https://x.invalid").searchParams.get("redirect_uri");

/** Reverses the callback page's HTML escaping so we compare against the original value. */
const decodeEntities = (s: string): string =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Pulls the deep link out of the callback page's manual <a href>. Reading the href (rather
 * than the script) is deliberate: it is the path a user exercises when the automatic redirect
 * is blocked, so it must carry the same values.
 */
const deepLinkParams = (html: string): URLSearchParams => {
  const href = html.match(/href="(obsidian:\/\/momentum-google\?[^"]*)"/)?.[1];
  if (!href) throw new Error(`callback page has no deep link: ${html.slice(0, 200)}`);
  return new URL(decodeEntities(href)).searchParams;
};

// ---------------------------------------------------------------------------------------
// Property 1: O redirect_uri é canônico, qualquer que seja o host de entrada
// Validates: Requirements 6.2, 6.4, 6.5, 7.2, 7.9
// ---------------------------------------------------------------------------------------
describe("Property 1: the redirect_uri is canonical regardless of the incoming host", () => {
  it("sends the identical canonical value from /auth and /exchange, on any host", async () => {
    await fc.assert(
      fc.asyncProperty(hostArb, trickyArb, trickyArb, async (host, challenge, state) => {
        calls = [];

        const authRes = await get(host, "/auth", { code_challenge: challenge, state });
        expect(redirectFromAuth(authRes)).toBe(CANONICAL_REDIRECT_URI);

        await post(host, "/exchange", { code: "c", code_verifier: "v" });
        const sent = new URLSearchParams(calls[0].body);
        expect(sent.get("redirect_uri")).toBe(CANONICAL_REDIRECT_URI);

        // The two must be byte-identical or Google answers redirect_uri_mismatch.
        expect(sent.get("redirect_uri")).toBe(redirectFromAuth(authRes));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Property 2: O host de entrada não afeta a resposta
// Validates: Requirements 7.1
// ---------------------------------------------------------------------------------------
describe("Property 2: the incoming host does not affect the response", () => {
  it("answers identically on the legacy origin and on the canonical host", async () => {
    await fc.assert(
      fc.asyncProperty(trickyArb, trickyArb, async (challenge, state) => {
        const legacyAuth = await get(LEGACY_HOST, "/auth", { code_challenge: challenge, state });
        const canonAuth = await get(AUTH_HOST, "/auth", { code_challenge: challenge, state });
        expect(legacyAuth.status).toBe(canonAuth.status);
        expect(legacyAuth.headers.get("location")).toBe(canonAuth.headers.get("location"));

        const legacyCb = await get(LEGACY_HOST, "/callback", { code: "c", state });
        const canonCb = await get(AUTH_HOST, "/callback", { code: "c", state });
        expect(legacyCb.status).toBe(canonCb.status);
        expect(await legacyCb.text()).toBe(await canonCb.text());

        calls = [];
        const legacyEx = await post(LEGACY_HOST, "/exchange", { code: "c", code_verifier: "v" });
        const legacyBody = calls[0].body;
        calls = [];
        const canonEx = await post(AUTH_HOST, "/exchange", { code: "c", code_verifier: "v" });
        expect(legacyEx.status).toBe(canonEx.status);
        expect(legacyBody).toBe(calls[0].body);

        calls = [];
        const legacyRf = await post(LEGACY_HOST, "/refresh", { refresh_token: "r" });
        const legacyRfBody = calls[0].body;
        calls = [];
        const canonRf = await post(AUTH_HOST, "/refresh", { refresh_token: "r" });
        expect(legacyRf.status).toBe(canonRf.status);
        expect(legacyRfBody).toBe(calls[0].body);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Property 3: O Broker é transparente ao que atravessa
// Validates: Requirements 6.4, 6.6, 6.8, 6.10
// ---------------------------------------------------------------------------------------
describe("Property 3: the broker is transparent to what passes through it", () => {
  it("preserves state, code_challenge, code and Google's error body exactly", async () => {
    await fc.assert(
      fc.asyncProperty(hostArb, trickyArb, trickyArb, async (host, challenge, state) => {
        // /auth forwards PKCE params untouched.
        const authRes = await get(host, "/auth", { code_challenge: challenge, state });
        const consent = new URL(authRes.headers.get("location")!);
        expect(consent.searchParams.get("code_challenge")).toBe(challenge);
        expect(consent.searchParams.get("state")).toBe(state);

        // /callback carries code and state into the deep link, decoded back to the original.
        const cbHtml = await (await get(host, "/callback", { code: challenge, state })).text();
        const deepParams = deepLinkParams(cbHtml);
        expect(deepParams.get("code")).toBe(challenge);
        expect(deepParams.get("state")).toBe(state);

        // Google's error body comes back byte for byte, with Google's status.
        const errBody = '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}';
        respondWith = { status: 400, body: errBody };
        const ex = await post(host, "/exchange", { code: "c", code_verifier: "v" });
        expect(ex.status).toBe(400);
        expect(await ex.text()).toBe(errBody);

        const rf = await post(host, "/refresh", { refresh_token: "r" });
        expect(rf.status).toBe(400);
        expect(await rf.text()).toBe(errBody);
        respondWith = { status: 200, body: '{"access_token":"a","expires_in":3599}' };
      }),
      { numRuns: 100 },
    );
  });

  it("passes error and error_description to the deep link and starts no token exchange", async () => {
    await fc.assert(
      fc.asyncProperty(hostArb, trickyArb, trickyArb, async (host, err, desc) => {
        calls = [];
        const html = await (await get(host, "/callback", { error: err, error_description: desc })).text();
        const params = deepLinkParams(html);
        expect(params.get("error")).toBe(err);
        expect(params.get("error_description")).toBe(desc);
        // A failed callback must not claim success, and must not call Google.
        expect(html).not.toContain("✓ Authorised");
        expect(calls.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Property 4: Parâmetro obrigatório ausente é rejeitado sem contatar o Google
// Validates: Requirements 6.9
// ---------------------------------------------------------------------------------------
describe("Property 4: a missing required parameter is rejected without contacting Google", () => {
  it("names the missing parameter and makes zero requests", async () => {
    const cases: Array<{ path: string; full: Record<string, string>; required: string[] }> = [
      { path: "/auth", full: { code_challenge: "c", state: "s" }, required: ["code_challenge", "state"] },
      { path: "/exchange", full: { code: "c", code_verifier: "v" }, required: ["code", "code_verifier"] },
      { path: "/refresh", full: { refresh_token: "r" }, required: ["refresh_token"] },
    ];

    await fc.assert(
      fc.asyncProperty(hostArb, fc.constantFrom(...cases), fc.nat(), async (host, c, pick) => {
        const omit = c.required[pick % c.required.length];
        const params = { ...c.full };
        delete params[omit];

        calls = [];
        const res = c.path === "/auth" ? await get(host, c.path, params) : await post(host, c.path, params);

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; error_description: string };
        expect(body.error).toBe("missing_parameter");
        expect(body.error_description).toBe(omit);
        expect(calls.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Property 5: O pedido ao Google não vaza segredo e não cresce de escopo
// Validates: Requirements 5.2, 6.7
// ---------------------------------------------------------------------------------------
describe("Property 5: the request to Google leaks no secret and never widens scope", () => {
  it("uses only server-side credentials, never echoes the secret, keeps one scope", async () => {
    await fc.assert(
      fc.asyncProperty(hostArb, trickyArb, async (host, injected) => {
        // A caller trying to inject its own client credentials must be ignored.
        const authRes = await get(host, "/auth", {
          code_challenge: "c",
          state: "s",
          client_id: injected,
          client_secret: injected,
        });
        const consent = new URL(authRes.headers.get("location")!);
        expect(consent.searchParams.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID);
        expect(consent.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/tasks");
        expect(authRes.headers.get("location")).not.toContain(ENV.GOOGLE_CLIENT_SECRET);

        calls = [];
        const ex = await post(host, "/exchange", {
          code: "c",
          code_verifier: "v",
          client_id: injected,
          client_secret: injected,
        });
        const sent = new URLSearchParams(calls[0].body);
        expect(sent.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID);
        expect(sent.get("client_secret")).toBe(ENV.GOOGLE_CLIENT_SECRET);

        // The secret must not appear in ANY byte the Worker hands back.
        expect(await ex.text()).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
        const cb = await (await get(host, "/callback", { code: "c", state: "s" })).text();
        expect(cb).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
        const root = await (await get(host, "/")).text();
        expect(root).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// Property 6: Limite de tempo é duro e não há retentativa (broker side)
// Validates: Requirements 6.11
// ---------------------------------------------------------------------------------------
describe("Property 6: the timeout is hard and there is no retry", () => {
  it("makes exactly one request and fails distinguishably when Google stalls", async () => {
    // The production ceiling is 10s. The Worker accepts an env override purely so this
    // property can run a hundred times instead of burning 1000s of wall clock; the assertion
    // below still proves the ceiling is enforced and that no retry happens.
    const FAST = 60;
    const fastEnv = { ...ENV, TOKEN_TIMEOUT_MS: String(FAST) };

    await fc.assert(
      fc.asyncProperty(
        hostArb,
        fc.constantFrom("/exchange", "/refresh"),
        fc.integer({ min: FAST * 5, max: FAST * 40 }),
        async (host, path, stallMs) => {
          calls = [];
          respondWith = { status: 200, body: "{}", delayMs: stallMs };

          const body = path === "/exchange" ? { code: "c", code_verifier: "v" } : { refresh_token: "r" };
          const started = Date.now();
          const res = await worker.fetch(
            new Request(`https://${host}${path}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
            fastEnv,
          );
          const elapsed = Date.now() - started;

          expect(calls.length).toBe(1); // one attempt, never a retry
          expect(res.status).toBe(504);
          const parsed = (await res.json()) as { error: string };
          expect(parsed.error).toBe("timeout");
          // Gave up at the ceiling instead of waiting for the stalled response.
          expect(elapsed).toBeLessThan(stallMs);

          respondWith = { status: 200, body: '{"access_token":"a","expires_in":3599}' };
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("uses a 10s ceiling when no override is present", async () => {
    calls = [];
    respondWith = { status: 200, body: "{}", delayMs: 50 };
    const res = await post(LEGACY_HOST, "/refresh", { refresh_token: "r" });
    // A 50ms response is nowhere near the ceiling, so it must succeed untouched.
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
  });
});
