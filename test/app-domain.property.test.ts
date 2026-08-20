import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  deriveAppDomain,
  validateAppDomain,
  ROOT_DOMAIN,
  SITE_HOST,
  AUTH_HOST,
  AppDomainConfig,
} from "../src/appdomain";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Property 11 — Toda URL do sistema deriva do mesmo domínio raiz
//
//   ∀ valid config c: the registrable root domain of APP_HOMEPAGE, PRIVACY_URL and
//   CANONICAL_REDIRECT_URI is the same and equals c.rootDomain; rootDomain carries no
//   scheme/path/port/trailing slash/subdomain and is not a shared public suffix; siteHost
//   and authHost differ and each adds EXACTLY ONE label to rootDomain. Malformed configs —
//   second-level hosts included — are rejected rather than producing invalid URLs or a
//   production TLS failure. No file in src/, worker/src/ or site/ contains a host literal.
//
// Validates: Requirements 1.4, 1.5, 1.7, 2.10, 7.5
//
// AUDIT: the test drives the real `deriveAppDomain`/`validateAppDomain` from
// src/appdomain.ts — the same functions that produce the constants the plugin ships — not a
// reimplementation. The "no literal" assertion greps the actual source tree.
// =====================================================================================

const label = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);

/** A registrable root domain that is not a shared public suffix. */
const rootArb = fc
  .tuple(label, fc.constantFrom("com", "net", "app", "dev", "com.br", "io"))
  .map(([name, tld]) => `${name}.${tld}`);

/** A well-formed config: two DISTINCT first-level subdomains of the same root. */
const validConfigArb = fc
  .tuple(rootArb, label, label)
  .filter(([, a, b]) => a !== b)
  .map(([root, a, b]): AppDomainConfig => ({
    rootDomain: root,
    siteHost: `${a}.${root}`,
    authHost: `${b}.${root}`,
  }));

/** Extracts the host from a URL, so we can check what root it belongs to. */
const hostOf = (url: string): string => new URL(url).hostname;

/** True when `host` is `root` or a subdomain of it. */
const belongsTo = (host: string, root: string): boolean =>
  host === root || host.endsWith(`.${root}`);

describe("Property 11: every system URL derives from the same root domain", () => {
  it("derives all URLs from one root, and rejects malformed configs", () => {
    fc.assert(
      fc.property(validConfigArb, (cfg) => {
        const d = deriveAppDomain(cfg);

        // Every public URL belongs to the declared root domain.
        for (const url of [d.appHomepage, d.privacyUrl, d.canonicalRedirectUri]) {
          expect(belongsTo(hostOf(url), cfg.rootDomain)).toBe(true);
        }

        // The root domain itself is bare: no scheme, path, port, trailing slash, subdomain.
        expect(d.rootDomain).toBe(cfg.rootDomain);
        expect(d.rootDomain).not.toMatch(/[:/]/);
        expect(d.rootDomain.endsWith("/")).toBe(false);

        // The two hosts are distinct and each adds exactly one label to the root.
        expect(d.siteHost).not.toBe(d.authHost);
        for (const host of [d.siteHost, d.authHost]) {
          const prefix = host.slice(0, host.length - cfg.rootDomain.length - 1);
          expect(prefix).not.toContain(".");
          expect(prefix.length).toBeGreaterThan(0);
        }

        // The canonical redirect is exactly the auth host's /callback, over https.
        expect(d.canonicalRedirectUri).toBe(`https://${cfg.authHost}/callback`);
        expect(d.workerBase).toBe(`https://${cfg.authHost}`);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects shared public suffixes, second-level hosts and malformed values", () => {
    fc.assert(
      fc.property(validConfigArb, label, (cfg, extra) => {
        // A shared public suffix can never be the root — nobody owns it.
        for (const suffix of ["workers.dev", "pages.dev", "github.io"]) {
          expect(() =>
            validateAppDomain({
              rootDomain: suffix,
              siteHost: `${extra}.${suffix}`,
              authHost: `${extra}2.${suffix}`,
            }),
          ).toThrow();
        }

        // A SECOND-level host is rejected: Cloudflare Universal SSL wouldn't cover it, so
        // accepting it here would trade a test failure for a production TLS error.
        expect(() =>
          validateAppDomain({ ...cfg, authHost: `${extra}.${cfg.authHost}` }),
        ).toThrow();

        // Identical hosts are rejected.
        expect(() => validateAppDomain({ ...cfg, siteHost: cfg.authHost })).toThrow();

        // A host outside the declared root is rejected.
        expect(() =>
          validateAppDomain({ ...cfg, siteHost: `${extra}.example.org` }),
        ).toThrow();

        // Scheme, path, port, trailing slash and uppercase are all malformed.
        for (const bad of [
          `https://${cfg.siteHost}`,
          `${cfg.siteHost}/privacy`,
          `${cfg.siteHost}:443`,
          `${cfg.siteHost}/`,
          cfg.siteHost.toUpperCase(),
          "",
          "nodots",
        ]) {
          expect(() => validateAppDomain({ ...cfg, siteHost: bad })).toThrow();
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------
// The hosts must exist in exactly ONE place: app-domain.json. A literal anywhere in the
// source tree would silently survive a domain change and break OAuth.
// ---------------------------------------------------------------------------------------

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []; // site/ is created in a later phase
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

describe("Property 11: no host literal outside app-domain.json", () => {
  it("keeps src/, worker/src/ and site/ free of hardcoded hosts", () => {
    const hosts = [ROOT_DOMAIN, SITE_HOST, AUTH_HOST];
    const offenders: string[] = [];

    for (const dir of ["src", "worker/src", "site"]) {
      for (const file of filesUnder(dir)) {
        const text = readFileSync(file, "utf8");
        for (const host of hosts) {
          if (text.includes(host)) offenders.push(`${file} contains "${host}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
