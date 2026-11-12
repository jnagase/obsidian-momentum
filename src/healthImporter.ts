// Google Health "importer device" (author decision, 2026-11-12). With the plugin on several devices,
// only ONE imports from Google; the rest just read the notes Drive/Obsidian Sync bring them. That
// keeps a single writer for the imported entries (no `.conflict` copies from two devices importing
// at different times). The importer is recorded in the shared vault note Config/google-health.md.
// If it stops importing (left at home, uninstalled), another device takes over after a grace period.
//
// Scope: Google Health ONLY. Google Tasks keeps having no owner (each device syncs with Google).

/** How long the importer may stay silent before another device takes over. */
export const IMPORTER_STALE_MS = 24 * 60 * 60 * 1000;

export interface ImporterInfo {
  deviceId: string;
  name: string;
  /** ISO time of that device's last successful import. */
  last: string;
}

export type ImporterDecision =
  | { action: "import"; reason: "no-importer" | "this-device" | "takeover" }
  | { action: "skip" | "ask"; importer: ImporterInfo };

/**
 * Should THIS device import now? Pure. `manual` = the user clicked Import now (we ask instead of
 * silently skipping when another device is the importer).
 */
export function decideImporter(me: string, importer: ImporterInfo | null, nowMs: number, manual: boolean): ImporterDecision {
  if (!importer || !importer.deviceId) return { action: "import", reason: "no-importer" };
  if (importer.deviceId === me) return { action: "import", reason: "this-device" };
  const lastMs = Date.parse(importer.last);
  if (!Number.isFinite(lastMs) || nowMs - lastMs > IMPORTER_STALE_MS) return { action: "import", reason: "takeover" };
  return manual ? { action: "ask", importer } : { action: "skip", importer };
}

/** Read the importer fields from the note's frontmatter (null when absent/malformed). */
export function importerFromFrontmatter(fm: Record<string, unknown>): ImporterInfo | null {
  const id = typeof fm.importer_device === "string" ? fm.importer_device : "";
  if (!id) return null;
  return {
    deviceId: id,
    name: typeof fm.importer_name === "string" ? fm.importer_name : "another device",
    last: typeof fm.importer_last === "string" ? fm.importer_last : "",
  };
}
