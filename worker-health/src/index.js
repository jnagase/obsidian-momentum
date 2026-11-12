/**
 * Momentum Life — Google Health OAuth RELAY (Cloudflare Worker).
 *
 * Bring-your-own-client model: each user signs in with THEIR OWN Google OAuth client. The plugin
 * builds the consent URL and exchanges the code itself (PKCE + the user's client secret, stored
 * only in their local data.json). Google, however, can only redirect to an https:// address, not
 * to obsidian://, so this Worker does the one thing the plugin can't:
 *
 *   Google → GET /callback?code&state  → HTML that deep-links obsidian://momentum-health
 *
 * That's ALL. This relay:
 *  - holds NO secret and has NO Google client of its own (no env bindings at all);
 *  - never calls Google, never sees a token or the user's client secret;
 *  - only ever sees a one-time authorization code that is useless without the PKCE verifier,
 *    which never leaves the user's device;
 *  - stores nothing (no KV/DB/cache) and logs nothing.
 *
 * It also serves a home page and a privacy policy, which a user's OAuth consent screen may need
 * on an authorized domain.
 */

import { CANONICAL_REDIRECT_URI, RELAY_HOST } from "./config.js";

/** Deep-link back into Obsidian — its own protocol action, never Tasks' or Drive's. */
const OBSIDIAN_ACTION = "obsidian://momentum-health";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    // Google redirects here after consent; bounce the code back into Obsidian.
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const err = url.searchParams.get("error") || "";
      const errDesc = url.searchParams.get("error_description") || "";
      const failed = !code || !!err;

      // error_description travels too, so the plugin's auth log says WHAT Google refused.
      const deep = `${OBSIDIAN_ACTION}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` +
        `&error=${encodeURIComponent(err)}&error_description=${encodeURIComponent(errDesc)}`;

      // Same proven hop as the Tasks/Drive brokers: script location.replace (custom-scheme deep
      // links are handled inconsistently by meta refresh), manual link as the fallback.
      // On failure there is no automatic hop: the tab stays and shows what Google said.
      const heading = failed ? "Authorisation failed" : "✓ Authorised";
      const message = failed
        ? `Google reported: ${escapeHtml(err || "no authorization code")}. Close this tab and try connecting again in Obsidian.`
        : "Returning to Obsidian…";
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Momentum Life</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
${failed ? "" : `<script>setTimeout(function(){location.replace(${JSON.stringify(deep)});},300);</script>`}
</head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:3rem;color:#333">
<h2>${heading}</h2><p>${message}</p>
<p><a href="${escapeHtml(deep)}">Tap here to return to Obsidian</a></p>
</body></html>`;
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // The page carries a one-time code in its URL: never cache it anywhere.
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    if (url.pathname === "/") {
      return new Response(HOME_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/privacy") {
      return new Response(PRIVACY_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Unknown path: neutral text, no echo of any parameter.
    return new Response("Momentum Life Google Health relay", { status: 200 });
  },
};

const PAGE_STYLE = "font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;" +
  "padding:2.5rem 1.25rem;color:#1f2328;line-height:1.6";

const HOME_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Momentum Life — Google Health</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="${PAGE_STYLE}">
<h1>Momentum Life — Google Health</h1>
<p>Momentum Life is an <a href="https://obsidian.md">Obsidian</a> plugin that keeps your habits,
tasks, fitness, nutrition and studies as plain Markdown notes in your own vault.</p>
<p>The optional Google Health feature reads your activity, sleep, heart and body data from your
Google account (for example from a Fitbit or Pixel Watch) and writes it into your Fitness notes.
You connect it with <strong>your own</strong> Google Cloud OAuth client.</p>
<p>This site only relays the sign-in back to Obsidian. Use this address as your client's
authorized redirect URI: <code>${CANONICAL_REDIRECT_URI}</code>.</p>
<p>See the <a href="/privacy">Privacy Policy</a>.</p>
</body></html>`;

const PRIVACY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Momentum Life — Google Health privacy</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="${PAGE_STYLE}">
<h1>Privacy Policy — Google Health</h1>
<p><em>Last updated: November 2026</em></p>
<h2>What is accessed</h2>
<p>With your explicit permission, and using your own Google OAuth client, the plugin reads (never
writes) your Google Health data: activity, sleep, heart and body measurements, nutrition and
workouts. It writes that data into notes in your Obsidian vault.</p>
<h2>How your data flows</h2>
<p>Your health data travels <strong>directly between Google and your device</strong>. This site
(<code>${RELAY_HOST}</code>) only receives the one-time authorization code Google returns after
you sign in, and immediately hands it back to Obsidian. That code cannot be used without a secret
that never leaves your device.</p>
<h2>What is stored</h2>
<p><strong>Nothing.</strong> This relay has no database, keeps no logs of your requests, and never
sees your tokens, your client secret or your health data.</p>
<h2>How it is used</h2>
<p>Only to show your own data in your own vault. Use of information received from Google APIs
adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google
API Services User Data Policy</a>, including the Limited Use requirements. Nothing is sold, used
for advertising or shared.</p>
<h2>Revoking access</h2>
<p>Disconnect in the plugin settings, or revoke at
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
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
