import { requestUrl } from "obsidian";
import type { GoogleToken } from "./googletasks";
import { DRIVE_WORKER_BASE } from "./drivedomain";

// ── Google Drive OAuth — FULLY ISOLATED from the Tasks OAuth ───────────────────────────────
//
// This mirrors the mechanics of googletasks.ts (PKCE via a Cloudflare Worker broker that holds
// the client secret server-side) but for a SEPARATE broker, a SEPARATE Google OAuth client, a
// SEPARATE deep-link, and a SEPARATE token. Nothing here touches the Tasks flow: that isolation
// is the whole point (the 0.7.2 incident was Drive widening the shared Tasks worker's scope).
//
// Kept as its own module — rather than parameterizing googletasks.ts — deliberately: the Tasks
// flow is verified and in production, so we accept a little duplication for zero risk to it.

/** Base URL of the Drive OAuth broker (momentum-google-drive worker), derived from
 *  drive-domain.json — the same file worker-drive/src/config.js reads, so they can't drift. */
export { DRIVE_WORKER_BASE };

/** Obsidian protocol action the Drive broker deep-links back to: obsidian://momentum-drive.
 *  Distinct from Tasks' momentum-google so the callbacks never cross. */
export const DRIVE_PROTOCOL_ACTION = "momentum-drive";

/** Google's token revocation endpoint (needs the token only, no client credentials). */
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";

// ── PKCE helpers (duplicated from googletasks.ts on purpose, to keep this module standalone) ──
function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array.buffer);
}
async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64URLEncode(hash);
}
function generateState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return base64URLEncode(arr.buffer);
}

/** Pull Google's `error`/`error_description` out of a failed response body, for logs. */
function googleError(text: string): string {
  if (!text) return "";
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    const code = typeof j.error === "string" ? j.error : j.error?.message;
    return [code, j.error_description].filter(Boolean).join(": ") || text.slice(0, 200);
  } catch { return text.slice(0, 200); }
}

/** Thrown when Google refuses the stored Drive refresh token (`invalid_grant`): the grant was
 *  revoked or aged out, so the user must reconnect Drive. Separate from the Tasks error so a
 *  Drive expiry can never be mistaken for a Tasks one. */
export class DriveAuthExpiredError extends Error {
  constructor(detail?: string) {
    super(`Google Drive session expired — reconnect Google Drive in settings.${detail ? ` (${detail})` : ""}`);
    this.name = "DriveAuthExpiredError";
  }
}

interface PendingDriveAuth {
  verifier: string;
  state: string;
  timer: number;
  resolve: (t: GoogleToken) => void;
  reject: (e: Error) => void;
}
/** In-flight Drive authorization, resolved when the broker deep-links back into Obsidian.
 *  Separate from the Tasks pendingAuth so the two flows never interfere. */
let pendingDriveAuth: PendingDriveAuth | null = null;

/**
 * Start Drive authorization: open the broker's /auth URL (which redirects to Google's consent)
 * and resolve once the broker deep-links obsidian://momentum-drive and `completeDriveAuth` runs.
 * Same path on desktop and mobile — no local server, no secret in the plugin.
 */
export async function authorizeDrive(
  onOpenUrl: (url: string) => void,
  onLog?: (msg: string) => void,
): Promise<GoogleToken> {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const authUrl = `${DRIVE_WORKER_BASE}/auth?code_challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`;

  return new Promise<GoogleToken>((resolve, reject) => {
    if (pendingDriveAuth) { window.clearTimeout(pendingDriveAuth.timer); pendingDriveAuth.reject(new Error("Superseded by a new authorization.")); }
    const timer = window.setTimeout(() => {
      if (pendingDriveAuth) { pendingDriveAuth = null; reject(new Error("Drive OAuth timeout — no response within 5 minutes.")); }
    }, 5 * 60 * 1000);
    pendingDriveAuth = { verifier, state, timer, resolve, reject };
    onLog?.(`Opening Drive auth URL: ${authUrl.slice(0, 80)}…`);
    onOpenUrl(authUrl);
  });
}

/**
 * Called by the plugin's obsidian://momentum-drive protocol handler with the params the broker
 * deep-linked back. Validates state, exchanges the code via the broker, and resolves the pending
 * `authorizeDrive` promise. No-op if there is no Drive authorization in flight.
 */
export async function completeDriveAuth(params: Record<string, string>, onLog?: (msg: string) => void): Promise<void> {
  if (!pendingDriveAuth) { onLog?.("Drive protocol callback with no pending auth — ignored."); return; }
  const { verifier, state, timer, resolve, reject } = pendingDriveAuth;
  pendingDriveAuth = null;
  window.clearTimeout(timer);
  try {
    if (params.error) throw new Error(`Google returned: ${params.error}`);
    if (params.state && params.state !== state) throw new Error("State mismatch — ignoring callback.");
    const code = params.code;
    if (!code) throw new Error("Callback missing code.");
    onLog?.(`Drive code received (${code.length} chars). Exchanging via broker…`);
    const r = await requestUrl({
      url: `${DRIVE_WORKER_BASE}/exchange`, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier }),
      throw: false,
    });
    if (r.status >= 400) throw new Error(`Drive token exchange failed: ${r.status}${fmtErr(r.text)}`);
    const j = r.json as { access_token: string; refresh_token: string; expires_in: number };
    onLog?.("Drive token OK.");
    resolve({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  } catch (e) {
    onLog?.(`ERROR completing Drive auth: ${e instanceof Error ? e.message : String(e)}`);
    reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Refresh a Drive access token via the broker. Throws DriveAuthExpiredError on invalid_grant. */
export async function refreshDriveToken(token: GoogleToken): Promise<GoogleToken> {
  const r = await requestUrl({
    url: `${DRIVE_WORKER_BASE}/refresh`, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token.refresh_token }), throw: false,
  });
  if (r.status >= 400) {
    const err = googleError(r.text);
    if (err.includes("invalid_grant")) throw new DriveAuthExpiredError(err);
    throw new Error(`Drive token refresh failed: ${r.status}${err ? ` — ${err}` : ""}`);
  }
  const j = r.json as { access_token: string; expires_in: number };
  return { ...token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
}

/** Return a valid Drive access token, refreshing it through the broker when expired. */
export async function ensureFreshDriveToken(token: GoogleToken): Promise<GoogleToken> {
  if (Date.now() < token.expires_at) return token;
  return refreshDriveToken(token);
}

/**
 * Ask Google to revoke the Drive grant. ONE attempt, no retry; the local Drive token is dropped
 * by the caller either way (a user who clicked "disconnect Drive" ends up disconnected even if
 * Google is unreachable). Never touches the Tasks token.
 */
export async function revokeDriveToken(token: GoogleToken): Promise<{ ok: boolean; detail?: string }> {
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

/** Google's error message, prefixed for appending to a thrown message. */
function fmtErr(text: string): string {
  const e = googleError(text);
  return e ? ` — ${e}` : "";
}
