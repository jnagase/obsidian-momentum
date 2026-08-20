import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Property 12 — Toda página servida funciona sem JavaScript e é indexável
//
//   ∀ HTML file h in site/: h contains no <script> tag, no inline event attribute and no
//   required content inside <noscript>; h carries no noindex directive; and h's served path
//   is not blocked by any rule in the published robots.txt.
//
// Validates: Requirements 2.6, 2.7, 3.1
//
// AUDIT: reads the real files from site/ — the exact bytes Cloudflare Pages publishes — so a
// regression (someone adding an analytics snippet, a font from a CDN, or a Disallow rule)
// fails here instead of during the Google review.
// =====================================================================================

const SITE_DIR = "site";

/** The served path for a file in site/, applying Pages' clean-URL behaviour. */
function servedPath(file: string): string {
  if (file === "index.html") return "/";
  return `/${file.replace(/\.html$/, "")}`;
}

const htmlFiles = existsSync(SITE_DIR)
  ? readdirSync(SITE_DIR).filter((f) => f.endsWith(".html"))
  : [];

/** Inline event handlers (onclick=, onload=, …) — any of these needs JavaScript. */
const INLINE_EVENT = /\son[a-z]+\s*=/i;

describe("Property 12: every served page works without JavaScript and is indexable", () => {
  it("has pages to check", () => {
    expect(htmlFiles.length).toBeGreaterThan(0);
    expect(htmlFiles).toContain("index.html");
    expect(htmlFiles).toContain("privacy.html");
  });

  it("holds for any HTML file in site/", () => {
    fc.assert(
      fc.property(fc.constantFrom(...htmlFiles), (file) => {
        const html = readFileSync(join(SITE_DIR, file), "utf8");

        // No JavaScript of any kind.
        expect(html).not.toMatch(/<script\b/i);
        expect(html).not.toMatch(INLINE_EVENT);
        expect(html).not.toMatch(/<noscript\b/i);

        // No noindex, in meta form or as a header directive written into the page.
        expect(html.toLowerCase()).not.toContain("noindex");

        // No remote subresource: every stylesheet, image and script origin must be local,
        // otherwise the page depends on a third party to render.
        const remoteRefs = html.match(/(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"/gi) ?? [];
        const offending = remoteRefs.filter((ref) => !/mailto:/i.test(ref) && !/rel\s*=\s*"?canonical/i.test(ref));
        // Links to other sites are allowed in prose (GitHub, Google permissions); only
        // *subresources* would break no-JS rendering. Assert none of them are stylesheets.
        for (const ref of offending) {
          expect(ref).not.toMatch(/^src/i);
        }
        expect(html).not.toMatch(/<link[^>]+stylesheet[^>]+(https?:)?\/\//i);

        // The page's served path is not blocked by robots.txt.
        const robots = readFileSync(join(SITE_DIR, "robots.txt"), "utf8");
        const disallowed = robots
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^disallow:/i.test(l))
          .map((l) => l.split(":")[1].trim())
          .filter((p) => p.length > 0);
        const path = servedPath(file);
        for (const rule of disallowed) {
          expect(path.startsWith(rule)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
