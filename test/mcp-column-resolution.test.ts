import { describe, it, expect } from "vitest";
import { resolveColumn, normCol } from "../mcp/src/store.mjs";

// =====================================================================================
// Bug fix: MCP createTask/updateTask must honour a requested column even when the caller
// spells it "in-progress" / "in_progress" / "In Progress" instead of the exact "in progress".
// Previously an inexact match silently fell back to the first column (backlog).
// =====================================================================================

const COLS = ["backlog", "in progress", "done"];

describe("resolveColumn — tolerant column matching", () => {
  it("matches the exact column name", () => {
    expect(resolveColumn("in progress", COLS)).toBe("in progress");
  });
  it("matches a hyphenated variant (the reported bug)", () => {
    expect(resolveColumn("in-progress", COLS)).toBe("in progress");
  });
  it("matches an underscore variant", () => {
    expect(resolveColumn("in_progress", COLS)).toBe("in progress");
  });
  it("matches case-insensitively", () => {
    expect(resolveColumn("In Progress", COLS)).toBe("in progress");
    expect(resolveColumn("DONE", COLS)).toBe("done");
  });
  it("matches with collapsed extra spaces", () => {
    expect(resolveColumn("in   progress", COLS)).toBe("in progress");
  });
  it("returns null for a genuinely unknown column (caller falls back to first)", () => {
    expect(resolveColumn("todo", COLS)).toBeNull();
    expect(resolveColumn("", COLS)).toBeNull();
    expect(resolveColumn(undefined, COLS)).toBeNull();
  });
});

describe("normCol", () => {
  it("lowercases, converts separators, and trims", () => {
    expect(normCol("  In-Progress ")).toBe("in progress");
    expect(normCol("IN_PROGRESS")).toBe("in progress");
  });
});
