/** Local-timezone date helpers (match the web app's todayLocal/_htFmt). */

export function ymd(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function todayLocal(): string {
  return ymd(new Date());
}

/** Days between two YYYY-MM-DD strings (b - a), floored at 0. */
export function daysBetween(aStr: string, bStr: string): number {
  const a = new Date(aStr + "T00:00:00");
  const b = new Date(bStr + "T00:00:00");
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff >= 0 ? diff : 0;
}
