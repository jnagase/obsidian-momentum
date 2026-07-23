import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  INVALID_FILENAME_CHARS,
  sanitizeSegment,
  formatAmount,
  monthKeyOf,
  monthName,
  monthHubTitle,
  financeTxTitle,
  mealLogTitle,
  workoutTitle,
  mergeBody,
} from "../src/readablenotes";

// -------------------------------------------------------------------------------------
// Shared helpers / generators
// -------------------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Fresh (non-global) copy of the invalid-char set — avoids stateful `lastIndex` on the exported /g regex. */
const hasInvalidChar = (s: string) => /[\\/:*?"<>|#^[\]]/.test(s);
const hasWhitespace = (s: string) => /\s/.test(s);
const hasEdgeHyphen = (s: string) => /^-|-$/.test(s);
const hasDoubleHyphen = (s: string) => /--/.test(s);

/** Raw segment generator mixing ASCII, full-unicode, and a curated set of accents/symbols. */
const rawSegArb = fc.oneof(
  fc.string(),
  fc.fullUnicodeString(),
  fc.stringOf(
    fc.constantFrom(
      "a", "b", "Z", "1", "9", " ", "-", "_",
      "á", "ã", "ç", "é", "ñ", "ô",
      "*", "/", ":", "#", "^", "<", ">", "|", '"', "?", "[", "]", "\\", "\t",
    ),
    { maxLength: 16 },
  ),
);

/** Valid YYYY-MM-DD dates. */
const dateArb = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${pad2(m)}-${pad2(d)}`);

/** Valid YYYY-MM month keys. */
const monthKeyArb = fc
  .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }))
  .map(([y, m]) => `${y}-${pad2(m)}`);

/** Money-scale finite doubles (bounded to a sane filename range, no NaN/Infinity). */
const moneyArb = fc.double({ min: -1e12, max: 1e12, noNaN: true, noDefaultInfinity: true });

// =====================================================================================
// sanitizeSegment
// =====================================================================================

describe("sanitizeSegment", () => {
  // Property 1 — Sanitization is deterministic. Validates: Requirements 1.9
  it("P1: is deterministic", () => {
    fc.assert(
      fc.property(rawSegArb, (s) => {
        expect(sanitizeSegment(s)).toBe(sanitizeSegment(s));
      }),
      { numRuns: 500 },
    );
  });

  // Property 2 — Sanitization produces safe segments. Validates: Requirements 1.6, 1.7, 1.8
  it("P2: output has no invalid chars, no whitespace, no edge/duplicate hyphens", () => {
    fc.assert(
      fc.property(rawSegArb, (s) => {
        const out = sanitizeSegment(s);
        expect(hasInvalidChar(out)).toBe(false);
        expect(hasWhitespace(out)).toBe(false);
        expect(hasEdgeHyphen(out)).toBe(false);
        expect(hasDoubleHyphen(out)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("preserves accented letters (á, ã, ç, é, ñ)", () => {
    expect(sanitizeSegment("Café")).toBe("Café");
    expect(sanitizeSegment("Ar condicionado")).toBe("Ar-condicionado");
    expect(sanitizeSegment("Café / Padaria")).toBe("Café-Padaria");
    expect(sanitizeSegment("São João")).toBe("São-João");
    expect(sanitizeSegment("açaí ñoño")).toBe("açaí-ñoño");
  });

  it("maps symbol-only input to the empty string", () => {
    expect(sanitizeSegment("***")).toBe("");
    expect(sanitizeSegment("/:*?")).toBe("");
    expect(sanitizeSegment("")).toBe("");
    expect(sanitizeSegment("   ")).toBe("");
    expect(sanitizeSegment("---")).toBe("");
  });

  it("collapses whitespace and hyphen runs and trims edges", () => {
    expect(sanitizeSegment("  spaced  out  ")).toBe("spaced-out");
    expect(sanitizeSegment("ebanx*spotify")).toBe("ebanx-spotify");
    expect(sanitizeSegment("-lead--mid--trail-")).toBe("lead-mid-trail");
  });

  it("treats nullish input as empty", () => {
    expect(sanitizeSegment(undefined as unknown as string)).toBe("");
    expect(sanitizeSegment(null as unknown as string)).toBe("");
  });

  it("INVALID_FILENAME_CHARS is exported and global", () => {
    expect(INVALID_FILENAME_CHARS.flags).toContain("g");
  });
});

// =====================================================================================
// formatAmount
// =====================================================================================

describe("formatAmount", () => {
  // Property 3 — Amount formatting is well-formed. Validates: Requirements 1.4
  it("P3: matches /^\\d+\\.\\d{2}$/ and equals Math.abs(n).toFixed(2) for finite n", () => {
    fc.assert(
      fc.property(moneyArb, (n) => {
        const out = formatAmount(n);
        expect(out).toMatch(/^\d+\.\d{2}$/);
        expect(out).toBe(Math.abs(n).toFixed(2));
      }),
      { numRuns: 500 },
    );
  });

  it("formats representative examples", () => {
    expect(formatAmount(42.9)).toBe("42.90");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-1200)).toBe("1200.00");
    expect(formatAmount(1234567.5)).toBe("1234567.50");
    expect(formatAmount(3000)).toBe("3000.00");
  });

  it("guards NaN and Infinity to 0.00", () => {
    expect(formatAmount(NaN)).toBe("0.00");
    expect(formatAmount(Infinity)).toBe("0.00");
    expect(formatAmount(-Infinity)).toBe("0.00");
  });
});

// =====================================================================================
// monthKeyOf / monthName / monthHubTitle
// =====================================================================================

describe("monthKeyOf / monthName", () => {
  it("extracts the YYYY-MM key from a date", () => {
    expect(monthKeyOf("2026-06-30")).toBe("2026-06");
    expect(monthKeyOf("2026-01-01")).toBe("2026-01");
  });

  it("maps boundary months to English names", () => {
    expect(monthName("2026-01")).toBe("January");
    expect(monthName("2026-12")).toBe("December");
    expect(monthName("2026-06")).toBe("June");
  });

  it("monthKeyOf then monthName is defined for all valid dates", () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const name = monthName(monthKeyOf(date));
        expect(name.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("monthHubTitle", () => {
  it("builds a module-prefixed, sortable basename", () => {
    expect(monthHubTitle("Finance", "2026-06")).toBe("Finance 2026-06 June");
    expect(monthHubTitle("Nutrition", "2026-06")).toBe("Nutrition 2026-06 June");
    expect(monthHubTitle("Fitness", "2026-06")).toBe("Fitness 2026-06 June");
  });

  // Requirement 8.1 — hub basenames are unique across modules.
  it("Req 8.1: Finance/Nutrition/Fitness yield distinct basenames for the same month", () => {
    fc.assert(
      fc.property(monthKeyArb, (key) => {
        const fin = monthHubTitle("Finance", key);
        const nut = monthHubTitle("Nutrition", key);
        const fit = monthHubTitle("Fitness", key);
        const set = new Set([fin, nut, fit]);
        expect(set.size).toBe(3);
        expect(fin.startsWith("Finance ")).toBe(true);
        expect(nut.startsWith("Nutrition ")).toBe(true);
        expect(fit.startsWith("Fitness ")).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// =====================================================================================
// financeTxTitle
// =====================================================================================

describe("financeTxTitle", () => {
  // Property 5 — Title determinism. Validates: Requirements 1.9
  it("P5: is deterministic", () => {
    fc.assert(
      fc.property(rawSegArb, rawSegArb, moneyArb, dateArb, (category, note, amount, date) => {
        const tx = { category, note, amount, date };
        expect(financeTxTitle(tx)).toBe(financeTxTitle(tx));
      }),
      { numRuns: 500 },
    );
  });

  // Property 4 — no marker + correct note-presence + valid filename base.
  // Validates: Requirements 1.1, 1.2, 1.3, 1.5
  it("P4: is a valid filename base with no injected income/expense marker", () => {
    fc.assert(
      fc.property(rawSegArb, rawSegArb, moneyArb, dateArb, (category, note, amount, date) => {
        // Only meaningful when the user inputs themselves don't carry those words.
        fc.pre(!/income|expense/i.test(category) && !/income|expense/i.test(note));
        const title = financeTxTitle({ category, note, amount, date });
        expect(hasInvalidChar(title)).toBe(false);
        expect(hasWhitespace(title)).toBe(false);
        expect(title.toLowerCase()).not.toContain("income");
        expect(title.toLowerCase()).not.toContain("expense");
      }),
      { numRuns: 500 },
    );
  });

  it("P4: note segment is present iff sanitizeSegment(note) is non-empty", () => {
    fc.assert(
      fc.property(rawSegArb, rawSegArb, moneyArb, dateArb, (category, note, amount, date) => {
        const title = financeTxTitle({ category, note, amount, date });
        const cat = sanitizeSegment(category) || "Other";
        const noteS = sanitizeSegment(note);
        const amt = formatAmount(amount);
        const expected = noteS
          ? [cat, noteS, amt, date].join("-")
          : [cat, amt, date].join("-");
        expect(title).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("builds representative titles and drops symbol-only notes", () => {
    expect(
      financeTxTitle({ category: "Leisure", note: "ebanx*spotify", amount: 42.9, date: "2026-06-30" }),
    ).toBe("Leisure-ebanx-spotify-42.90-2026-06-30");
    expect(
      financeTxTitle({ category: "Ar condicionado", note: "", amount: 1200, date: "2026-06-05" }),
    ).toBe("Ar-condicionado-1200.00-2026-06-05");
    expect(
      financeTxTitle({ category: "Salary", note: "Monthly salary", amount: 3000, date: "2026-06-05" }),
    ).toBe("Salary-Monthly-salary-3000.00-2026-06-05");
    // Symbol-only note dropped; empty category falls back to "Other".
    expect(
      financeTxTitle({ category: "", note: "***", amount: 9.5, date: "2026-07-01" }),
    ).toBe("Other-9.50-2026-07-01");
  });
});

// =====================================================================================
// mealLogTitle
// =====================================================================================

describe("mealLogTitle", () => {
  const kcalArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

  it("is deterministic and has shape <Meal>-<kcal>cal-<date> with a rounded integer", () => {
    fc.assert(
      fc.property(rawSegArb, kcalArb, dateArb, (mealName, kcal, date) => {
        const title = mealLogTitle({ mealName, kcal, date });
        expect(title).toBe(mealLogTitle({ mealName, kcal, date }));
        expect(title).toMatch(/-\d+cal-\d{4}-\d{2}-\d{2}$/);
        const value = Number(/-(\d+)cal-/.exec(title)?.[1]);
        expect(value).toBe(Math.max(0, Math.round(kcal)));
        expect(Number.isInteger(value)).toBe(true);
        expect(hasInvalidChar(title)).toBe(false);
        expect(hasWhitespace(title)).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("formats examples and applies fallbacks", () => {
    expect(mealLogTitle({ mealName: "Lunch", kcal: 620, date: "2026-06-30" })).toBe(
      "Lunch-620cal-2026-06-30",
    );
    expect(mealLogTitle({ mealName: "", kcal: 12.6, date: "2026-06-30" })).toBe(
      "Meal-13cal-2026-06-30",
    );
    expect(mealLogTitle({ mealName: "Café", kcal: NaN, date: "2026-06-30" })).toBe(
      "Café-0cal-2026-06-30",
    );
  });
});

// =====================================================================================
// workoutTitle
// =====================================================================================

describe("workoutTitle", () => {
  const minutesArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

  it("is deterministic and has shape <Split>-<min>min-<date> with a rounded integer", () => {
    fc.assert(
      fc.property(rawSegArb, minutesArb, dateArb, (splitName, minutes, date) => {
        const title = workoutTitle({ splitName, minutes, date });
        expect(title).toBe(workoutTitle({ splitName, minutes, date }));
        expect(title).toMatch(/-\d+min-\d{4}-\d{2}-\d{2}$/);
        const value = Number(/-(\d+)min-/.exec(title)?.[1]);
        expect(value).toBe(Math.max(0, Math.round(minutes)));
        expect(Number.isInteger(value)).toBe(true);
        expect(hasInvalidChar(title)).toBe(false);
        expect(hasWhitespace(title)).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("formats examples and applies fallbacks", () => {
    expect(workoutTitle({ splitName: "PushDay", minutes: 45, date: "2026-06-30" })).toBe(
      "PushDay-45min-2026-06-30",
    );
    expect(workoutTitle({ splitName: "", minutes: 44.4, date: "2026-06-30" })).toBe(
      "Workout-44min-2026-06-30",
    );
    // "&" is not an invalid filename char, so it is preserved (only spaces collapse to hyphens).
    expect(workoutTitle({ splitName: "Perna & Glúteo", minutes: 60, date: "2026-06-30" })).toBe(
      "Perna-&-Glúteo-60min-2026-06-30",
    );
  });
});

// =====================================================================================
// mergeBody
// =====================================================================================

describe("mergeBody", () => {
  const bodyArb = fc.array(fc.string(), { maxLength: 20 }).map((lines) => lines.join("\n"));
  const hubArb = fc
    .tuple(fc.constantFrom("Finance", "Nutrition", "Fitness"), monthKeyArb)
    .map(([m, k]) => `[[${monthHubTitle(m, k)}]]`);

  // Property 9 — Migration preserves user body lines. Validates: Requirements 4.1, 5.4, 5.5
  it("P9: preserves every non-empty user line", () => {
    fc.assert(
      fc.property(bodyArb, hubArb, (body, hub) => {
        const result = mergeBody(body, hub);
        const resultLines = result.split("\n");
        for (const line of body.split("\n")) {
          if (line.trim() !== "") expect(resultLines).toContain(line);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("P9: adds the hub link at most once", () => {
    fc.assert(
      fc.property(bodyArb, hubArb, (body, hub) => {
        const link = hub.trim();
        const countIn = body.split("\n").filter((l) => l.trim() === link).length;
        const countOut = mergeBody(body, hub).split("\n").filter((l) => l.trim() === link).length;
        expect(countOut).toBe(Math.max(1, countIn));
      }),
      { numRuns: 400 },
    );
  });

  it("P9: is an idempotent fixpoint", () => {
    fc.assert(
      fc.property(bodyArb, hubArb, (body, hub) => {
        const once = mergeBody(body, hub);
        expect(mergeBody(once, hub)).toBe(once);
      }),
      { numRuns: 400 },
    );
  });

  it("appends the link separated by a blank line when absent", () => {
    expect(mergeBody("# Leisure -42.90\n\nebanx-spotify", "[[Finance 2026-06 June]]")).toBe(
      "# Leisure -42.90\n\nebanx-spotify\n\n[[Finance 2026-06 June]]",
    );
  });

  it("is a no-op when the link is already present, preserving unknown lines", () => {
    const body = "# Leisure\n\nHub: [[Hub - Personal]]\n\n[[Finance 2026-06 June]]";
    expect(mergeBody(body, "[[Finance 2026-06 June]]")).toBe(body);
  });

  it("returns the body unchanged for an empty hub link", () => {
    expect(mergeBody("line one\nline two", "   ")).toBe("line one\nline two");
  });
});
