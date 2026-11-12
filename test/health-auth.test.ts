import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setRequestUrl, resetRequestUrl, type StubRequest } from "obsidian";
import {
  authorizeHealth, completeHealthAuth, refreshHealthToken, revokeHealthToken, buildHealthAuthUrl,
  grantedHealthScopes, isPlausibleClientId, HealthAuthExpiredError, HealthClientError, HEALTH_SCOPES,
  type HealthToken,
} from "../src/healthAuth";
import { HEALTH_REDIRECT_URI } from "../src/healthdomain";

// Google Health login (bring-your-own client): the plugin talks to Google DIRECTLY with the
// user's own client; the relay only bounces the code. These tests pin the contract.

const CLIENT = { clientId: "1234-abcdef.apps.googleusercontent.com", clientSecret: "GOCSPX-secret" };
const body = (r: StubRequest) => new URLSearchParams(r.body ?? "");

beforeEach(() => { (globalThis as unknown as { window: unknown }).window = globalThis; });
afterEach(() => { resetRequestUrl(); });

/** Start authorizeHealth and capture the consent URL it opens. */
async function start() {
  let opened = "";
  const p = authorizeHealth(CLIENT, (u) => { opened = u; });
  // The consent URL is opened after an async SHA-256 (PKCE); wait for it rather than one tick.
  for (let i = 0; i < 200 && !opened; i++) await new Promise((r) => setTimeout(r, 5));
  const url = new URL(opened);
  return { p, url, state: url.searchParams.get("state") ?? "" };
}

describe("consent URL", () => {
  it("uses the user's client, the relay redirect, PKCE, offline access and only read-only scopes", () => {
    const u = new URL(buildHealthAuthUrl(CLIENT.clientId, "chal", "st"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(u.searchParams.get("redirect_uri")).toBe(HEALTH_REDIRECT_URI);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    const scopes = (u.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toEqual([...HEALTH_SCOPES]);
    expect(scopes.every((s) => s.startsWith("https://www.googleapis.com/auth/googlehealth.") && s.endsWith(".readonly"))).toBe(true);
    expect(u.toString()).not.toContain(CLIENT.clientSecret);
  });

  it("rejects an obviously wrong client ID or an empty secret before opening Google", async () => {
    expect(isPlausibleClientId(" 1234-abc.apps.googleusercontent.com ")).toBe(true);
    expect(isPlausibleClientId("GOCSPX-oops")).toBe(false);
    await expect(authorizeHealth({ clientId: "nope", clientSecret: "x" }, () => {})).rejects.toBeInstanceOf(HealthClientError);
    await expect(authorizeHealth({ clientId: CLIENT.clientId, clientSecret: "  " }, () => {})).rejects.toBeInstanceOf(HealthClientError);
  });
});

describe("code exchange", () => {
  it("exchanges the code with Google directly, using the verifier and the same redirect", async () => {
    const calls: StubRequest[] = [];
    setRequestUrl(async (r) => {
      calls.push(r);
      return { status: 200, text: "", json: { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: HEALTH_SCOPES.join(" ") } };
    });
    const { p, state, url } = await start();
    await completeHealthAuth({ code: "4/code", state });
    const tok = await p;
    expect(tok).toMatchObject({ access_token: "at", refresh_token: "rt" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].throw).toBe(false);
    const b = body(calls[0]);
    expect(b.get("grant_type")).toBe("authorization_code");
    expect(b.get("client_id")).toBe(CLIENT.clientId);
    expect(b.get("client_secret")).toBe(CLIENT.clientSecret);
    expect(b.get("redirect_uri")).toBe(HEALTH_REDIRECT_URI);
    expect(b.get("code_verifier")?.length).toBeGreaterThan(40);
    expect(url.searchParams.get("code_challenge")).not.toBe(b.get("code_verifier")); // S256, not plain
  });

  it("refuses a callback whose state doesn't match", async () => {
    setRequestUrl(async () => { throw new Error("must not call Google"); });
    const { p } = await start();
    await completeHealthAuth({ code: "4/code", state: "forged" });
    await expect(p).rejects.toThrow(/State mismatch/);
  });

  it("turns Google's invalid_client into an actionable client error", async () => {
    setRequestUrl(async () => ({ status: 401, text: JSON.stringify({ error: "invalid_client", error_description: "Unauthorized" }) }));
    const { p, state } = await start();
    await completeHealthAuth({ code: "4/code", state });
    await expect(p).rejects.toBeInstanceOf(HealthClientError);
  });

  it("surfaces a Google error from the callback (e.g. the user said no)", async () => {
    const { p, state } = await start();
    await completeHealthAuth({ error: "access_denied", state });
    await expect(p).rejects.toThrow(/access_denied/);
  });
});

describe("refresh, scopes and revoke", () => {
  const tok: HealthToken = { access_token: "old", refresh_token: "rt", expires_at: 0, scope: HEALTH_SCOPES[0] };

  it("refreshes with the user's client and keeps the refresh token", async () => {
    let seen: URLSearchParams | null = null;
    setRequestUrl(async (r) => { seen = body(r); return { status: 200, text: "", json: { access_token: "new", expires_in: 3600 } }; });
    const fresh = await refreshHealthToken(tok, CLIENT);
    expect(fresh).toMatchObject({ access_token: "new", refresh_token: "rt", scope: HEALTH_SCOPES[0] });
    expect(seen!.get("grant_type")).toBe("refresh_token");
    expect(seen!.get("client_secret")).toBe(CLIENT.clientSecret);
  });

  it("invalid_grant → HealthAuthExpiredError (reconnect)", async () => {
    setRequestUrl(async () => ({ status: 400, text: JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) }));
    await expect(refreshHealthToken(tok, CLIENT)).rejects.toBeInstanceOf(HealthAuthExpiredError);
  });

  it("reports which data types were actually granted", () => {
    expect(grantedHealthScopes(tok)).toEqual([HEALTH_SCOPES[0]]);
    expect(grantedHealthScopes({ ...tok, scope: undefined })).toHaveLength(HEALTH_SCOPES.length);
  });

  it("revoke treats an already-gone token as success", async () => {
    setRequestUrl(async () => ({ status: 400, text: JSON.stringify({ error: "invalid_token" }) }));
    expect(await revokeHealthToken(tok)).toEqual({ ok: true });
  });
});
