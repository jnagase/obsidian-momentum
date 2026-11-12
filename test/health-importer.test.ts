import { describe, it, expect } from "vitest";
import { decideImporter, importerFromFrontmatter, IMPORTER_STALE_MS } from "../src/healthImporter";

const NOW = Date.parse("2026-11-12T18:00:00Z");
const desk = { deviceId: "desk", name: "Desktop", last: "2026-11-12T17:00:00Z" };

describe("importer device", () => {
  it("first device to import becomes the importer", () => {
    expect(decideImporter("phone", null, NOW, false)).toEqual({ action: "import", reason: "no-importer" });
  });

  it("the importer keeps importing", () => {
    expect(decideImporter("desk", desk, NOW, false)).toEqual({ action: "import", reason: "this-device" });
  });

  it("another device skips silently on startup, and asks on a manual import", () => {
    expect(decideImporter("phone", desk, NOW, false)).toEqual({ action: "skip", importer: desk });
    expect(decideImporter("phone", desk, NOW, true)).toEqual({ action: "ask", importer: desk });
  });

  it("takes over when the importer has been silent for more than a day", () => {
    const stale = { ...desk, last: new Date(NOW - IMPORTER_STALE_MS - 1).toISOString() };
    expect(decideImporter("phone", stale, NOW, false)).toEqual({ action: "import", reason: "takeover" });
    expect(decideImporter("phone", { ...desk, last: "" }, NOW, false).action).toBe("import");
  });

  it("reads the importer from the shared note", () => {
    expect(importerFromFrontmatter({ importer_device: "desk", importer_name: "Desktop", importer_last: desk.last })).toEqual(desk);
    expect(importerFromFrontmatter({ client_id: "x" })).toBeNull();
  });
});
