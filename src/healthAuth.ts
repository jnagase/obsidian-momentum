import { requestUrl } from "obsidian";
import type { GoogleToken } from "./googletasks";
import { HEALTH_REDIRECT_URI } from "./healthdomain";

// ── Google Health OAuth — BRING YOUR OWN CLIENT ─────────────────────────────────────────────
//
// Unlike Tasks and Drive, there is no Google client of ours: every Google Health scope is
// RESTRICTED, so an author-owned client would need a paid yearly security audit. Instead each
// user creates their own Google Cloud project + OAuth client (type Web) and pastes its Client ID
// and Client secret into the plugin settings. Consequences that shape this module:
//  - the plugin builds the consent URL and exchanges/refreshes tokens ITSELF, straight against
//    Google (requestUrl isn't subject to CORS), with the user's own credentials;
//  - the only server involved is a stateless relay (worker-health) that bounces the one-time code
//    from https://…/callback to obsidian://momentum-health — it never sees a secret or a token;
//  - PKCE is used on top of the secret, so a code intercepted at the relay is useless.
// Fully separate from googletasks.ts/driveAuth.ts: its own deep-link, pending state and token.

/** Obsidian protocol action the relay deep-links back to: obsidian://momentum-health. */
export const HEALTH_PROTOCOL_ACTION = "momentum-health";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";

/**
 * Every read-only Google Health scope (author decision: read everything, map it into Fitness
 * over time). The user must add the SAME list to their own client's Data access page; a scope the
 * user unticks on the consent screen is simply not granted (see HealthToken.scope).
 */
export const HEALTH_SCOPES: readonly string[] = [
  "activity_and_fitness",
  "health_metrics_and_measurements",
  "sleep",
  "nutrition",
  "location",
  "logged_symptoms",
  "ecg",
  "irn",
].map((s) => `https://www.googleapis.com/auth/googlehealth.${s}.readonly`);

/** A Google Health token. `scope` = the space-separated scopes Google actually granted. */
export interface HealthToken extends GoogleToken {
  scope?: string;
}

/** The user's own OAuth client, as pasted in settings. */
export interface HealthClient {
  clientId: string;
  clientSecret: string;
}

/** Google refused the stored refresh token (`invalid_grant`): revoked or aged out → reconnect. */
export class HealthAuthExpiredError extends Error {
  constructor(detail?: string) {
    super(`Google Health session expired — reconnect it in settings.${detail ? ` (${detail})` : ""}`);
    this.name = "HealthAuthExpiredError";
  }
}

/** Google rejected the Client ID / Client secret the user pasted (`invalid_client`). */
export class HealthClientError extends Error {
  constructor(detail?: string) {
    super(`Google Health: the client ID or client secret was rejected — check them in settings.${detail ? ` (${detail})` : ""}`);
    this.name = "HealthClientError";
  }
}

// ── PKCE helpers (duplicated on purpose so this module stays standalone) ──────────────────
function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function randomUrlSafe(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64URLEncode(arr.buffer);
}
async function codeChallengeOf(verifier: string): Promise<string> {
  return base64URLEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** Pull Google's `error`/`error_description` out of a failed response body, for messages/logs. */
export function googleError(text: string): string {
  if (!text) return "";
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    const code = typeof j.error === "string" ? j.error : j.error?.message;
    return [code, j.error_description].filter(Boolean).join(": ") || text.slice(0, 200);
  } catch { return text.slice(0, 200); }
}

/** Basic shape check of a pasted Client ID, so an obvious typo fails before opening Google. */
export function isPlausibleClientId(id: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id.trim());
}

