import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONTACT_EMAIL, PRIVACY_URL, APP_HOMEPAGE, SITE_HOST } from "../src/appdomain";

// =====================================================================================
// Feature: google-oauth-verification
// Example tests — content of the published pages
//
// One textual anchor per statement the OAuth review requires. These fail if a declaration is
// removed, which is the real risk: a policy that silently says less than the code does (or
// more) is the most common cause of rejection.
//
// Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.2–3.12, 3.13, 5.5
// =====================================================================================

const home = readFileSync("site/index.html", "utf8");
const privacy = readFileSync("site/privacy.html", "utf8");
const readme = readFileSync("README.md", "utf8");

/** Collapses whitespace so assertions survive line wrapping in the HTML source. */
const flat = (s: string) => s.replace(/\s+/g, " ");

const homeText = flat(home);
const privacyText = flat(privacy);

describe("homepage content", () => {
  it("shows the app name exactly as the consent screen declares it (2.2)", () => {
    expect(home).toContain("<h1>Momentum Life</h1>");
    expect(home).toContain("<title>Momentum Life</title>");
  });

  it("identifies the author and the contact email (2.3)", () => {
    expect(homeText).toContain("Jaime Nagase");
    expect(home).toContain(CONTACT_EMAIL);
  });

  it("describes the sync, its opt-in nature and the data accessed (2.4)", () => {
    expect(homeText).toContain("Obsidian plugin");
    expect(homeText).toMatch(/two ways|two-way|bidirectional/i);
    expect(homeText).toContain("optional and turned off by default");
    expect(homeText).toContain("Your task lists");
    expect(homeText).toContain("Your tasks");
    expect(homeText).toMatch(/Nothing else in your Google account is read or written/i);
  });

  it("links to the privacy policy and to the public repository (2.5)", () => {
    expect(home).toContain('href="/privacy"');
    expect(home).toContain("https://github.com/jnagase/obsidian-momentum");
  });

  it("is written in English (2.8)", () => {
    expect(home).toContain('lang="en"');
  });
});

describe("privacy policy content", () => {
  it("declares data lives only in the local vault (3.2)", () => {
    expect(privacyText).toMatch(/written <strong>only<\/strong> to Markdown files inside your local Obsidian vault/i);
  });

  it("declares API calls go straight from the device to Google (3.3)", () => {
    expect(privacyText).toContain("tasks.googleapis.com");
    expect(privacyText).toMatch(/from your own device/i);
    expect(privacyText).toMatch(/does not pass through any server/i);
  });

  it("declares the broker only does the handshake and sees no task content (3.4)", () => {
    expect(privacyText).toMatch(/exclusively in the OAuth handshake/i);
    expect(privacyText).toMatch(/does not receive, does not process and does not store the content of your tasks/i);
  });

  it("declares the broker persists nothing (3.5)", () => {
    expect(privacyText).toMatch(/does not persist tokens, authorization codes or user/i);
    expect(privacyText).toMatch(/stateless/i);
  });

  it("declares where tokens live and for how long (3.6)", () => {
    expect(privacyText).toContain("data.json");
    expect(privacyText).toMatch(/only in the plugin's local configuration file/i);
    expect(privacyText).toMatch(/not retained in any system controlled by the author/i);
  });

  it("enumerates the task fields exhaustively (3.7)", () => {
    for (const field of [
      "Task title",
      "Task notes",
      "Due date",
      "Completion status",
      "Task identifier",
      "Task list identifier",
    ]) {
      expect(privacyText).toContain(field);
    }
    expect(privacyText).toMatch(/No other data in your Google Account is read or written/i);
  });

  it("states the four Limited Use restrictions (3.8)", () => {
    expect(privacyText).toMatch(/not sold/i);
    expect(privacyText).toMatch(/not transferred to third parties/i);
    expect(privacyText).toMatch(/not used for advertising/i);
    expect(privacyText).toMatch(/not used to train artificial intelligence/i);
    expect(privacyText).toMatch(/solely to perform the synchronisation you asked for/i);
  });

  it("describes both revocation paths and note preservation (3.9)", () => {
    expect(privacyText).toMatch(/In the plugin/i);
    expect(privacyText).toContain("https://myaccount.google.com/permissions");
    expect(privacyText).toMatch(/the task notes already in your vault are kept/i);
  });

  it("describes how to delete tokens and synced content (3.10)", () => {
    expect(privacyText).toMatch(/delete the plugin's <code>data.json<\/code> file/i);
    expect(privacyText).toMatch(/delete the task notes from your vault/i);
  });

  it("carries a last-updated date and the privacy contact (3.11)", () => {
    expect(privacy).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
    expect(privacy).toContain(CONTACT_EMAIL);
  });

  it("declares no telemetry and no analytics (3.12)", () => {
    expect(privacyText).toMatch(/no telemetry and no analytics/i);
  });

  it("is written in English (3.14)", () => {
    expect(privacy).toContain('lang="en"');
  });
});

describe("identity is consistent across every surface (5.5, 3.13)", () => {
  it("uses the same contact email on both pages", () => {
    expect(home).toContain(CONTACT_EMAIL);
    expect(privacy).toContain(CONTACT_EMAIL);
  });

  it("derives the declared URLs from the single domain source", () => {
    expect(PRIVACY_URL).toBe(`https://${SITE_HOST}/privacy`);
    expect(APP_HOMEPAGE).toBe(`https://${SITE_HOST}/`);
  });

  it("links the privacy policy from the README (3.13)", () => {
    expect(readme).toContain(PRIVACY_URL);
  });
});
