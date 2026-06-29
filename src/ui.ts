import { App, Modal, Notice, Setting, Menu } from "obsidian";

export function toast(msg: string): void {
  new Notice(msg);
}

export interface MenuAction {
  title: string;
  icon?: string;
  warning?: boolean;
  onClick: () => void;
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
}

/** Generic form modal that resolves to a map of field values (or null if cancelled). */
export class FormModal extends Modal {
  private fields: FieldSpec[];
  private title: string;
  private submitLabel: string;
  private onSubmit: (values: Record<string, string>) => void | Promise<void>;
  private values: Record<string, string> = {};

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

    this.fields.forEach((f) => {
      const setting = new Setting(contentEl).setName(f.label);
      switch (f.type) {
        case "textarea":
          setting.addTextArea((t) => {
            t.setValue(this.values[f.key]).onChange((v) => (this.values[f.key] = v));
            if (f.placeholder) t.setPlaceholder(f.placeholder);
            t.inputEl.rows = 4;
            t.inputEl.addClass("pa-textarea-full");
          });
          break;
        case "number":
          setting.addText((t) => {
            t.inputEl.type = "number";
            t.setValue(this.values[f.key]).onChange((v) => (this.values[f.key] = v));
          });
          break;
        case "dropdown":
          setting.addDropdown((d) => {
            (f.options || []).forEach((o) => { d.addOption(o.value, o.label); });
            d.setValue(this.values[f.key] || (f.options?.[0]?.value ?? ""))
              .onChange((v) => (this.values[f.key] = v));
          });
          break;
        case "toggle":
          setting.addToggle((tg) => {
            tg.setValue(this.values[f.key] === "true").onChange((v) => (this.values[f.key] = String(v)));
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
              b.onclick = () => { this.values[f.key] = d.e; setTrigger(); setPop(false); };
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
            t.setValue(this.values[f.key]).onChange((v) => (this.values[f.key] = v));
            if (f.placeholder) t.setPlaceholder(f.placeholder);
          });
      }
    });

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
