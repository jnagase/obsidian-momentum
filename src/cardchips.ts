/**
 * Shared card chip renderer — used by Tasks and Studies so both show the same
 * priority pill and date chip styling.
 */

/** Urgency class for a due/created date chip. */
export function dateUrgency(due: string): string {
  const d = new Date(due + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "pa-chip-overdue";
  if (diff <= 2) return "pa-chip-soon";
  return "";
}

/** Format a YYYY-MM-DD string into a human-readable label. */
export function formatDateNice(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");
  if (isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getDate();
  const year = date.getFullYear();
  return year === today.getFullYear()
    ? `${months[date.getMonth()]} ${day}`
    : `${months[date.getMonth()]} ${day}, ${year}`;
}

/**
 * Render the priority + date chips row at the bottom of any card.
 * `priority`: "low" | "medium" | "high" (or empty — defaults to medium).
 * `due`: YYYY-MM-DD due date (used for urgency coloring).
 * `created`: YYYY-MM-DD fallback date when no due date exists.
 */
export function renderCardChips(card: HTMLElement, opts: {
  priority?: string;
  due?: string;
  created?: string;
}): void {
  const chips = card.createDiv({ cls: "pa-card-chips" });

  // Priority chip (always shown), colored by level.
  const prio = opts.priority || "medium";
  chips.createSpan({ cls: `pa-chip pa-chip-prio prio-${prio}`, text: prio.charAt(0).toUpperCase() + prio.slice(1) });

  // Date chip: prefer due date, fall back to created.
  const hasDue = !!opts.due;
  const dateStr = formatDateNice(opts.due || opts.created || "");
  if (dateStr) {
    const cls = ["pa-chip", "pa-chip-date"];
    if (hasDue) {
      const urg = dateUrgency(opts.due || "");
      if (urg) cls.push(urg);
    }
    const chip = chips.createSpan({ cls: cls.join(" ") });
    chip.createSpan({ cls: "pa-chip-ico", text: "📅" });
    chip.createSpan({ text: dateStr });
  }
}
