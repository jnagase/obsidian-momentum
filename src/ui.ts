import { App, Modal, Notice, Setting, Menu, SuggestModal } from "obsidian";

export function toast(msg: string): void {
  new Notice(msg);
}

export interface MenuAction {
  title: string;
  icon?: string;
  warning?: boolean;
  onClick: () => void;
}

/**
 * Append the "⇥ open in sidebar" action to a page header. It stays a <button> for keyboard
 * and screen-reader semantics but is styled as a link, so it reads as a secondary action
 * next to the real buttons instead of competing with them.
 */
export function appendSidebarBtn(parent: HTMLElement, openSidePanel: () => void): void {
  const btn = parent.createEl("button", { text: "⇥ open in sidebar", cls: "pa-link-btn pa-side-open" });
  btn.onclick = openSidePanel;
}

/** Show a kebab/context menu with the given actions at the click position. */
export function showActionMenu(evt: MouseEvent, actions: MenuAction[]): void {
  const menu = new Menu();
  actions.forEach((a) => {
    menu.addItem((item) => {
      item.setTitle(a.title);
      if (a.icon) item.setIcon(a.icon);
      if (a.warning) (item as unknown as { setWarning?: (v: boolean) => void }).setWarning?.(true);
      item.onClick(a.onClick);
    });
  });
  menu.showAtMouseEvent(evt);
}

/** Adapt an async function to a void-returning DOM event handler. */
export function asVoid(fn: () => Promise<unknown>): () => void {
  return () => { void fn(); };
}

/** Open an external link only if it's a safe http(s) URL, with noopener. */
export function openExternal(url: string): void {
  const u = (url || "").trim();
  if (/^https?:\/\//i.test(u)) {
    window.open(u, "_blank", "noopener,noreferrer");
  } else {
    new Notice("Only HTTP(s) links can be opened.");
  }
}

export type FieldType = "text" | "textarea" | "number" | "dropdown" | "toggle" | "emoji";

export const EMOJI_DATA: Array<{ e: string; k: string }> = [
  { e: "📋", k: "board clipboard list tasks" }, { e: "✅", k: "check done ok task" },
  { e: "🎯", k: "target goal habit focus" }, { e: "🚀", k: "rocket launch project startup" },
  { e: "🏠", k: "home house personal" }, { e: "☁️", k: "cloud aws sky" },
  { e: "📚", k: "books study studies learn" }, { e: "💼", k: "work briefcase business job" },
  { e: "🧠", k: "brain mind think" }, { e: "💡", k: "idea bulb light" },
  { e: "🔥", k: "fire streak hot" }, { e: "⭐", k: "star favorite" },
  { e: "💪", k: "muscle strong gym fitness" }, { e: "🏋️", k: "gym workout weight fitness lift" },
  { e: "🥗", k: "salad food nutrition healthy" }, { e: "🍎", k: "apple fruit food" },
  { e: "🥦", k: "broccoli veggie food" }, { e: "💧", k: "water drop hydration" },
  { e: "🏃", k: "run running cardio" }, { e: "🧘", k: "yoga meditation calm" },
  { e: "😴", k: "sleep rest tired" }, { e: "📖", k: "book read reading" },
  { e: "📝", k: "note write memo" }, { e: "✍️", k: "writing hand note" },
  { e: "🎓", k: "graduation study school learn" }, { e: "🌱", k: "plant grow seed nature" },
  { e: "📈", k: "chart up growth progress" }, { e: "💰", k: "money finance cash" },
  { e: "🛒", k: "cart shopping buy" }, { e: "🧹", k: "clean chores broom" },
  { e: "🐶", k: "dog pet animal" }, { e: "🐱", k: "cat pet animal" },
  { e: "☕", k: "coffee breakfast drink" }, { e: "🍽️", k: "meal lunch dinner plate food" },
  { e: "🌙", k: "moon night dinner" }, { e: "🎵", k: "music note song" },
  { e: "🎮", k: "game gaming play" }, { e: "✈️", k: "plane travel trip flight" },
  { e: "🏖️", k: "beach vacation travel" }, { e: "❤️", k: "heart love" },
  { e: "⚡", k: "energy fast bolt" }, { e: "🔧", k: "tools fix wrench" },
  { e: "🔬", k: "science research microscope" }, { e: "🌍", k: "world earth global" },
  { e: "📅", k: "calendar date schedule" }, { e: "⏰", k: "clock time alarm" },
  { e: "🎉", k: "party celebrate done" }, { e: "🙏", k: "pray gratitude thanks" },
  { e: "🚭", k: "no smoking quit" }, { e: "🩺", k: "health doctor medical" },
  { e: "🍔", k: "burger fast food meal" }, { e: "🍕", k: "pizza food meal" },
  { e: "🍗", k: "chicken protein meat food" }, { e: "🥚", k: "egg protein food" },
  { e: "🥤", k: "drink soda beverage" }, { e: "🏊", k: "swim swimming sport" },
  { e: "🚴", k: "bike cycling sport cardio" }, { e: "⚽", k: "soccer football sport" },
  { e: "🏀", k: "basketball sport" }, { e: "🎾", k: "tennis sport" },
  { e: "🧗", k: "climb climbing sport" }, { e: "🦵", k: "leg legs workout" },
  { e: "💻", k: "laptop work code computer" }, { e: "📱", k: "phone mobile" },
  { e: "✏️", k: "pencil edit write" }, { e: "📌", k: "pin backlog todo" },
  { e: "🔄", k: "progress refresh in progress loop" }, { e: "🗓️", k: "calendar planner" },
  { e: "🥩", k: "steak meat protein food" }, { e: "🍞", k: "bread carbs food" },
  { e: "🥛", k: "milk drink calcium" }, { e: "🍫", k: "chocolate snack sweet" },
  { e: "🌟", k: "star sparkle goal" }, { e: "🏆", k: "trophy win achievement" },
  { e: "📊", k: "chart stats dashboard bar" }, { e: "🧾", k: "receipt finance bill" },
];

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  value?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Optional: field is only shown while this returns true for the current form values.
   *  Omit for fields that should always be visible (default, unchanged behavior). */
  visibleWhen?: (values: Record<string, string>) => boolean;
}

