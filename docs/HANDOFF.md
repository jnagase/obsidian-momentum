# Momentum Life — Maintainer & Infrastructure Handoff

> One page that explains **everything** needed to run, release, and operate Momentum Life —
> the plugin **and** its cloud services (Cloudflare, Google Cloud, Gumroad). Written so a new
> maintainer (human or AI agent) can pick the project up from the public repo alone.
>
> **No secret values live in this repo.** This document lists secret *names* and *where* they
> live, never their values. See [What is NOT in the repo](#8-what-is-not-in-the-repo-critical).

---

## 0. TL;DR

- **The plugin is 100% local Markdown.** Everything (tasks, habits, fitness, nutrition, studies,
  journal, finances, file manager) works offline forever, with **zero dependency on any server
  or on the maintainer.** Your users' data is theirs, in plain files.
- **Three cloud services power only the optional online features** and are the only things a
  successor must be able to access:
  1. **Cloudflare** — two stateless OAuth "broker" Workers (Google Tasks sync, Google Drive sync).
  2. **Google Cloud** — two OAuth clients (one per broker) + consent screens.
  3. **Gumroad** — sells the one-time **Pro** unlock and exposes the license-verify API.
- **If the maintainer disappears**, the graceful sunset is: set `PRO_BETA_FREE = true` in
  `src/pro.ts`, release once → Pro becomes free for everyone and nothing depends on the cloud
  services. See [§11 Sunset / retirement plan](#11-sunset--retirement-plan).

---

## 1. What this project is

Momentum Life is an Obsidian community plugin: an all-in-one life dashboard stored as plain
Markdown notes in the user's vault. Repo: **`github.com/jnagase/obsidian-momentum`**, branch
**`main`**, license **MIT**.

- Language: TypeScript, bundled to a single `main.js` with esbuild.
- Distribution: the Obsidian community plugin store (managed at **community.obsidian.md**),
  built and released by a GitHub Action on tag push.
- Optional online features (all off by default, all opt-in):
  - **Google Tasks sync** (production, verified, in use by many installs).
  - **Google Drive sync** (beta — text free, binary files are the paid "Pro" feature).
  - **Momentum Pro** — a one-time paid unlock for binary Drive sync, sold via Gumroad.

---

## 2. Repo layout (where things live)

```
src/                     Plugin source (TypeScript)
  main.ts                Plugin entry: settings, commands, Drive sync orchestration, Pro logic
  view.ts / nav.ts       Dashboard ItemView (sidebar + page router)
  data.ts                Data layer over the vault (loadConfig/saveConfig, tasks, app-state…)
  modules/*.ts           One file per dashboard tab (cockpit, tasks, fitness, journal…)
  googletasks.ts         Google Tasks REST + OAuth (talks to the Tasks broker)
  gtSync.ts              Google Tasks 3-way sync engine
  driveAuth.ts           Google Drive OAuth (talks to the Drive broker)
  driveSync.ts           Google Drive 2-way sync engine
  driveBrowser.ts        Drive panel/browser UI + DriveViewConfig
  quickAccess.ts         File Manager tab (storage overview, folders, Drive status card)
  appdomain.ts           Derives WORKER_BASE + redirect URI from app-domain.json
  pro.ts                 Pro licensing: PRO_BETA_FREE, validateLicense(), grace/recheck logic
  foodapi.ts             Open Food Facts client (nutrition search) — carries the USER_AGENT
  whatsnew.ts            CHANGELOG + "What's new" modal
worker/                  Cloudflare Worker: Google TASKS OAuth broker (momentum-google)
worker-drive/            Cloudflare Worker: Google DRIVE OAuth broker (momentum-google-drive)
mcp/                     Node MCP server (a port of the data layer, for tooling — no build)
app-domain.json          Hosts for the TASKS broker + plugin (root/site/auth)
drive-domain.json        Host for the DRIVE broker
pro-config.json          Gumroad buy/verify URLs + product id (no secrets)
manifest.json            Obsidian plugin manifest (id, version, minAppVersion)
versions.json            Plugin version → minAppVersion map (community store needs it)
.github/workflows/release.yml   Tag-push → build → attest → GitHub Release
.kiro/steering/momentum-life.md The living "rules & lessons" doc — READ THIS
.kiro/specs/<feature>/          Design/requirements/tasks for bigger features
docs/                    This file, pro-terms.md, pro-license-setup.md, oauth-verification/
```

**Not in git** (regenerated or machine-local): `node_modules/`, `main.js`, `*.log`,
`.DS_Store`, `reference/` (a local porting copy of a sibling web app), `.kiro/settings/`
(machine/editor + MCP config).

---

## 3. Local development

```bash
git clone https://github.com/jnagase/obsidian-momentum
cd obsidian-momentum
npm install
```

- **Build:** `npm run build` (runs `tsc -noEmit -skipLibCheck` + esbuild → produces `main.js`).
- **Lint:** `npx eslint src --ext .ts`. A pre-existing harmless warning about `ymdLocal` in
  `src/data.ts` is the only acceptable one.
- **Tests:** `npx vitest run` (property + unit tests; must stay green before a release).
- **Deploy to a test vault (local):** copy the three build outputs into the vault's plugin dir:
  ```bash
  cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/momentum-life/"
  ```
  Then reload the plugin in Obsidian (Community plugins → toggle it off/on, or restart Obsidian).
  The original author's test vault was `/Users/jnagase/Documents/obsidian_1/` (data root
  `Momentum Life`) — yours will differ.

**House rules (from steering):** never build without being asked; never edit vault notes with
`sed`/shell (it corrupts them — use file tools or the MCP); no `console.log` (lint blocks it);
prefer Obsidian's `requestUrl` over `fetch`, and pass `throw: false` when you inspect `r.status`.

---

## 4. Release process (ship to users)

A release is triggered by **pushing a git tag**. The GitHub Action (`.github/workflows/release.yml`)
runs `npm ci` → `npm run build` → build-provenance attestation → creates a GitHub Release with
`main.js`, `manifest.json`, `styles.css` attached. The community store picks it up from there.

**Version bump touches 4 files (keep them identical SemVer):**
1. `manifest.json` → `version`
2. `package.json` → `version`
3. `versions.json` → add `"X.Y.Z": "<minAppVersion>"`
4. `src/foodapi.ts` → the `USER_AGENT` string (`Momentum-Obsidian/X.Y.Z …`)

Then:
```bash
npm install --package-lock-only     # keep package-lock in sync (npm ci in CI needs it)
# verify: tsc, eslint, vitest all green
git add manifest.json package.json versions.json package-lock.json src/foodapi.ts src/whatsnew.ts <changed src>
git commit -m 'Release X.Y.Z: ...'   # NO "!" in messages (bash history expansion)
git push origin main
git tag X.Y.Z                         # NO "v" prefix — must equal manifest.json version
git push origin X.Y.Z
```

**After the Action finishes:**
- `gh release view X.Y.Z` — confirm assets attached.
- `gh attestation verify <asset> --repo jnagase/obsidian-momentum` — expect exit 0.
- Confirm the published `main.js` contains **no `child_process`** (the community review flags it).
- Optionally polish notes: `gh release edit X.Y.Z --notes-file <file>`.

**Also on a user-visible release:** add a top entry to `CHANGELOG` in `src/whatsnew.ts` (the
"What's new" modal). The `test/release-coherence.test.ts` enforces that `CHANGELOG[0].version`
equals `manifest.json` version and that the 4 version files agree — so a drift fails tests early.

**Community review gotchas** (the store scans source, not just the bundle): no `child_process`
or shell exec; use `createDiv()`/`createEl()` not `document.createElement`; don't
`eslint-disable` `@typescript-eslint/no-deprecated` (fix the cause); UI text must be sentence case
(`obsidianmd/ui/sentence-case`).

---

## 5. Cloud service A — Cloudflare (two OAuth broker Workers)

Both Workers are **tiny, stateless OAuth brokers**: they hold the Google `client_id`/`client_secret`
server-side so the plugin never ships a secret, and they exchange PKCE auth codes for tokens.
**No storage bindings (KV/D1/R2/DO) — and none may be added** (the privacy policy states the
brokers persist nothing). Each answers on both its `*.workers.dev` hostname (legacy, keep alive
for old installs) and a custom domain.

### 5.1 `worker/` — Tasks broker (production)
- Worker name: **`momentum-google`**
- Custom domain: **`momentumlife-auth.jnagase.com`** (must match `authHost` in `app-domain.json`)
- Legacy host: `…workers.dev` (kept alive — old installs call it; `workers_dev = true`, do not disable)
- OAuth scope requested: **`https://www.googleapis.com/auth/tasks`** (single non-sensitive scope →
  no restricted-scope review needed)
- Endpoints: `/auth` (build consent URL) · `/callback` (deep-links `obsidian://momentum-google`) ·
  `/exchange` · `/refresh`
- Redirect URI it sends Google (fixed constant): `https://momentumlife-auth.jnagase.com/callback`

### 5.2 `worker-drive/` — Drive broker (beta, isolated)
- Worker name: **`momentum-google-drive`**
- Custom domain: **`momentumlife-drive.jnagase.com`** (must match `driveAuthHost` in `drive-domain.json`)
- OAuth scope requested: **`https://www.googleapis.com/auth/drive`** (FULL drive — a **restricted**
  scope; running in Google "Testing" mode for beta; public release needs restricted-scope
  verification — see `.kiro/specs/google-drive-isolated-rollout/`)
- Endpoints: `/auth` · `/callback` (deep-links `obsidian://momentum-drive`) · `/exchange` · `/refresh`
- Redirect URI it sends Google (fixed): `https://momentumlife-drive.jnagase.com/callback`
- **Fully isolated from Tasks:** different Worker, different Google project, different secrets,
  different deep-link. A Drive change must never touch the Tasks flow or its users.

### 5.3 Deploying a Worker
```bash
cd worker          # or: cd worker-drive
npx wrangler login # once per machine (Cloudflare auth)
npx wrangler deploy
```
> **Gotcha:** run `wrangler` **inside** the worker's folder, or it errors "Required Worker name
> missing". The custom domain routing needs `jnagase.com` to be a zone on the same Cloudflare
> account (see [§7 Domains & DNS](#7-domains--dns)).

### 5.4 Setting the secrets (values are NOT in the repo)
Each Worker needs two secrets. The **names are fixed**; the values come from the matching Google
OAuth client (see §6). Set them with the value going into the prompt/stdin, never as an argument:
```bash
cd worker            # Tasks broker — production Google client
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

cd ../worker-drive   # Drive broker — the separate "Obsidian-GDrive" Google client
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```
> **Gotchas that have bitten before:** (a) pasting the *value* where the *name* goes — the name is
> always `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, the value only goes in the prompt; (b) a
> trailing space/newline in the pasted value → Google returns `invalid_client` (HTTP 401) at
> `/exchange`.

---

## 6. Cloud service B — Google Cloud (two OAuth clients)

There are **two separate Google Cloud projects/clients**, one per broker, kept isolated so the
verified production Tasks flow is never disturbed by Drive work.

### 6.1 Production Tasks client
- **Client type:** Web application.
- **Authorized redirect URI (exactly one, verbatim):** `https://momentumlife-auth.jnagase.com/callback`
- **Scope:** Google Tasks only (`.../auth/tasks`) — non-sensitive.
- **Consent screen publishing status: MUST be "In production".**
  - ⚠️ **If it is "Testing", Google revokes every refresh token after 7 days.** Symptom: sync dies
    with `400 invalid_grant` / "Token has been expired or revoked" exactly 7 days after connecting.
    Fix: OAuth consent screen → **Publish app → In production** (no verification required for a
    non-sensitive scope) and reconnect once. **Never switch back to Testing.**
- The `client_secret` was rotated once (an old one leaked in `main.js` of releases ≤0.5.0).
  Target state: exactly **one** active secret in Google Cloud, matching the one in the Tasks Worker.

### 6.2 Drive client ("Obsidian-GDrive")
- **Client type:** Web application, in a **separate** project.
- **Authorized redirect URI (verbatim):** `https://momentumlife-drive.jnagase.com/callback`
- **Scope:** full Drive (`.../auth/drive`) — **restricted**. Runs in **Testing** for beta.
- Public (production) release of Drive sync requires Google's **restricted-scope verification**
  (CASA security assessment etc.). Materials are staged under `docs/oauth-verification/`
  (scope justification, demo video script, submission checklist) and the plan in
  `.kiro/specs/google-oauth-verification/`.

### 6.3 The 100-user cap (unverified apps)
An unverified Google app has a **lifetime cap of 100 authorized accounts, with no reset.** When
hit, new users are blocked (not just warned). The counter is in **Google Auth Platform → Audience**.
Removing the cap + the "unverified" warning requires OAuth verification (see the spec above).

### 6.4 Diagnosing auth errors (quick key)
- `400 invalid_grant` → the user's grant is dead (client & secret are fine). Usually the "Testing
  7-day" issue, or a revoked token. The plugin surfaces this as `GoogleAuthExpiredError` with an
  actionable Notice. Fix: publish to production + reconnect.
- `401 invalid_client` → wrong/garbled `GOOGLE_CLIENT_SECRET` in the Worker. Re-put the secret.
- `redirect_uri_mismatch` → the redirect URI registered on the Google client doesn't match the
  Worker's `CANONICAL_REDIRECT_URI` (derived from `app-domain.json` / `drive-domain.json`).
- Plugin-side auth debug log: `Momentum Life/Config/google-auth-debug.md` in the vault.

---

## 7. Domains & DNS

- Root domain **`jnagase.com`** is a **zone on the maintainer's Cloudflare account.** The custom
  Worker domains are subdomains of it, added as Worker "custom domains" (Cloudflare creates the
  DNS + certificate automatically).
- **First-level subdomains are mandatory:** `momentumlife-auth.jnagase.com`,
  `momentumlife-drive.jnagase.com`, `momentumlife.jnagase.com` (the site/privacy pages).
  Cloudflare **Universal SSL** covers the apex and **one** wildcard level only, so a first-level
  host gets a free cert automatically while `auth.momentumlife.jnagase.com` (second level) would
  not. `src/appdomain.ts` and the worker configs enforce this rule.
- A successor on a **different domain** would: change `app-domain.json` / `drive-domain.json`,
  redeploy both Workers, and **update the redirect URIs on both Google clients** to match. The
  legacy `workers.dev` hosts keep old installs working during any transition.

---

## 8. What is NOT in the repo (critical)

The repo lets any agent **understand and rebuild** the whole system. It cannot **act** on the
cloud services for you. To operate the project a maintainer needs, from outside the repo:

| Thing | Where it lives | Notes |
|---|---|---|
| `GOOGLE_CLIENT_SECRET` (×2) | Cloudflare Worker secrets | Set via `wrangler secret put`; never in git |
| `GOOGLE_CLIENT_ID` (×2) | Cloudflare Worker secrets | Client IDs aren't secret, but stored the same way |
| Google OAuth clients + consent screens | Google Cloud console | Redirect URIs, publishing status, the 100-cap counter |
| Gumroad product + license keys | Gumroad dashboard | Payment, tax, key generation, refund/revocation |
| Cloudflare account + `jnagase.com` zone | Cloudflare dashboard | Worker hosting, DNS, Universal SSL |
| Community store listing | community.obsidian.md | Managed by the author account |
| `.kiro/settings/` (MCP + editor config) | Local machine | Reconfigure per machine |

**Account access to log into** on a new machine / for a successor: Cloudflare, Google Cloud,
Gumroad, GitHub (`gh auth login`), and Obsidian community (if managing the listing). Nothing to
"back up" locally — it all lives in those accounts.

---

## 9. Config files & drift guards

| File | Drives | Guard |
|---|---|---|
| `app-domain.json` | Tasks Worker host + plugin `WORKER_BASE` + redirect URI | `test/worker-config.test.ts` asserts worker constants == plugin constants and that `wrangler.toml` route matches `authHost` |
| `drive-domain.json` | Drive Worker host + plugin `DRIVE_WORKER_BASE` | same idea for the Drive broker |
| `pro-config.json` | Gumroad `buyUrl`, `betaBuyUrl`, `licenseVerifyUrl`, `productId` | no host literal in `src/` → keeps `test/network-surface.property.test.ts` green |

The network-surface test enforces the privacy promise: the plugin only ever contacts the Google
auth/API hosts (and the Open Food Facts nutrition search). Adding a new outbound host to `src/`
fails that test on purpose.

---

## 10. Cloud service C — Gumroad (Pro licensing, zero-infra)

Pro is a **one-time US$10 unlock** for binary Drive sync. **No server of ours** is involved:

- Gumroad **collects payment + tax**, **generates a license key** per sale, exposes a **public
  verify API**, and **marks a key invalid on refund/chargeback** automatically.
- `pro-config.json` holds `buyUrl`, `betaBuyUrl` (a 100%-off code link for the free beta),
  `licenseVerifyUrl` (`https://api.gumroad.com/v2/licenses/verify`), and `productId`.
- The plugin POSTs `product_id` + `license_key` and unlocks when valid & not refunded.
  `validateLicense()` in `src/pro.ts` returns `valid` / `invalid` / `unreachable`; only a
  **definitive invalid** locks Pro — a transient outage keeps the last state + an offline grace.
- **Beta switch:** `PRO_BETA_FREE` in `src/pro.ts`. While `true`, every Pro feature is free for
  everyone. It is currently `false` (enforcing), with the "first 100 free" beta offer active via
  `betaBuyUrl`.
- Where the activated key is stored: base64 under an opaque key (`sig`) inside
  `Momentum Life/Config/state.md` in the vault (so it syncs across the user's devices), migrated
  automatically from the older `Config/pro.md`.

Full setup steps (Gumroad or Lemon Squeezy): **`docs/pro-license-setup.md`**.
User-facing terms: **`docs/pro-terms.md`** (also linked from the README and Settings → Momentum pro).

---

## 11. Sunset / retirement plan

If the maintainer stops (retires, changes jobs, loses interest):

- **The free, local features keep working forever** — they never touch the cloud services.
- The **online features degrade** only if the underlying accounts lapse: Google Tasks/Drive sync
  stop if the Workers/Google projects go away; Pro validation stops if Gumroad goes away. **No
  user data is lost** — notes are plain Markdown in the user's vault.
- **The clean exit:** in a final release, set **`PRO_BETA_FREE = true`** in `src/pro.ts` and ship
  it. Pro becomes free for everyone and no longer depends on Gumroad. Optionally also stop
  requiring the brokers if desired. This matches the promise in `docs/pro-terms.md`: if the
  project is discontinued, the intent is to open-source it fully (Pro free) or hand it to a new
  maintainer. Because the repo is MIT and public, anyone can fork and continue.

---

## 12. Where to read more

- **`.kiro/steering/momentum-life.md`** — the living rules, architecture notes, and hard-won
  lessons (Tasks/Boards model, sync internals, migrations, the auth gotchas above). **Start here.**
  If you use a non-Kiro agent, point it at this file explicitly — it won't be auto-loaded.
- **`.kiro/specs/*/`** — design/requirements/tasks for the larger features (Google Tasks
  multi-device sync, Drive isolated rollout, OAuth verification, journaling, …).
- **`docs/pro-license-setup.md`** — Gumroad/Lemon Squeezy setup.
- **`docs/pro-terms.md`** — the Pro & Beta terms shown to buyers.
- **`docs/oauth-verification/`** — materials for Google restricted-scope verification (Drive).
- **`README.md`** — user-facing overview, modules, network-use & privacy.
