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
 *
 * THE REDIRECT IS CANONICAL, NOT PER-HOST.
 * This Worker answers on two hostnames: the legacy workers.dev subdomain (compiled into every
 * plugin release published so far) and the custom domain. The redirect_uri sent to Google is
 * ALWAYS CANONICAL_REDIRECT_URI, whichever hostname the request arrived on.
 *
 * That single decision is what makes the domain migration invisible to users: the plugin never
 * chooses the redirect_uri, the Worker does. So an old install calling the legacy hostname
 * still produces a consent URL pointing at the custom domain, and only that one URI needs to
 * be registered in the Google Cloud OAuth client. Deriving it from the request host (the
 * previous behaviour) would have forced the workers.dev callback to stay registered — and
 * Google rejects shared public suffixes like workers.dev in "Authorized domains".
 *
 * /auth and /exchange MUST send the identical string. Google compares them and answers
 * redirect_uri_mismatch on any difference. /refresh carries no redirect_uri at all, which is
 * why refresh tokens issued before the migration keep working.
 */

import { CANONICAL_REDIRECT_URI } from "./config.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/tasks";
const OBSIDIAN_ACTION = "obsidian://momentum-google";

/**
 * Hard ceiling for a Google token call. No retry: a retry would only multiply a real failure
 * and delay the answer the user is waiting on.
 *
 * Overridable through env solely so the property test can exercise the timeout path a hundred
 * times without burning 10s of wall clock per run. Never set in production.
 */
const TOKEN_TIMEOUT_MS = 10_000;
const timeoutMs = (env) => Number(env?.TOKEN_TIMEOUT_MS) || TOKEN_TIMEOUT_MS;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** Names a missing required parameter, without ever reaching Google. */
const missing = (name) => json({ error: "missing_parameter", error_description: name }, 400);

/**
 * Calls Google's token endpoint and hands the response back UNTOUCHED.
 *
 * The passthrough is an invariant, not a convenience: the plugin's googleError() reads `error`
 * and `error_description` out of this body, and refreshToken() decides GoogleAuthExpiredError
 * from the presence of `invalid_grant`. Wrapping or rewriting the body would silently break
 * expired-session detection and send the user back to a generic "sync failed".
 */
async function callGoogleToken(params, env) {
  const limit = timeoutMs(env);
  let r;
  try {
    r = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(limit),
    });
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return json(
      timedOut
        ? { error: "timeout", error_description: `Google did not respond within ${limit / 1000}s` }
        : { error: "network_error", error_description: "Could not reach Google's token endpoint" },
      504,
    );
  }
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    // 1) Build Google's consent URL (client_id lives here, not in the plugin).
    if (url.pathname === "/auth") {
      const codeChallenge = url.searchParams.get("code_challenge");
      const state = url.searchParams.get("state");
      // Reject early instead of forwarding an empty challenge to Google, which would answer
      // with an opaque error the user cannot act on.
      if (!codeChallenge) return missing("code_challenge");
      if (!state) return missing("state");
      const p = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: CANONICAL_REDIRECT_URI,
        response_type: "code",
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
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
      const errDesc = url.searchParams.get("error_description") || "";
      const failed = !code || !!err;

      // Carry error_description through too: without it the plugin's auth log records that
      // something failed but not what, which is exactly the blind spot we removed.
      const deep = `${OBSIDIAN_ACTION}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` +
        `&error=${encodeURIComponent(err)}&error_description=${encodeURIComponent(errDesc)}`;

      // The automatic hop keeps the script-based location.replace that has been carrying this
      // flow in production. A custom-scheme deep link (obsidian://) is handled inconsistently
      // by meta refresh across browsers, so this is deliberately NOT "modernised" — the
      // manual link is the fallback when the browser blocks the automatic redirect.
      // On failure there is no automatic hop: the tab stays put and shows what Google said.
      const heading = failed ? "Authorisation failed" : "✓ Authorised";
      const message = failed
        ? `Google reported: ${escapeHtml(err || "no authorization code")}. Close this tab and try connecting again in Obsidian.`
        : "Returning to Obsidian…";
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Momentum Life</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${failed ? "" : `<script>setTimeout(function(){location.replace(${JSON.stringify(deep)});},300);</script>`}
</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;color:#333">
<h2>${heading}</h2><p>${message}</p>
<p><a href="${escapeHtml(deep)}">Tap here to return to Obsidian</a></p>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 3) Exchange the auth code for tokens (Worker adds the secret).
    if (url.pathname === "/exchange" && request.method === "POST") {
      const { code, code_verifier } = await request.json().catch(() => ({}));
      if (!code) return missing("code");
      if (!code_verifier) return missing("code_verifier");
      // Same canonical value /auth sent, or Google answers redirect_uri_mismatch.
      return callGoogleToken({
        code,
        code_verifier,
        redirect_uri: CANONICAL_REDIRECT_URI,
        grant_type: "authorization_code",
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }, env);
    }

    // 4) Refresh an access token (Worker adds the secret). No redirect_uri in this grant.
    if (url.pathname === "/refresh" && request.method === "POST") {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return missing("refresh_token");
      return callGoogleToken({
        refresh_token,
        grant_type: "refresh_token",
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }, env);
    }

    // Unknown path: neutral text, no echo of any parameter, no call to Google.
    return new Response("Momentum Life OAuth broker", { status: 200 });
  },
};

/** Minimal HTML escaping for values interpolated into the callback page. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