/** Generic form modal that resolves to a map of field values (or null if cancelled). */
export class FormModal extends Modal {
  private fields: FieldSpec[];
  private title: string;
  private submitLabel: string;
  private onSubmit: (values: Record<string, string>) => void | Promise<void>;
  private values: Record<string, string> = {};
  private fieldEls: Array<{ field: FieldSpec; el: HTMLElement }> = [];

  constructor(
    app: App,
    title: string,
    fields: FieldSpec[],
    onSubmit: (values: Record<string, string>) => void | Promise<void>,
    submitLabel = "Save"
  ) {
    super(app);
    this.title = title;
    this.fields = fields;
    this.onSubmit = onSubmit;
    this.submitLabel = submitLabel;
    fields.forEach((f) => { this.values[f.key] = f.value == null ? "" : String(f.value); });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });

    this.fieldEls = [];
    this.fields.forEach((f) => {
      const setting = new Setting(contentEl).setName(f.label);
      this.fieldEls.push({ field: f, el: setting.settingEl });
      const onFieldChange = (v: string) => { this.values[f.key] = v; this.refreshVisibility(); };
      switch (f.type) {
        case "textarea":
          setting.addTextArea((t) => {
            t.setValue(this.values[f.key]).onChange(onFieldChange);
            if (f.placeholder) t.setPlaceholder(f.placeholder);
            t.inputEl.rows = 4;
            t.inputEl.addClass("pa-textarea-full");
          });
          break;
        case "number":
          setting.addText((t) => {
            t.inputEl.type = "number";
            t.setValue(this.values[f.key]).onChange(onFieldChange);
          });
          break;
        case "dropdown":
          setting.addDropdown((d) => {
            (f.options || []).forEach((o) => { d.addOption(o.value, o.label); });
            d.setValue(this.values[f.key] || (f.options?.[0]?.value ?? ""))
              .onChange(onFieldChange);
          });
          break;
        case "toggle":
          setting.addToggle((tg) => {
            tg.setValue(this.values[f.key] === "true").onChange((v) => onFieldChange(String(v)));
          });
          break;
        case "emoji": {
          const wrap = setting.controlEl.createDiv({ cls: "pa-emoji-field" });
          const trigger = wrap.createEl("button", { cls: "pa-emoji-trigger" });
          trigger.type = "button";
          const setTrigger = () => trigger.setText(this.values[f.key] || "🙂");
          setTrigger();
          const pop = wrap.createDiv({ cls: "pa-emoji-pop" });
          let popOpen = false;
          const setPop = (open: boolean) => { popOpen = open; if (open) pop.show(); else pop.hide(); };
          setPop(false);
          const search = pop.createEl("input", { cls: "pa-emoji-search" });
          search.placeholder = "Search emoji…";
          const grid = pop.createDiv({ cls: "pa-emoji-grid" });
          const renderGrid = (q: string) => {
            grid.empty();
            const ql = q.trim().toLowerCase();
            EMOJI_DATA.filter((d) => !ql || d.k.includes(ql) || d.e === ql).forEach((d) => {
              const b = grid.createEl("button", { text: d.e, cls: "pa-emoji-btn" });
              b.type = "button";
              b.onclick = () => { onFieldChange(d.e); setTrigger(); setPop(false); };
            });
          };
          renderGrid("");
          search.oninput = () => renderGrid(search.value);
          trigger.onclick = () => {
            setPop(!popOpen);
            if (popOpen) { search.value = ""; renderGrid(""); search.focus(); }
          };
          break;
        }
        default:
          setting.addText((t) => {
            t.setValue(this.values[f.key]).onChange(onFieldChange);
            if (f.placeholder) t.setPlaceholder(f.placeholder);
          });
      }
    });
    this.refreshVisibility();

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(this.submitLabel).setCta().onClick(() => {
          void this.onSubmit(this.values);
          this.close();
        })
      );

    // Let the emoji popover float outside the modal box instead of being clipped.
    if (this.fields.some((f) => f.type === "emoji")) {
      this.modalEl.addClass("pa-modal-overflow-visible");
      this.contentEl.addClass("pa-modal-overflow-visible");
    }
  }

  /** Re-evaluates every field's `visibleWhen` against the current values and toggles its
   *  Setting row's visibility accordingly. No full re-render, no lost focus/cursor in
   *  other inputs — fields with no `visibleWhen` are always visible (unchanged behavior). */
  private refreshVisibility(): void {
    this.fieldEls.forEach(({ field, el }) => {
      const visible = !field.visibleWhen || field.visibleWhen(this.values);
      el.toggleClass("pa-hidden", !visible);
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

/** One row of a {@link SearchModal}: what to match on, and what to show. */
export interface SearchItem<T> {
  value: T;
  /** Text the query is matched against (title + board + group, for example). */
  haystack: string;
  title: string;
  subtitle?: string;
}

/**
 * Generic search palette (Obsidian's own suggest UI, so keyboard nav and theming come free).
 * Matching is a simple case-insensitive AND of the query's words, which beats substring
 * matching for finding a card by a couple of remembered words.
 */
export class SearchModal<T> extends SuggestModal<SearchItem<T>> {
  private items: SearchItem<T>[];
  private onPick: (value: T) => void;

  constructor(app: App, placeholder: string, items: SearchItem<T>[], onPick: (value: T) => void) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): SearchItem<T>[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.items.slice(0, 50);
    return this.items.filter((it) => {
      const hay = it.haystack.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 50);
  }

  renderSuggestion(item: SearchItem<T>, el: HTMLElement): void {
    el.createDiv({ text: item.title, cls: "pa-search-title" });
    if (item.subtitle) el.createDiv({ text: item.subtitle, cls: "pa-search-sub" });
  }

  onChooseSuggestion(item: SearchItem<T>): void {
    this.onPick(item.value);
  }
}

/** A numbered how-to modal: intro, ordered steps, optional note and a primary action. */
export class StepsModal extends Modal {
  private opts: {
    title: string;
    intro?: string;
    steps: string[];
    note?: string;
    primary?: { label: string; onClick: () => void };
  };

  constructor(app: App, opts: StepsModal["opts"]) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.opts.title });
    if (this.opts.intro) contentEl.createEl("p", { text: this.opts.intro, cls: "pa-steps-intro" });
    const ol = contentEl.createEl("ol", { cls: "pa-steps-list" });
    this.opts.steps.forEach((s) => ol.createEl("li", { text: s }));
    if (this.opts.note) contentEl.createEl("p", { text: this.opts.note, cls: "pa-steps-note" });

    const row = new Setting(contentEl);
    if (this.opts.primary) {
      const p = this.opts.primary;
      row.addButton((b) => b.setButtonText(p.label).setCta().onClick(() => { this.close(); p.onClick(); }));
    }
    row.addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }

  onClose(): void { this.contentEl.empty(); }
}

/** Simple yes/no confirmation modal. */
export class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void | Promise<void>;

  constructor(app: App, message: string, onConfirm: () => void | Promise<void>) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Confirm").setCta().onClick(() => {
          void this.onConfirm();
          this.close();
        })
      );
  }

  onClose(): void { this.contentEl.empty(); }
}
