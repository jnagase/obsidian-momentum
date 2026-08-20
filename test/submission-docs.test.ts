import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_HOMEPAGE, PRIVACY_URL } from "../src/appdomain";

// =====================================================================================
// Feature: google-oauth-verification
// Example tests — submission documents
//
// The scope justification is pasted verbatim into the Verification Center. These assertions pin
// down the statements the review looks for, and the length limit of the field.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.x (script content)
// =====================================================================================

const justification = readFileSync("docs/oauth-verification/scope-justification.md", "utf8");
const scriptRaw = readFileSync("docs/oauth-verification/demo-video-script.md", "utf8");

/** Collapses whitespace so assertions survive markdown line wrapping. */
const script = scriptRaw.replace(/\s+/g, " ");

describe("scope justification", () => {
  it("names the exact scope string (8.1)", () => {
    expect(justification).toContain("https://www.googleapis.com/auth/tasks");
  });

  it("enumerates the four write operations (8.2)", () => {
    for (const op of ["Create a task", "Update a task", "Mark a task completed", "Delete a task"]) {
      expect(justification).toContain(op);
    }
  });

  it("explains why the readonly scope is insufficient (8.2)", () => {
    expect(justification).toContain("tasks.readonly");
    expect(justification).toMatch(/permits none of\s+these four operations/);
  });

  it("declares local-only storage and no storage server (8.3)", () => {
    expect(justification).toMatch(/no storage server/i);
    expect(justification).toMatch(/only to Markdown files inside the user's own\s+local Obsidian vault/);
    expect(justification).toMatch(/does \*\*not\*\* receive,\s*process or persist/);
  });

  it("states the four Limited Use restrictions (8.4)", () => {
    expect(justification).toMatch(/not sold/i);
    expect(justification).toMatch(/not transferred to third parties/i);
    expect(justification).toMatch(/not used for advertising/i);
    expect(justification).toMatch(/not used to train/i);
  });

  it("fits the Verification Center field (8.5)", () => {
    // The field caps at 4,000 characters. Measured on the submitted body, excluding the
    // internal note block at the top that is not pasted.
    const body = justification.split("---").slice(1).join("---");
    expect(body.length).toBeLessThanOrEqual(4000);
  });

  it("is written in English (8.5)", () => {
    // A Portuguese connective would mean the wrong text got pasted into the field.
    expect(justification).not.toMatch(/\b(não|então|porque|usuário)\b/i);
  });

  it("points at the same URLs the config derives (8.6)", () => {
    expect(justification).toContain(APP_HOMEPAGE);
    expect(justification).toContain(PRIVACY_URL);
  });
});

describe("demo video script", () => {
  it("covers the four takes", () => {
    for (const take of ["Take 1", "Take 2", "Take 3", "Take 4"]) {
      expect(script).toContain(take);
    }
  });

  it("requires the client_id and redirect_uri to be legible (9.4)", () => {
    expect(script).toContain("8btbj3o6");
    expect(script).toContain("redirect_uri");
  });

  it("forbids a cut between consent and the return to Obsidian (9.5)", () => {
    expect(script).toMatch(/Do not cut anywhere between step 3 and step 8/i);
  });

  it("requires self-provided English captions, not auto-generated (9.7)", () => {
    expect(script).toMatch(/Do not rely on YouTube's automatic captions/i);
  });

  it("requires a test account and records the cap slot (9.8, 9.10)", () => {
    expect(script).toMatch(/test Google account/i);
    expect(script).toMatch(/100 lifetime slots/i);
  });
});
