// Single source of truth for the broker's hosts — DERIVED from app-domain.json, the same
// file src/appdomain.ts reads. Keeping one data file means CANONICAL_REDIRECT_URI here and
// WORKER_BASE in the plugin can never drift apart, which is the classic cause of
// redirect_uri_mismatch.
//
// test/worker-config.test.ts asserts these constants equal the plugin's, and that
// wrangler.toml's routes[].pattern matches authHost (TOML can't import JSON).
import config from "../../app-domain.json";

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SHARED_PUBLIC_SUFFIXES = ["workers.dev", "pages.dev", "github.io"];

/** See src/appdomain.ts for why first-level subdomains are mandatory (Universal SSL). */
function firstLevelLabel(host, root) {
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (!label || label.includes(".")) return null;
  return label;
}

/** Throws on a malformed config so a bad deploy fails fast instead of breaking OAuth. */
export function validateAppDomain(cfg) {
  for (const key of ["rootDomain", "siteHost", "authHost"]) {
    if (typeof cfg[key] !== "string" || !HOST_PATTERN.test(cfg[key])) {
      throw new Error(`app-domain.json: "${key}" must be a bare lowercase hostname`);
    }
  }
  if (SHARED_PUBLIC_SUFFIXES.some((s) => cfg.rootDomain === s || cfg.rootDomain.endsWith(`.${s}`))) {
    throw new Error(`app-domain.json: "rootDomain" must not be a shared public suffix`);
  }
  if (cfg.siteHost === cfg.authHost) {
    throw new Error(`app-domain.json: "siteHost" and "authHost" must differ`);
  }
  for (const key of ["siteHost", "authHost"]) {
    if (!firstLevelLabel(cfg[key], cfg.rootDomain)) {
      throw new Error(`app-domain.json: "${key}" must be a FIRST-LEVEL subdomain of ${cfg.rootDomain}`);
    }
  }
}

validateAppDomain(config);

export const ROOT_DOMAIN = config.rootDomain;
export const SITE_HOST = config.siteHost;
export const AUTH_HOST = config.authHost;

/**
 * The redirect_uri Google sees — a FIXED constant, never derived from the incoming request
 * host. This is what lets the legacy workers.dev origin keep serving old plugin installs
 * while only this one URI stays registered in the OAuth client.
 *
 * /auth and /exchange must send this exact string, or Google answers redirect_uri_mismatch.
 */
export const CANONICAL_REDIRECT_URI = `https://${AUTH_HOST}/callback`;
