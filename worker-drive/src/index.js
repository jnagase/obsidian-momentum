/**
 * Momentum Life — Google OAuth broker (Cloudflare Worker).
 *
 * Keeps the Google client_id/secret SERVER-SIDE so nothing secret ships in the plugin.
 * The plugin only knows this Worker's URL. Flow (PKCE, works on desktop AND mobile):
 *
 *   plugin → GET  /auth?code_challenge&state   → 302 to Google's consent screen
 *   Google → GET  /callback?code&state         → HTML that deep-links obsidian://momentum-drive
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
// OAuth scope requested at consent — DRIVE ONLY. This broker is fully isolated from the Tasks
// broker (momentum-google): it must NEVER request the tasks scope, and the Tasks broker must
// never request drive. That isolation is what keeps the verified, in-production Tasks flow
// untouched by anything Drive. FULL drive scope is RESTRICTED and REQUIRES Google's
// restricted-scope verification before public (production) release; local + beta run in the
// Google "Testing" mode of the separate Drive OAuth client. See
// .kiro/specs/google-drive-isolated-rollout/.
const SCOPES = "https://www.googleapis.com/auth/drive";
// Deep-link back into Obsidian — a SEPARATE protocol action from Tasks (momentum-google), so
// the Drive callback is handled by its own protocol handler and never crosses into Tasks.
const OBSIDIAN_ACTION = "obsidian://momentum-drive";

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

    // Public home page — used as the OAuth consent screen's "Application home page". Must live
    // on an authorized domain (this Worker is a subdomain of jnagase.com), which is why it's
    // served here rather than on GitHub.
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HOME_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Public privacy policy — used as the consent screen's "Application privacy policy link".
    // Same authorized-domain reasoning as the home page.
    if (url.pathname === "/privacy" && request.method === "GET") {
      return new Response(PRIVACY_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Unknown path: neutral text, no echo of any parameter, no call to Google.
    return new Response("Momentum Life OAuth broker", { status: 200 });
  },
};

const PAGE_STYLE = "font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;" +
  "padding:2.5rem 1.25rem;color:#1f2328;line-height:1.6";

/** Consent-screen home page. */
const HOME_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Momentum Life — Google Drive sync</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="${PAGE_STYLE}">
<h1>Momentum Life</h1>
<p>Momentum Life is an <a href="https://obsidian.md">Obsidian</a> plugin: an all-in-one life
dashboard for habits, tasks, fitness, nutrition and studies, stored as plain Markdown notes in
your own vault.</p>
<h2>Google Drive sync</h2>
<p>The optional Google Drive feature syncs files two ways between a folder in your Obsidian vault
and a folder in your Google Drive. It uses a Google sign-in that is separate from the plugin's
Google Tasks feature, and it never touches your Tasks data.</p>
<p>Your files sync directly between Google and your device. This site only relays the Google
sign-in — it never stores your files or your Google account data. See our
<a href="/privacy">Privacy Policy</a> for details.</p>
<p>Source code and documentation:
<a href="https://github.com/jnagase/obsidian-momentum">github.com/jnagase/obsidian-momentum</a>.</p>
<p>Contact: <a href="mailto:jaime.nagase@gmail.com">jaime.nagase@gmail.com</a>.</p>
</body></html>`;

/** Consent-screen privacy policy. Kept factually aligned with how the broker actually works
 *  (stateless: no storage binding — see worker-config.test.ts) and with Google's Limited Use
 *  requirements, so it also stands up during restricted-scope verification later. */
const PRIVACY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Momentum Life — Privacy Policy</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="${PAGE_STYLE}">
<h1>Privacy Policy</h1>
<p><em>Last updated: September 2026</em></p>

<p>Momentum Life is an open-source Obsidian plugin. This policy explains how the plugin's
optional Google Drive sync feature handles your data.</p>

<h2>What we access</h2>
<p>With your explicit permission, the plugin requests access to your Google Drive so it can sync
files between a folder in your Google Drive and a folder in your Obsidian vault. You choose which
folders. The plugin's own data folder is always excluded to stay safe.</p>

<h2>How your data flows</h2>
<p>Your Google Drive files are transferred <strong>directly between Google's servers and your own
device</strong>, by the plugin running inside Obsidian. This website
(<code>momentumlife-drive.jnagase.com</code>) acts only as an OAuth broker: it exchanges and
refreshes Google authorization tokens so that the app's credentials never have to ship inside the
plugin.</p>

<h2>What we store</h2>
<p><strong>Nothing.</strong> The broker is stateless: it has no database and persists no data. It
does not store, log, or retain your Google account information, your authorization tokens, your
files, or their contents. No Drive file content ever passes through our servers.</p>

<h2>How we use it</h2>
<p>Access to your Google Drive is used solely to provide the file-sync feature you requested.
Momentum Life's use of information received from Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services
User Data Policy</a>, including the Limited Use requirements. We do not sell your data, use it for
advertising, or share it with third parties.</p>

<h2>Revoking access</h2>
<p>You can disconnect Google Drive from within the plugin's settings at any time, or revoke access
directly at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
Because we store nothing, there is no server-side data to delete.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:jaime.nagase@gmail.com">jaime.nagase@gmail.com</a> or open an
issue at <a href="https://github.com/jnagase/obsidian-momentum">github.com/jnagase/obsidian-momentum</a>.</p>
</body></html>`;

/** Minimal HTML escaping for values interpolated into the callback page. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
