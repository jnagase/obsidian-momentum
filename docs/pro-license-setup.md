# Momentum Pro — one-time unlock (zero-infra licensing)

Momentum Pro is a **one-time US$10 unlock** for the heavier Drive features (binary sync, and
future extras). It is **dormant** until you set it up: while `PRO_BETA_FREE = true` in
`src/pro.ts`, every Pro feature is free for everyone (the closed beta).

## Why zero-infra

Licensing uses a **merchant-of-record store** — **Gumroad** (recommended) or **Lemon Squeezy** —
so you run **no server**:

- The store **collects payment and tax** (VAT handled for you).
- The store **generates the license key** on purchase.
- The store exposes a **public verify endpoint** the plugin calls directly.
- The store marks a key **invalid on refund/chargeback** automatically — no revocation code.

There is **no Cloudflare Worker, no KV, no webhook** for licensing. No host literal ships in
`src/`: the verify URL, product id and buy link all live in `pro-config.json`.

## Setup with Gumroad (recommended)

1. Create a product on Gumroad: **one-time, US$10**, and enable **"Generate a license key per sale."**
2. Copy the product's **Buy link** and its **product ID**
   (Gumroad → product → *Advanced/Share* shows the product id).
3. Fill `pro-config.json`:
   ```json
   {
     "buyUrl": "https://<you>.gumroad.com/l/<product>",
     "licenseVerifyUrl": "https://api.gumroad.com/v2/licenses/verify",
     "productId": "<your-gumroad-product-id>"
   }
   ```
4. (Optional) add the buy link to `manifest.json` → `fundingUrl` so a ❤️ shows in the plugin list.
5. Flip the switch: set `PRO_BETA_FREE = false` in `src/pro.ts`, rebuild, release.

The plugin then POSTs `product_id` + `license_key` to the verify URL and unlocks when the purchase
is valid and not refunded/charged-back.

## Lemon Squeezy alternative

Lemon Squeezy also works (and supports **activation limits** to reduce key sharing). Its validate
endpoint is `https://api.lemonsqueezy.com/v1/licenses/validate` with the license key. If you use
it, adjust `validateLicense()` in `src/pro.ts` to read LS's `{ valid, license_key: { status } }`
shape (active vs disabled) instead of Gumroad's `{ success, purchase }`.

## Going live checklist

- [ ] Store product created (one-time, license key on)
- [ ] `pro-config.json` → buyUrl, licenseVerifyUrl, productId set
- [ ] `manifest.json` fundingUrl includes the buy link (optional)
- [ ] `PRO_BETA_FREE = false`
- [ ] Buy → get key → Activate (paste key) unlocks binary sync
- [ ] README + privacy mention the license key is sent to the store to verify

## Trust model (honest)

The gate is **client-side** and the plugin source is **public** (required by the community store),
so a determined user can bypass it. For a US$10 unlock that's the accepted trade-off — most people
just pay. The verify call, refund handling, tax and key generation are all the store's job.
