import { requestUrl } from "obsidian";

// OAuth is brokered by a Cloudflare Worker that holds the Google client_id/secret
// server-side — NO secret ships in the plugin. The plugin only talks to the Worker:
//   /auth (build consent URL) · /callback (deep-links back) · /exchange · /refresh.
// Set this to your deployed Worker URL (no trailing slash). See worker/README.md.
const WORKER_BASE = "https://momentum-google.jaime-nagase.workers.dev";
/** Obsidian protocol action the Worker deep-links back to: obsidian://momentum-google */
export const GOOGLE_PROTOCOL_ACTION = "momentum-google";

export interface GoogleToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email?: string;
}

export interface GTTask {
  id?: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  deleted?: boolean;
  etag?: string;
  selfLink?: string;
  updated?: string;
}

export interface GTTaskList {
  id: string;
  title: string;
  etag?: string;
  updated?: string;
}

interface PendingAuth {
  verifier: string;
  state: string;
  timer: number;
  resolve: (t: GoogleToken) => void;
  reject: (e: Error) => void;
}
/** In-flight authorization, resolved when the Worker deep-links back into Obsidian. */
let pendingAuth: PendingAuth | null = null;

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
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(hash);
}

function generateState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return base64URLEncode(arr.buffer);
}

/**
 * Start authorization. Opens the Worker's /auth URL (which redirects to Google's consent)
 * and resolves once the Worker deep-links back into Obsidian and `completeGoogleAuth` runs.
 * Same path on desktop and mobile — no local HTTP server, no secret.
 */
export async function authorizeGoogle(
  onOpenUrl: (url: string) => void,
  onLog?: (msg: string) => void,
): Promise<GoogleToken> {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const authUrl = `${WORKER_BASE}/auth?code_challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`;

  return new Promise<GoogleToken>((resolve, reject) => {
    if (pendingAuth) { window.clearTimeout(pendingAuth.timer); pendingAuth.reject(new Error("Superseded by a new authorization.")); }
    const timer = window.setTimeout(() => {
      if (pendingAuth) { pendingAuth = null; reject(new Error("OAuth timeout — no response within 5 minutes.")); }
    }, 5 * 60 * 1000);
    pendingAuth = { verifier, state, timer, resolve, reject };
    onLog?.(`Opening Worker auth URL: ${authUrl.slice(0, 80)}…`);
    onOpenUrl(authUrl);
  });
}

/**
 * Called by the plugin's obsidian://momentum-google protocol handler with the params the
 * Worker deep-linked back. Validates state, exchanges the code via the Worker, and resolves
 * the pending `authorizeGoogle` promise. No-op if there is no authorization in flight.
 */
export async function completeGoogleAuth(params: Record<string, string>, onLog?: (msg: string) => void): Promise<void> {
  if (!pendingAuth) { onLog?.("Protocol callback with no pending auth — ignored."); return; }
  const { verifier, state, timer, resolve, reject } = pendingAuth;
  pendingAuth = null;
  window.clearTimeout(timer);
  try {
    if (params.error) throw new Error(`Google returned: ${params.error}`);
    if (params.state && params.state !== state) throw new Error("State mismatch — ignoring callback.");
    const code = params.code;
    if (!code) throw new Error("Callback missing code.");
    onLog?.(`Code received (${code.length} chars). Exchanging via Worker…`);
    const r = await requestUrl({
      url: `${WORKER_BASE}/exchange`, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier }),
      throw: false,
    });
    // 401 invalid_client = wrong/stale secret on the Worker; 400 = bad grant/verifier.
    if (r.status >= 400) throw new Error(`Token exchange failed: ${r.status}${fmtErr(r.text)}`);
    const j = r.json as { access_token: string; refresh_token: string; expires_in: number };
    const email = await fetchEmail(j.access_token);
    onLog?.(`Token OK — email: ${email}`);
    resolve({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, email });
  } catch (e) {
    onLog?.(`ERROR completing auth: ${e instanceof Error ? e.message : String(e)}`);
    reject(e instanceof Error ? e : new Error(String(e)));
  }
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const r = await requestUrl({ url: "https://www.googleapis.com/oauth2/v3/userinfo",
      headers: { Authorization: `Bearer ${accessToken}` }, throw: false });
    if (r.status >= 400) return "";
    const j = r.json as { email?: string };
    return j.email ?? "";
  } catch { return ""; }
}

