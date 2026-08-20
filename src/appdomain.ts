// Single source of truth for the app's public hosts. Everything is DERIVED from
// app-domain.json — never hardcode a host anywhere else in src/.
//
// Changing the domain is a one-line edit in app-domain.json (plus the matching
// routes[].pattern in worker/wrangler.toml, which TOML can't import from JSON —
// test/worker-config.test.ts guards that pair).
//
// Why the two hosts are FIRST-LEVEL subdomains (momentumlife-auth.<root>, not
// auth.momentumlife.<root>): Cloudflare's Universal SSL only covers the apex and one
// level of wildcard (*.<root>). A second-level host would get no automatic certificate
// and would need Advanced Certificate Manager — and a missing certificate fails the
// Google OAuth verification requirement of a valid HTTPS endpoint.
import config from "../app-domain.json";

/** A hostname: lowercase labels separated by dots, no scheme, port, path or trailing slash. */
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Shared suffixes nobody owns — Google rejects these in "Authorized domains". */
const SHARED_PUBLIC_SUFFIXES = ["workers.dev", "pages.dev", "github.io"];

export interface AppDomainConfig {
  rootDomain: string;
  siteHost: string;
  authHost: string;
}

/**
 * Returns the single label that `host` adds on top of `root`, or null when `host` is not
 * a first-level subdomain of `root`. Used to reject second-level hosts at build/test time
 * instead of discovering the missing certificate as a TLS error in production.
 */
function firstLevelLabel(host: string, root: string): string | null {
  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (!label || label.includes(".")) return null;
  return label;
}

/**
 * Validates the domain configuration, throwing on anything malformed. Called at module
 * load on purpose: a broken config must fail loudly during build and tests rather than
 * silently produce an invalid URL that only breaks OAuth at runtime.
 */
export function validateAppDomain(cfg: AppDomainConfig): void {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== "string" || !HOST_PATTERN.test(value)) {
      throw new Error(`app-domain.json: "${key}" must be a bare lowercase hostname, got ${JSON.stringify(value)}`);
    }
  }
  if (SHARED_PUBLIC_SUFFIXES.some((s) => cfg.rootDomain === s || cfg.rootDomain.endsWith(`.${s}`))) {
    throw new Error(`app-domain.json: "rootDomain" must not be a shared public suffix (${cfg.rootDomain})`);
  }
  if (cfg.siteHost === cfg.authHost) {
    throw new Error(`app-domain.json: "siteHost" and "authHost" must differ`);
  }
  for (const key of ["siteHost", "authHost"] as const) {
    if (!firstLevelLabel(cfg[key], cfg.rootDomain)) {
      throw new Error(
        `app-domain.json: "${key}" must be a FIRST-LEVEL subdomain of ${cfg.rootDomain} ` +
        `(exactly one label before it, so Cloudflare Universal SSL covers it), got ${cfg[key]}`,
      );
    }
  }
}

export interface DerivedUrls {
  rootDomain: string;
  siteHost: string;
  authHost: string;
  workerBase: string;
  canonicalRedirectUri: string;
  appHomepage: string;
  privacyUrl: string;
}

/**
 * Pure derivation: every URL the system uses, built by template from one config. Exported so
 * the property test can exercise arbitrary valid configs, not just the committed one.
 * Validates first, so a malformed config throws instead of yielding a broken URL.
 */
export function deriveAppDomain(cfg: AppDomainConfig): DerivedUrls {
  validateAppDomain(cfg);
  const workerBase = `https://${cfg.authHost}`;
  return {
    rootDomain: cfg.rootDomain,
    siteHost: cfg.siteHost,
    authHost: cfg.authHost,
    workerBase,
    canonicalRedirectUri: `${workerBase}/callback`,
    appHomepage: `https://${cfg.siteHost}/`,
    privacyUrl: `https://${cfg.siteHost}/privacy`,
  };
}

const derived = deriveAppDomain(config);

/** Registrable root domain — this is what goes in the consent screen's "Authorized domains". */
export const ROOT_DOMAIN = derived.rootDomain;
/** Host serving the public pages (homepage + privacy policy). */
export const SITE_HOST = derived.siteHost;
/** Host serving the OAuth broker Worker. */
export const AUTH_HOST = derived.authHost;

/** Base URL of the OAuth broker the plugin talks to. No legacy fallback, by design. */
export const WORKER_BASE = derived.workerBase;
/** The one and only redirect_uri registered in the Google OAuth client. */
export const CANONICAL_REDIRECT_URI = derived.canonicalRedirectUri;
/** Public homepage declared in the consent screen. */
export const APP_HOMEPAGE = derived.appHomepage;
/** Public privacy policy declared in the consent screen. */
export const PRIVACY_URL = derived.privacyUrl;
/** Contact email — must be identical here, on both pages, and in the consent screen. */
export const CONTACT_EMAIL = "jaime.nagase@gmail.com";
