/**
 * Momentum Life — Google OAuth broker (Cloudflare Worker).
 *
 * Keeps the Google client_id/secret SERVER-SIDE so nothing secret ships in the plugin.
 * The plugin only knows this Worker's URL. Flow (PKCE, works on desktop AND mobile):
 *
 *   plugin → GET  /auth?code_challenge&state   → 302 to Google's consent screen
 *   Google → GET  /callback?code&state         → HTML that deep-links obsidian://momentum-google
 *   plugin → POST /exchange {code,code_verifier}→ tokens (Worker adds the secret)
 *   plugin → POST /refresh  {refresh_token}     → new access_token (Worker adds the secret)
 *
 * Secrets (set via `wrangler secret put`): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 * The redirect_uri Google sees is always THIS Worker's own /callback (same origin), so it
 * matches on both /auth and /exchange. Register that /callback URL in the Google Cloud
 * OAuth client (Web application type) as an authorized redirect URI.
 */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/tasks";
const OBSIDIAN_ACTION = "obsidian://momentum-google";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirectUri = url.origin + "/callback";

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    // 1) Build Google's consent URL (client_id lives here, not in the plugin).
    if (url.pathname === "/auth") {
      const p = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES,
        code_challenge: url.searchParams.get("code_challenge") || "",
        code_challenge_method: "S256",
        state: url.searchParams.get("state") || "",
        access_type: "offline",
        prompt: "consent",
      });
      return Response.redirect(`${GOOGLE_AUTH}?${p.toString()}`, 302);
    }

    // 2) Google redirects here; bounce the code back into Obsidian via a deep link.
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const err = url.searchParams.get("error") || "";
      const deep = `${OBSIDIAN_ACTION}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&error=${encodeURIComponent(err)}`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Momentum Life</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>setTimeout(function(){location.replace(${JSON.stringify(deep)});},300);</script>
</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#333">
<h2>✓ Authorised</h2><p>Returning to Obsidian…</p>
<p><a href="${deep}">Tap here if it doesn't open automatically</a></p>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 3) Exchange the auth code for tokens (Worker adds the secret).
    if (url.pathname === "/exchange" && request.method === "POST") {
      const { code, code_verifier } = await request.json().catch(() => ({}));
      if (!code || !code_verifier) return json({ error: "missing code or code_verifier" }, 400);
      const body = new URLSearchParams({
        code, code_verifier, redirect_uri: redirectUri, grant_type: "authorization_code",
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      });
      const r = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json", ...CORS } });
    }

    // 4) Refresh an access token (Worker adds the secret).
    if (url.pathname === "/refresh" && request.method === "POST") {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return json({ error: "missing refresh_token" }, 400);
      const body = new URLSearchParams({
        refresh_token, grant_type: "refresh_token",
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      });
      const r = await fetch(GOOGLE_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json", ...CORS } });
    }

    return new Response("Momentum Life OAuth broker", { status: 200 });
  },
};