/**
 * Thrown when Google refuses the stored refresh token (`invalid_grant`): the grant was
 * revoked or aged out, so no retry can fix it — the user has to reconnect. Callers use
 * this to show an actionable message instead of a generic "sync failed".
 */
export class GoogleAuthExpiredError extends Error {
  constructor(detail?: string) {
    super(`Google session expired — reconnect Google tasks in settings.${detail ? ` (${detail})` : ""}`);
    this.name = "GoogleAuthExpiredError";
  }
}

export async function refreshToken(token: GoogleToken): Promise<GoogleToken> {
  // `throw: false` is required: requestUrl throws on 4xx by default, which would bypass
  // the checks below and surface an opaque "Request failed, status 400" with no clue that
  // it was the token refresh (and no Google error_description) — that cost us a debug session.
  const r = await requestUrl({ url: `${WORKER_BASE}/refresh`, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token.refresh_token }), throw: false });
  if (r.status >= 400) {
    const err = googleError(r.text);
    // invalid_grant = refresh token revoked/expired. Common cause: the OAuth consent screen
    // is still in "Testing", where Google kills refresh tokens after 7 days.
    if (err.includes("invalid_grant")) throw new GoogleAuthExpiredError(err);
    throw new Error(`Token refresh failed: ${r.status}${err ? ` — ${err}` : ""}`);
  }
  const j = r.json as { access_token: string; expires_in: number };
  return { ...token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
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

export async function ensureFreshToken(token: GoogleToken): Promise<GoogleToken> {
  if (Date.now() < token.expires_at) return token;
  return refreshToken(token);
}

const BASE = "https://tasks.googleapis.com/tasks/v1";

// Every helper below passes `throw: false` on purpose. requestUrl throws on 4xx/5xx by
// default, which made the status checks dead code and reduced every API failure to
// "Request failed, status 400" — no path, no Google message. Keep it.
async function get<T>(path: string, token: string): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400) throw new Error(`GET ${path} failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as T;
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), throw: false });
  if (r.status >= 400) throw new Error(`POST ${path} failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as T;
}

async function patch<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), throw: false });
  if (r.status >= 400) throw new Error(`PATCH ${path} failed: ${r.status}${fmtErr(r.text)}`);
  return r.json as T;
}

/** Google's error message, prefixed for appending to a thrown message. */
function fmtErr(text: string): string {
  const e = googleError(text);
  return e ? ` — ${e}` : "";
}

export async function listTaskLists(token: string): Promise<GTTaskList[]> {
  const r = await get<{ items?: GTTaskList[] }>("/users/@me/lists?maxResults=100", token);
  return r.items ?? [];
}

export async function createTaskList(token: string, title: string): Promise<GTTaskList> {
  return post<GTTaskList>("/users/@me/lists", token, { title });
}

/** The account's built-in default list ("My Tasks"). Always exists; can't be deleted. */
export async function getDefaultTaskList(token: string): Promise<GTTaskList> {
  return get<GTTaskList>("/users/@me/lists/@default", token);
}

export async function listTasks(token: string, listId: string): Promise<GTTask[]> {
  const r = await get<{ items?: GTTask[] }>(
    `/lists/${listId}/tasks?maxResults=100&showCompleted=true&showHidden=true`,
    token,
  );
  return r.items ?? [];
}

export async function createTask(token: string, listId: string, task: GTTask): Promise<GTTask> {
  return post<GTTask>(`/lists/${listId}/tasks`, token, task);
}

export async function updateTask(token: string, listId: string, taskId: string, task: Partial<GTTask>): Promise<GTTask> {
  return patch<GTTask>(`/lists/${listId}/tasks/${taskId}`, token, task);
}

export async function getTask(token: string, listId: string, taskId: string): Promise<GTTask> {
  return get<GTTask>(`/lists/${listId}/tasks/${taskId}`, token);
}

export async function deleteTask(token: string, listId: string, taskId: string): Promise<void> {
  // `throw: false` also keeps the 404 tolerance working — already-gone is success here,
  // but the default throw turned it into a hard error.
  const r = await requestUrl({ url: `${BASE}/lists/${listId}/tasks/${taskId}`, method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400 && r.status !== 404) throw new Error(`DELETE task failed: ${r.status}${fmtErr(r.text)}`);
}

export async function deleteTaskList(token: string, listId: string): Promise<void> {
  const r = await requestUrl({ url: `${BASE}/users/@me/lists/${listId}`, method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }, throw: false });
  if (r.status >= 400 && r.status !== 404) throw new Error(`DELETE list failed: ${r.status}${fmtErr(r.text)}`);
}
