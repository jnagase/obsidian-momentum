/**
 * Field-aware merge for Momentum's MONTH LEDGER notes (Finance / Nutrition / Fitness month notes
 * and the Google Health month notes). Pure — no Obsidian imports — so it is unit-testable and the
 * Drive engine can call it through a callback.
 *
 * Why: a month note holds every item of the month in ONE frontmatter line (`entries: [...]`, or
 * `days: {...}` for health). Two devices adding different items to the same month both change that
 * one line, so the line-level merge can't prove it safe and the Drive sync used to save the other
 * side as `<note>.conflict.md` — which the UI ignores, hiding real data (workouts vanished on the
 * phone). The items carry stable keys (`id` / the day), so we can merge them exactly instead.
 */

export type LedgerKind = "entries" | "days";

/** Note types whose data is an `entries` array keyed by `id`. */
const ENTRY_TYPES = new Set(["finance-month", "nutrition-month", "fitness-month"]);
/** Note types whose data is a `days` map keyed by the date. */
const DAY_TYPES = new Set(["health-month"]);

export interface LedgerDoc {
  type: string;
  month: string;
  kind: LedgerKind;
  /** Items by key, in file order. */
  items: Map<string, unknown>;
  /** Other scalar frontmatter fields (e.g. `source`), kept on rewrite. */
  extra: Record<string, unknown>;
}

function frontmatterLines(text: string): string[] | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  return text.slice(3, end).split("\n");
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (!v) return "";
  try { return JSON.parse(v) as unknown; } catch { return v.replace(/^['"]|['"]$/g, ""); }
}

/**
 * Parse a month ledger note. Returns null for anything that isn't one (or is malformed) — callers
 * then fall back to the normal conflict handling, so an unexpected file is never rewritten.
 */
export function parseLedgerDoc(text: string): LedgerDoc | null {
  const lines = frontmatterLines(text);
  if (!lines) return null;
  const fm: Record<string, unknown> = {};
  for (const line of lines) {
    const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (m) fm[m[1]] = parseValue(m[2]);
  }
  const type = typeof fm.type === "string" ? fm.type : "";
  const month = typeof fm.month === "string" ? fm.month : "";
  if (!month) return null;
  const items = new Map<string, unknown>();
  let kind: LedgerKind;
  if (ENTRY_TYPES.has(type)) {
    kind = "entries";
    if (!Array.isArray(fm.entries)) return null;
    for (const e of fm.entries as unknown[]) {
      if (!e || typeof e !== "object") return null;
      const id = (e as Record<string, unknown>).id;
      if (typeof id !== "string" && typeof id !== "number") return null; // no stable key → can't merge safely
      if (id === "") return null;
      items.set(String(id), e);
    }
  } else if (DAY_TYPES.has(type)) {
    kind = "days";
    const days = fm.days;
    if (!days || typeof days !== "object" || Array.isArray(days)) return null;
    for (const [k, v] of Object.entries(days as Record<string, unknown>)) items.set(k, v);
  } else {
    return null;
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k === "type" || k === "month" || k === "entries" || k === "days") continue;
    extra[k] = v;
  }
  return { type, month, kind, items, extra };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Key-level 3-way merge. With a base: an item added on either side is kept; an item deleted on one
 * side is dropped unless the other side edited it (edit beats delete); edited on both → LOCAL wins
 * (the remote edit of the same item is the only thing that can be lost, never a whole item).
 * Without a base (first contact / healing an old `.conflict` copy): UNION, local wins on the same
 * key — nothing is dropped (a deletion done on one side may come back, which is the safe direction).
 */
export function mergeKeyed(
  base: Map<string, unknown> | undefined, local: Map<string, unknown>, remote: Map<string, unknown>,
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const keys = [...new Set([...local.keys(), ...remote.keys(), ...(base ? base.keys() : [])])];
  for (const k of keys) {
    const inL = local.has(k), inR = remote.has(k);
    const l = local.get(k), r = remote.get(k);
    if (!base) {
      if (inL) out.set(k, l); else if (inR) out.set(k, r);
      continue;
    }
    const inB = base.has(k), b = base.get(k);
    if (inL && inR) {
      out.set(k, inB && same(l, b) ? r : l); // only remote changed → take it; else local wins
    } else if (inL) {
      // Missing remotely: added locally (no base) or deleted remotely (unless edited here).
      if (!inB || !same(l, b)) out.set(k, l);
    } else if (inR) {
      if (!inB || !same(r, b)) out.set(k, r);
    }
  }
  return out;
}

export interface LedgerMerge {
  type: string;
  month: string;
  kind: LedgerKind;
  /** Merged entries (kind "entries") — unsorted; the writer sorts deterministically. */
  entries: Record<string, unknown>[];
  /** Merged days (kind "days"), keys sorted. */
  days: Record<string, unknown>;
  extra: Record<string, unknown>;
}

/**
 * Merge two (optionally three, with the last-synced base) versions of the SAME month ledger note.
 * Returns null when they aren't both ledger notes of the same type+month — the caller then keeps
 * its normal conflict behaviour.
 */
export function mergeLedgerTexts(baseText: string | undefined, localText: string, remoteText: string): LedgerMerge | null {
  const local = parseLedgerDoc(localText);
  const remote = parseLedgerDoc(remoteText);
  if (!local || !remote) return null;
  if (local.type !== remote.type || local.month !== remote.month) return null;
  const baseDoc = baseText !== undefined ? parseLedgerDoc(baseText) : null;
  const base = baseDoc && baseDoc.type === local.type && baseDoc.month === local.month ? baseDoc.items : undefined;
  const merged = mergeKeyed(base, local.items, remote.items);
  const extra = { ...remote.extra, ...local.extra };
  if (local.kind === "entries") {
    return { type: local.type, month: local.month, kind: "entries", entries: [...merged.values()] as Record<string, unknown>[], days: {}, extra };
  }
  const days: Record<string, unknown> = {};
  for (const k of [...merged.keys()].sort()) days[k] = merged.get(k);
  return { type: local.type, month: local.month, kind: "days", entries: [], days, extra };
}

/** `a/b/Note.conflict.md` / `Note.conflict-3.md` → `a/b/Note.md`; null if not a conflict copy. */
export function conflictOriginalPath(path: string): string | null {
  const m = /^(.*)\.conflict(?:-\d+)?(\.[^./]+)$/i.exec(path);
  return m ? `${m[1]}${m[2]}` : null;
}
