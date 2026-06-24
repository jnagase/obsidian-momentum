import { App, Modal, Notice, Setting } from "obsidian";

export function toast(msg: string): void {
  new Notice(msg);
}

/** Open an external link only if it's a safe http(s) URL, with noopener. */
export function openExternal(url: string): void {
  const u = (url || "").trim();
  if (/^https?:\/\//i.test(u)) {
    window.open(u, "_blank", "noopener,noreferrer");
  } else {
    new Notice("Only http(s) links can be opened.");
  }
}

export type FieldType = "text" | "textarea" | "number" | "dropdown" | "toggle";

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
  private onSubmit: (values: Record<string, string>) => void;
  private values: Record<string, string> = {};

  constructor(
    app: App,
    title: string,
    fields: FieldSpec[],
    onSubmit: (values: Record<string, string>) => void,
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
            t.inputEl.style.width = "100%";
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
            (f.options || []).forEach((o) => d.addOption(o.value, o.label));
            d.setValue(this.values[f.key] || (f.options?.[0]?.value ?? ""))
              .onChange((v) => (this.values[f.key] = v));
          });
          break;
        case "toggle":
          setting.addToggle((tg) => {
            tg.setValue(this.values[f.key] === "true").onChange((v) => (this.values[f.key] = String(v)));
          });
          break;
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
          this.onSubmit(this.values);
          this.close();
        })
      );
  }

  onClose(): void { this.contentEl.empty(); }
}

/** Simple yes/no confirmation modal. */
export class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
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
        b.setButtonText("Confirm").setWarning().onClick(() => {
          this.onConfirm();
          this.close();
        })
      );
  }

  onClose(): void { this.contentEl.empty(); }
}
