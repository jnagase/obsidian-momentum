import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";

export const VIEW_TYPE_QUICK = "momentum-quick-access";

/** Pin persistence — the view reads/writes vault-relative paths (a pin is a path reference). */
export interface QuickAccessConfig {
  getPins: () => string[];
  setPins: (paths: string[]) => Promise<void>;
}

/** Relative time label ("2h atrás", "ontem"). */
function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `${d}d atrás`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Quick-access "home" tab. Stacked sections (research: Windows 11 Home / Finder / Drive):
 *   1. Fixados — user-curated grid of cards (pins persisted in data.json, stable)
 *   2. Recentes — auto list from workspace.getLastOpenFiles() (dynamic, recency-first)
 *   3. Métricas — file-type breakdown as a CSS stacked bar + counts
 * Curated (pins) and automatic (recents) are kept visually separate, per the research.
 */
export class QuickAccessView extends ItemView {
  private cfg: QuickAccessConfig;
  private bodyEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, cfg: QuickAccessConfig) {
    super(leaf);
    this.cfg = cfg;
  }

  getViewType(): string { return VIEW_TYPE_QUICK; }
  getDisplayText(): string { return "Acesso rápido"; }
  getIcon(): string { return "star"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-quick-root");
    root.createEl("h3", { text: "⭐ Acesso rápido" });
    this.bodyEl = root.createDiv();
    this.render();
    // Refresh recents when the active file changes.
    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
  }

  private render(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.renderMetrics();
    this.renderPinned();
    this.renderRecents();
  }

  // ---- métricas: file-type breakdown (CSS stacked bar) --------------------------------
  private renderMetrics(): void {
    const files = this.app.vault.getFiles();
    const byType = new Map<string, number>();
    for (const f of files) {
      const ext = f.extension.toLowerCase() || "?";
      byType.set(ext, (byType.get(ext) ?? 0) + 1);
    }
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const total = files.length || 1;
    const palette = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#0ea5e9"];

    const sec = this.bodyEl!.createDiv({ cls: "pa-quick-sec" });
    sec.createEl("div", { cls: "pa-quick-sec-title", text: `Vault — ${files.length} arquivos` });
    const bar = sec.createDiv({ cls: "pa-quick-bar" });
    top.forEach(([ext, n], i) => {
      const seg = bar.createDiv({ cls: "pa-quick-bar-seg" });
      seg.style.width = `${(n / total) * 100}%`;
      seg.style.background = palette[i % palette.length];
      seg.title = `${ext}: ${n}`;
    });
    const legend = sec.createDiv({ cls: "pa-quick-legend" });
    top.forEach(([ext, n], i) => {
      const item = legend.createSpan({ cls: "pa-quick-legend-item" });
      const dot = item.createSpan({ cls: "pa-quick-dot" });
      dot.style.background = palette[i % palette.length];
      item.createSpan({ text: ` ${ext} ${n}` });
    });
  }

  // ---- fixados: curated grid of cards -------------------------------------------------
  private renderPinned(): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-quick-sec" });
    sec.createEl("div", { cls: "pa-quick-sec-title", text: "📌 Fixados" });
    const pins = this.cfg.getPins();
    if (pins.length === 0) {
      sec.createEl("p", { cls: "pa-drive-muted", text: "Nada fixado ainda. Abra um arquivo e clique em 📌 na lista de recentes." });
      return;
    }
    const grid = sec.createDiv({ cls: "pa-quick-grid" });
    for (const path of pins) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const card = grid.createDiv({ cls: "pa-quick-card" });
      const stale = !(file instanceof TFile);
      const iconEl = card.createDiv({ cls: "pa-quick-card-icon" });
      setIcon(iconEl, stale ? "alert-triangle" : "file-text");
      card.createDiv({ cls: "pa-quick-card-name", text: path.split("/").pop() ?? path });
      if (stale) {
        card.addClass("stale");
        card.title = "Arquivo não encontrado (movido/apagado). Clique para desafixar.";
        card.onclick = () => void this.togglePin(path);
      } else {
        card.onclick = () => void this.app.workspace.getLeaf(false).openFile(file as TFile);
      }
      const unpin = card.createEl("button", { cls: "pa-quick-unpin", text: "×" });
      unpin.title = "Desafixar (não apaga o arquivo)";
      unpin.onclick = (e) => { e.stopPropagation(); void this.togglePin(path); };
    }
  }

  // ---- recentes: dynamic list from getLastOpenFiles() ---------------------------------
  private renderRecents(): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-quick-sec" });
    sec.createEl("div", { cls: "pa-quick-sec-title", text: "🕘 Recentes" });
    const recents = this.app.workspace.getLastOpenFiles().slice(0, 12);
    if (recents.length === 0) { sec.createEl("p", { cls: "pa-drive-muted", text: "Sem arquivos recentes." }); return; }
    const pins = new Set(this.cfg.getPins());
    const list = sec.createDiv({ cls: "pa-quick-list" });
    for (const path of recents) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const row = list.createDiv({ cls: "pa-quick-listrow" });
      const name = row.createEl("a", { cls: "pa-quick-listname", text: file.basename, href: "#" });
      name.onclick = (e) => { e.preventDefault(); void this.app.workspace.getLeaf(false).openFile(file); };
      row.createSpan({ cls: "pa-quick-listmeta", text: relTime(file.stat.mtime) });
      const pin = row.createEl("button", { cls: "pa-quick-pin", text: pins.has(path) ? "📌" : "📍" });
      pin.title = pins.has(path) ? "Desafixar" : "Fixar";
      pin.onclick = () => void this.togglePin(path);
    }
  }

  private async togglePin(path: string): Promise<void> {
    const pins = this.cfg.getPins().slice();
    const i = pins.indexOf(path);
    if (i >= 0) pins.splice(i, 1); else pins.push(path);
    await this.cfg.setPins(pins);
    this.render();
  }
}
