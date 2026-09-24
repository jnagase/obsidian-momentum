import { requestUrl } from "obsidian";
import proConfig from "../pro-config.json";

// Momentum Pro — a single one-time unlock ("pro") for the heavier Drive features (binary sync,
// and future extras).
//
// ZERO INFRA: payment + license keys are handled by a merchant-of-record store (Gumroad or
// Lemon Squeezy). They collect tax, generate the key, expose a PUBLIC verify endpoint, and mark
// a key invalid on refund/chargeback. The plugin validates the key by calling that endpoint
// directly — no server, no webhook, no database of ours.
//
// No host literal lives in source: the verify URL, product id and buy URL all come from
// pro-config.json, so the "closed network surface" property test stays green.

interface ProConfig { buyUrl?: string; betaBuyUrl?: string; licenseVerifyUrl?: string; productId?: string }
const cfg = proConfig as ProConfig;

/**
 * While true, every Pro feature is UNLOCKED for everyone (closed beta). Flip to false to start
 * enforcing the license. Nothing charges while this is true.
 */
export const PRO_BETA_FREE = false;

/** Display price for the settings UI. */
export const PRO_PRICE = "US$10 · one-time";

/** The normal store checkout link (opened in the browser). Empty until configured. */
export const PRO_BUY_URL: string = cfg.buyUrl ?? "";

/**
 * "First 100 free" beta link: a Gumroad discount-code URL (100% off, capped at 100 uses) that
 * auto-applies the code so testers check out at US$0 and still get a license key. When the code is
 * used up the same URL just falls back to full price. Leave empty to disable the beta offer.
 */
export const PRO_BETA_BUY_URL: string = cfg.betaBuyUrl ?? "";

/** Link the Buy button opens: the beta US$0 code URL when set, otherwise the normal checkout. */
export const PRO_CHECKOUT_URL: string = PRO_BETA_BUY_URL || PRO_BUY_URL;

/** True while the "first 100 free" beta offer link is configured. */
export const PRO_BETA_OFFER = PRO_BETA_BUY_URL.length > 0;

export interface ProState {
  key?: string;
  valid?: boolean;
  checkedAt?: number;
}

/** Offline grace: a previously-valid license keeps working this long without a re-check. */
export const PRO_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** Re-validate in the background when the last check is older than this. */
export const PRO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** Is Pro active? Beta unlocks everything; otherwise a valid license within the offline grace. */
export function isProActive(state: ProState): boolean {
  if (PRO_BETA_FREE) return true;
  if (!state.valid) return false;
  if (!state.checkedAt) return true;
  return Date.now() - state.checkedAt <= PRO_GRACE_MS;
}

/** True when the last successful check is stale and a background re-validate is worth doing. */
export function proNeedsRecheck(state: ProState): boolean {
  if (PRO_BETA_FREE || !state.key) return false;
  return !state.checkedAt || Date.now() - state.checkedAt > PRO_RECHECK_MS;
}

/**
 * Validate a license key against the store's public verify endpoint (Gumroad shape:
 * POST product_id + license_key → { success, purchase:{ refunded, chargebacked, disputed } }).
 * Returns true only when the purchase is valid and not refunded/charged back. All network detail
 * (host, product id) comes from pro-config.json — no source literal.
 */
/** Outcome of a license check. `unreachable` means we couldn't get a definitive answer (offline,
 *  rate-limited, or a store outage) — the caller must NOT lock Pro on it, only on a real `invalid`. */
export type LicenseStatus = "valid" | "invalid" | "unreachable";

export async function validateLicense(key: string): Promise<LicenseStatus> {
  const licenseKey = key.trim();
  if (!cfg.licenseVerifyUrl || !cfg.productId) return "unreachable"; // not configured → can't tell
  if (!licenseKey) return "invalid";
  try {
    const body = new URLSearchParams({
      product_id: cfg.productId,
      license_key: licenseKey,
      increment_uses_count: "false",
    }).toString();
    const r = await requestUrl({
      url: cfg.licenseVerifyUrl,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      throw: false,
    });
    // A definitive rejection by the store (unknown/blocked key) → invalid. Rate-limit (429),
    // server errors (5xx) or a network exception → unreachable: keep the last known state so a
    // transient blip never locks out a paying user.
    if (r.status === 401 || r.status === 403 || r.status === 404) return "invalid";
    if (r.status >= 400) return "unreachable";
    const j = r.json as { success?: boolean; purchase?: { refunded?: boolean; chargebacked?: boolean; disputed?: boolean } };
    const p = j.purchase ?? {};
    return (!!j.success && !p.refunded && !p.chargebacked && !p.disputed) ? "valid" : "invalid";
  } catch {
    return "unreachable";
  }
}