/** Build Google's consent URL for the user's own client (pure; exported for tests). */
export function buildHealthAuthUrl(clientId: string, challenge: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: HEALTH_REDIRECT_URI,
    response_type: "code",
    scope: HEALTH_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline", // → refresh token
    prompt: "consent",      // → always return a refresh token, even on a re-connect
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH}?${p.toString()}`;
}

interface PendingHealthAuth {
  verifier: string;
  state: string;
  client: HealthClient;
  timer: number;
  resolve: (t: HealthToken) => void;
  reject: (e: Error) => void;
}
/** In-flight authorization, resolved when the relay deep-links back into Obsidian. */
let pending: PendingHealthAuth | null = null;

/**
 * Start authorization: open Google's consent screen (user's client) and resolve once the relay
 * deep-links obsidian://momentum-health and `completeHealthAuth` runs. Same path on desktop and
 * mobile — no local server.
 */
export async function authorizeHealth(
  client: HealthClient,
  onOpenUrl: (url: string) => void,
  onLog?: (msg: string) => void,
): Promise<HealthToken> {
  const clientId = client.clientId.trim();
  const clientSecret = client.clientSecret.trim(); // a pasted trailing space → invalid_client
  if (!isPlausibleClientId(clientId)) {
    throw new HealthClientError("the client ID should look like 1234-abc.apps.googleusercontent.com");
  }
  if (!clientSecret) throw new HealthClientError("the client secret is empty");
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const url = buildHealthAuthUrl(clientId, await codeChallengeOf(verifier), state);

  return new Promise<HealthToken>((resolve, reject) => {
    if (pending) { window.clearTimeout(pending.timer); pending.reject(new Error("Superseded by a new authorization.")); }
    const timer = window.setTimeout(() => {
      if (pending) { pending = null; reject(new Error("Google Health authorization timed out — no response within 5 minutes.")); }
    }, 5 * 60 * 1000);
    pending = { verifier, state, client: { clientId, clientSecret }, timer, resolve, reject };
    onLog?.("Opening Google Health consent screen.");
    onOpenUrl(url);
  });
}

/**
 * Called by the obsidian://momentum-health protocol handler with what the relay deep-linked back.
 * Validates state, exchanges the code with the user's own client, and resolves the pending
 * `authorizeHealth`. No-op if nothing is in flight.
 */
export async function completeHealthAuth(params: Record<string, string>, onLog?: (msg: string) => void): Promise<void> {
  if (!pending) { onLog?.("Health callback with no pending authorization — ignored."); return; }
  const { verifier, state, client, timer, resolve, reject } = pending;
  pending = null;
  window.clearTimeout(timer);
  try {
    if (params.error) throw new Error(`Google returned: ${params.error}${params.error_description ? ` — ${params.error_description}` : ""}`);
    if (params.state !== state) throw new Error("State mismatch — ignoring callback.");
    if (!params.code) throw new Error("Callback missing code.");
    const r = await requestUrl({
      url: GOOGLE_TOKEN, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: params.code,
        code_verifier: verifier,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: HEALTH_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
      throw: false,
    });
    if (r.status >= 400) {
      const err = googleError(r.text);
      if (err.includes("invalid_client") || err.includes("unauthorized_client")) throw new HealthClientError(err);
      throw new Error(`Google Health token exchange failed: ${r.status}${err ? ` — ${err}` : ""}`);
    }
    const j = r.json as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    if (!j.refresh_token) throw new Error("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
    onLog?.("Google Health token OK.");
    resolve({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in - 60) * 1000,
      scope: j.scope,
    });
  } catch (e) {
    onLog?.(`ERROR completing Google Health auth: ${e instanceof Error ? e.message : String(e)}`);
    reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Refresh the access token with the user's own client. Throws HealthAuthExpiredError on invalid_grant. */
export async function refreshHealthToken(token: HealthToken, client: HealthClient): Promise<HealthToken> {
  const r = await requestUrl({
    url: GOOGLE_TOKEN, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token.refresh_token,
      client_id: client.clientId.trim(),
      client_secret: client.clientSecret.trim(),
      grant_type: "refresh_token",
    }).toString(),
    throw: false,
  });
  if (r.status >= 400) {
    const err = googleError(r.text);
    if (err.includes("invalid_grant")) throw new HealthAuthExpiredError(err);
    if (err.includes("invalid_client") || err.includes("unauthorized_client")) throw new HealthClientError(err);
    throw new Error(`Google Health token refresh failed: ${r.status}${err ? ` — ${err}` : ""}`);
  }
  const j = r.json as { access_token: string; expires_in: number; scope?: string };
  return { ...token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope ?? token.scope };
}

/** A valid access token, refreshed when expired. */
export async function ensureFreshHealthToken(token: HealthToken, client: HealthClient): Promise<HealthToken> {
  if (Date.now() < token.expires_at) return token;
  return refreshHealthToken(token, client);
}

/** Which HEALTH_SCOPES the user actually granted (all of them when Google didn't say). */
export function grantedHealthScopes(token: HealthToken): string[] {
  if (!token.scope) return [...HEALTH_SCOPES];
  const got = new Set(token.scope.split(/\s+/));
  return HEALTH_SCOPES.filter((s) => got.has(s));
}

/** Ask Google to revoke the grant. One attempt; the caller drops the local token either way. */
export async function revokeHealthToken(token: HealthToken): Promise<{ ok: boolean; detail?: string }> {
  const value = token.refresh_token || token.access_token;
  if (!value) return { ok: true };
  try {
    const r = await requestUrl({
      url: GOOGLE_REVOKE, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(value)}`, throw: false,
    });
    if (r.status >= 400) {
      const detail = googleError(r.text);
      if (detail.includes("invalid_token")) return { ok: true }; // already gone → goal met
      return { ok: false, detail: `${r.status}${detail ? ` — ${detail}` : ""}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
