import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CHANGELOG } from "../src/whatsnew";

// =====================================================================================
// Feature: google-oauth-verification
// Example tests — release coherence
//
// The release process touches four version files plus the lockfile. A mismatch is not caught by
// the build: the plugin still compiles, but the GitHub release workflow uses `npm ci` and the
// community portal compares the tag against manifest.json — so a drifted version fails late,
// after the tag is already pushed.
//
// Validates: Requirements 7.8, 10.7
// =====================================================================================

const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string; minAppVersion: string };
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const versions = JSON.parse(readFileSync("versions.json", "utf8")) as Record<string, string>;
const foodapi = readFileSync("src/foodapi.ts", "utf8");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { version: string; packages: Record<string, { version?: string }> };

describe("the four version files agree", () => {
  it("manifest.json and package.json carry the same version", () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it("versions.json maps the current version to a minAppVersion", () => {
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });

  it("the food API user agent carries the current version", () => {
    expect(foodapi).toContain(`Momentum-Obsidian/${manifest.version} `);
  });

  it("package-lock.json is in sync with package.json", () => {
    // The release workflow runs `npm ci`, which fails outright on a drifted lockfile — and a
    // drifted lock has already broken the provenance attestation once.
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
  });

  it("uses a bare SemVer, with no v prefix (the tag must match)", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the changelog covers this release", () => {
  it("has an entry for the current version, newest first", () => {
    expect(CHANGELOG[0].version).toBe(manifest.version);
  });

  it("tells the user that nothing is required of them (7.8)", () => {
    const entry = CHANGELOG.find((e) => e.version === manifest.version);
    expect(entry).toBeDefined();
    const text = entry!.sections.flatMap((s) => [s.title, ...s.items]).join(" ").toLowerCase();
    // The domain migration is invisible; saying so is what keeps it from looking like a
    // breakage the user has to act on.
    expect(text).toMatch(/nothing is required from you|no action|keeps working/);
    expect(text).toContain("google");
  });
});
