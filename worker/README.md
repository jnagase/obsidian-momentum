# Momentum Life — Google OAuth broker (Cloudflare Worker)

Keeps the Google `client_id` / `client_secret` **server-side** so the plugin ships no
secret. Works on desktop and mobile (deep-links back to Obsidian via `obsidian://`).

## Deploy

```bash
cd worker
npx wrangler login                             # once, opens the browser to authorize
npx wrangler deploy                            # creates the Worker + prints its URL
npx wrangler secret put GOOGLE_CLIENT_ID       # paste the client id, press Enter
npx wrangler secret put GOOGLE_CLIENT_SECRET   # paste the GOCSPX-... secret, press Enter
```

Deploy first — `wrangler secret put` needs the Worker to already exist. Secrets apply
live (no redeploy needed). `deploy` prints the URL, e.g.
`https://momentum-google.<your-subdomain>.workers.dev`.

## Google Cloud (one-time)

In the existing **Web application** OAuth client (APIs & Services → Credentials):
- **Authorized redirect URIs** → add: `https://momentum-google.<your-subdomain>.workers.dev/callback`

## Wire the plugin

Set `WORKER_BASE` in `src/googletasks.ts` to the deployed URL (no trailing slash), then
rebuild the plugin.

## Endpoints
- `GET /auth?code_challenge&state` → 302 to Google consent.
- `GET /callback?code&state` → HTML deep-link to `obsidian://momentum-google`.
- `POST /exchange {code, code_verifier}` → `{ access_token, refresh_token, expires_in }`.
- `POST /refresh {refresh_token}` → `{ access_token, expires_in }`.

No secret is ever returned to the client.
