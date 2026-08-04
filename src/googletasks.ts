import { requestUrl } from "obsidian";

const CLIENT_ID     = "524212077991-8btbj3o6upv5oq2o31vbfvkpghginph5.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const CALLBACK_PORT = 42813;
const REDIRECT_URI_DESKTOP = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const REDIRECT_URI_MOBILE  = "obsidian://google-tasks-callback";
const SCOPES = ["https://www.googleapis.com/auth/tasks"];
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT  = "https://accounts.google.com/o/oauth2/v2/auth";

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

let _oauthServer: import("http").Server | null = null;

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

export async function authorizeGoogle(
  isMobile: boolean,
  onOpenUrl: (url: string) => void,
  onLog?: (msg: string) => void,
): Promise<GoogleToken> {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const redirectUri = isMobile ? REDIRECT_URI_MOBILE : REDIRECT_URI_DESKTOP;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

  if (isMobile) {
    onOpenUrl(authUrl);
    throw new Error("MOBILE_PENDING");
  }

  if (_oauthServer) { try { _oauthServer.close(); } catch { /* ignore */ } _oauthServer = null; }
  return new Promise((resolve, reject) => {
    const http = window.require("http") as typeof import("http");
    const server = http.createServer((req, res) => {
      void (async () => {
        try {
          if (!req.url?.startsWith("/callback")) {
            res.writeHead(204); res.end(); return;
          }
          onLog?.(`Callback: ${req.url?.slice(0, 120)}`);
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const code = url.searchParams.get("code");
          if (!code) {
            onLog?.("ERROR: no code in callback");
            res.writeHead(400); res.end("Missing code.");
            server.close(); _oauthServer = null;
            reject(new Error("OAuth callback missing code.")); return;
          }
          onLog?.(`Code OK (${code.length} chars). Exchanging…`);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorised! You can close this tab.</h2></body></html>");
          server.close(); _oauthServer = null;
          const token = await exchangeCode(code, verifier, redirectUri, onLog);
          resolve(token);
        } catch (e) {
          onLog?.(`ERROR in callback: ${e instanceof Error ? e.message : String(e)}`);
          server.close(); _oauthServer = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    });
    _oauthServer = server;
    server.on("error", (err: Error) => { onLog?.(`Server error: ${err.message}`); _oauthServer = null; reject(err); });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => { onLog?.(`Listening on :${CALLBACK_PORT}`); onOpenUrl(authUrl); });
    window.setTimeout(() => { server.close(); _oauthServer = null; reject(new Error("OAuth timeout.")); }, 5 * 60 * 1000);
  });
}

async function exchangeCode(code: string, verifier: string, redirectUri: string, onLog?: (msg: string) => void): Promise<GoogleToken> {
  const body = new URLSearchParams({
    code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code", code_verifier: verifier,
  });
  onLog?.(`Calling token endpoint…`);
  const r = await requestUrl({ url: TOKEN_ENDPOINT, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  onLog?.(`Token endpoint status: ${r.status}`);
  if (r.status >= 400) throw new Error(`Token exchange failed: ${r.status} ${r.text}`);
  const j = r.json as { access_token: string; refresh_token: string; expires_in: number };
  onLog?.(`Token OK, fetching email…`);
  const email = await fetchEmail(j.access_token);
  onLog?.(`Email: ${email}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in - 60) * 1000, email };
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const r = await requestUrl({ url: "https://www.googleapis.com/oauth2/v3/userinfo",
      headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status >= 400) return "";
    const j = r.json as { email?: string };
    return j.email ?? "";
  } catch { return ""; }
}

export async function refreshToken(token: GoogleToken): Promise<GoogleToken> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: token.refresh_token });
  const r = await requestUrl({ url: TOKEN_ENDPOINT, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (r.status >= 400) throw new Error(`Token refresh failed: ${r.status}`);
  const j = r.json as { access_token: string; expires_in: number };
  return { ...token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
}

export async function ensureFreshToken(token: GoogleToken): Promise<GoogleToken> {
  if (Date.now() < token.expires_at) return token;
  return refreshToken(token);
}

const BASE = "https://tasks.googleapis.com/tasks/v1";

async function get<T>(path: string, token: string): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, headers: { Authorization: `Bearer ${token}` } });
  if (r.status >= 400) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json as T;
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error(`POST ${path} failed: ${r.status}`);
  return r.json as T;
}

async function patch<T>(path: string, token: string, body: unknown): Promise<T> {
  const r = await requestUrl({ url: `${BASE}${path}`, method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  if (r.status >= 400) throw new Error(`PATCH ${path} failed: ${r.status}`);
  return r.json as T;
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
  const r = await requestUrl({ url: `${BASE}/lists/${listId}/tasks/${taskId}`, method: "DELETE",
    headers: { Authorization: `Bearer ${token}` } });
  if (r.status >= 400 && r.status !== 404) throw new Error(`DELETE task failed: ${r.status}`);
}

export async function deleteTaskList(token: string, listId: string): Promise<void> {
  const r = await requestUrl({ url: `${BASE}/users/@me/lists/${listId}`, method: "DELETE",
    headers: { Authorization: `Bearer ${token}` } });
  if (r.status >= 400 && r.status !== 404) throw new Error(`DELETE list failed: ${r.status}`);
}
