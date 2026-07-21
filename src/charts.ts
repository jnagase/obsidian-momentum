// Lightweight inline-SVG charts. No external dependencies, theme-aware.

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = activeDocument.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** A circular progress ring with a centered percentage and an optional label. */
export function drawRing(
  parent: HTMLElement,
  percent: number,
  color: string,
  label?: string,
  size = 66
): void {
  const wrap = parent.createDiv({ cls: "pa-ring" });
  const r = (size - 10) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = circ * (1 - pct / 100);

  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(svgEl("circle", {
    cx, cy: cx, r, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": 7,
  }));
  const arc = svgEl("circle", {
    cx, cy: cx, r, fill: "none", stroke: color, "stroke-width": 7, "stroke-linecap": "round",
    "stroke-dasharray": circ, "stroke-dashoffset": offset,
    transform: `rotate(-90 ${cx} ${cx})`,
  });
  svg.appendChild(arc);
  const text = svgEl("text", {
    x: cx, y: cx, "text-anchor": "middle", "dominant-baseline": "central",
    "font-size": 14, "font-weight": 700, fill: "var(--text-normal)",
  });
  text.textContent = pct + "%";
  svg.appendChild(text);
  wrap.appendChild(svg);
  if (label) wrap.createDiv({ text: label, cls: "pa-ring-label" });
}

/** A simple vertical bar chart. */
export function drawBars(
  parent: HTMLElement,
  data: Array<{ label: string; value: number }>,
  max: number,
  color: string,
  height = 120
): void {
  const wrap = parent.createDiv({ cls: "pa-bars" });
  const w = Math.max(data.length * 44, 120);
  const barW = 26;
  const gap = (w - data.length * barW) / (data.length + 1);
  const top = 8;
  const chartH = height - 24;
  const svg = svgEl("svg", { width: "100%", height, viewBox: `0 0 ${w} ${height}` });
  svg.setAttribute("preserveAspectRatio", "none");

  data.forEach((d, i) => {
    const x = gap + i * (barW + gap);
    const h = max > 0 ? Math.round((d.value / max) * chartH) : 0;
    const y = top + (chartH - h);
    svg.appendChild(svgEl("rect", { x, y, width: barW, height: h, rx: 4, fill: color }));
    const val = svgEl("text", { x: x + barW / 2, y: y - 3, "text-anchor": "middle", "font-size": 9, fill: "var(--text-muted)" });
    val.textContent = String(d.value);
    svg.appendChild(val);
    const lab = svgEl("text", { x: x + barW / 2, y: height - 4, "text-anchor": "middle", "font-size": 9, fill: "var(--text-muted)" });
    lab.textContent = d.label;
    svg.appendChild(lab);
  });
  wrap.appendChild(svg);
}

/** A multi-segment donut chart with a centered total and a legend. */
export function drawDonut(
  parent: HTMLElement,
  segments: Array<{ label: string; value: number; color: string }>,
  size = 150,
  format?: (n: number) => string,
  centerFormat?: (n: number) => string
): void {
  const fmt = format ?? ((n: number) => String(n));
  const centerFmt = centerFormat ?? fmt;
  const wrap = parent.createDiv({ cls: "pa-donut-wrap" });
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - 22) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;

  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  if (!total) {
    svg.appendChild(svgEl("circle", { cx, cy: cx, r, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": 16 }));
  } else {
    let cumulative = 0;
    segments.forEach((s) => {
      if (s.value <= 0) return;
      const segLen = (s.value / total) * circ;
      const arc = svgEl("circle", {
        cx, cy: cx, r, fill: "none", stroke: s.color, "stroke-width": 16,
        "stroke-dasharray": `${segLen} ${circ - segLen}`,
        "stroke-dashoffset": -cumulative,
        transform: `rotate(-90 ${cx} ${cx})`,
      });
      svg.appendChild(arc);
      cumulative += segLen;
    });
  }
  const totalText = svgEl("text", { x: cx, y: cx - 4, "text-anchor": "middle", "dominant-baseline": "central", "font-size": centerFormat ? 17 : (format ? 13 : 22), "font-weight": 700, fill: "var(--text-normal)" });
  totalText.textContent = centerFmt(total);
  svg.appendChild(totalText);
  const labelText = svgEl("text", { x: cx, y: cx + 14, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "var(--text-muted)" });
  labelText.textContent = "Total";
  svg.appendChild(labelText);
  wrap.appendChild(svg);

  const legend = wrap.createDiv({ cls: "pa-donut-legend" });
  segments.filter((s) => s.value > 0).forEach((s) => {
    const item = legend.createDiv({ cls: "pa-legend-item" });
    const dot = item.createSpan({ cls: "pa-legend-dot" });
    dot.style.background = s.color;
    item.createSpan({ text: `${s.label} (${fmt(s.value)})` });
  });
}

/** A line sparkline for a series of numeric values. */
export function drawSparkline(
  parent: HTMLElement,
  values: number[],
  color: string,
  height = 80
): void {
  const wrap = parent.createDiv({ cls: "pa-spark" });
  if (values.length < 2) {
    wrap.createDiv({ cls: "pa-muted", text: "Not enough data yet." });
    return;
  }
  const w = 280;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const svg = svgEl("svg", { width: "100%", height, viewBox: `0 0 ${w} ${height}` });
  svg.setAttribute("preserveAspectRatio", "none");
  const poly = svgEl("polyline", { fill: "none", stroke: color, "stroke-width": 2, points: points.join(" ") });
  svg.appendChild(poly);
  values.forEach((v, i) => {
    const [x, y] = points[i].split(",");
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 2.5, fill: color }));
  });
  wrap.appendChild(svg);
}

export interface LineSeries {
  name: string;
  color: string;
  values: Array<number | null>;
}

/** A multi-series line chart with axis labels, an optional dashed goal line and a legend. */
export function drawLineChart(
  parent: HTMLElement,
  labels: string[],
  series: LineSeries[],
  opts: { goal?: number; goalColor?: string; height?: number } = {}
): void {
  const wrap = parent.createDiv({ cls: "pa-linechart" });
  const height = opts.height ?? 220;
  if (!labels.length || !series.length) {
    wrap.createDiv({ cls: "pa-muted", text: "Not enough data yet." });
    return;
  }
  const w = 520;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 26;

  let max = opts.goal ?? 0;
  let min = Infinity;
  series.forEach((s) => s.values.forEach((v) => { if (v != null) { if (v > max) max = v; if (v < min) min = v; } }));
  if (!isFinite(min)) min = 0;
  min = Math.min(min, 0);
  if (max <= min) max = min + 1;

  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (i: number) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH * (1 - (v - min) / (max - min));

  const svg = svgEl("svg", { width: "100%", height, viewBox: `0 0 ${w} ${height}` });

  // Y gridlines + labels (4 steps)
  for (let g = 0; g <= 4; g++) {
    const val = min + ((max - min) * g) / 4;
    const y = yAt(val);
    svg.appendChild(svgEl("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: "var(--background-modifier-border)", "stroke-width": 1 }));
    const lab = svgEl("text", { x: padL - 4, y, "text-anchor": "end", "dominant-baseline": "central", "font-size": 9, fill: "var(--text-muted)" });
    lab.textContent = String(Math.round(val));
    svg.appendChild(lab);
  }

  // Goal line
  if (opts.goal != null) {
    const y = yAt(opts.goal);
    svg.appendChild(svgEl("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: opts.goalColor || "#dc2626", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
  }

  // X labels
  labels.forEach((lab, i) => {
    const t = svgEl("text", { x: xAt(i), y: height - 8, "text-anchor": "middle", "font-size": 9, fill: "var(--text-muted)" });
    t.textContent = lab;
    svg.appendChild(t);
  });

  // Series
  series.forEach((s) => {
    const pts: string[] = [];
    s.values.forEach((v, i) => { if (v != null) pts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`); });
    if (pts.length) {
      svg.appendChild(svgEl("polyline", { fill: "none", stroke: s.color, "stroke-width": 2, points: pts.join(" ") }));
      s.values.forEach((v, i) => { if (v != null) svg.appendChild(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 2.5, fill: s.color })); });
    }
  });

  wrap.appendChild(svg);

  if (series.length > 1 || series[0]?.name) {
    const legend = wrap.createDiv({ cls: "pa-donut-legend" });
    series.forEach((s) => {
      const item = legend.createDiv({ cls: "pa-legend-item" });
      const dot = item.createSpan({ cls: "pa-legend-dot" });
      dot.style.background = s.color;
      item.createSpan({ text: s.name });
    });
  }
}

export interface ScatterPoint {
  x: number; // 0..1 (left..right)
  y: number; // 0..1 (bottom..top)
  color: string;
  title: string;
  onClick?: () => void;
}

/** A 2x2 quadrant scatter plot (used for the Eisenhower chart). x/y are 0..1. */
export function drawScatter(
  parent: HTMLElement,
  points: ScatterPoint[],
  opts: { xLabel?: string; yLabel?: string; corners?: [string, string, string, string]; height?: number } = {}
): void {
  const wrap = parent.createDiv({ cls: "pa-scatter" });
  const height = opts.height ?? 300;
  const w = 420;
  const padL = 30, padR = 14, padT = 14, padB = 28;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const x0 = padL, y0 = padT, x1 = padL + plotW, y1 = padT + plotH;
  const midX = padL + plotW / 2, midY = padT + plotH / 2;

  const svg = svgEl("svg", { width: "100%", height, viewBox: `0 0 ${w} ${height}` });

  // Quadrant tints: [top-right, top-left, bottom-right, bottom-left]
  const tints = [
    { x: midX, y: y0, w: x1 - midX, h: midY - y0, color: "#ef4444" },
    { x: x0, y: y0, w: midX - x0, h: midY - y0, color: "#3b82f6" },
    { x: midX, y: midY, w: x1 - midX, h: y1 - midY, color: "#f59e0b" },
    { x: x0, y: midY, w: midX - x0, h: y1 - midY, color: "#6b7280" },
  ];
  tints.forEach((r) => svg.appendChild(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: r.color, "fill-opacity": 0.08 })));

  svg.appendChild(svgEl("rect", { x: x0, y: y0, width: plotW, height: plotH, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": 1 }));
  svg.appendChild(svgEl("line", { x1: midX, y1: y0, x2: midX, y2: y1, stroke: "var(--background-modifier-border)", "stroke-width": 1, "stroke-dasharray": "4 4" }));
  svg.appendChild(svgEl("line", { x1: x0, y1: midY, x2: x1, y2: midY, stroke: "var(--background-modifier-border)", "stroke-width": 1, "stroke-dasharray": "4 4" }));

  const corners = opts.corners ?? ["Do first", "Schedule", "Delegate", "Eliminate"];
  const corner = (text: string, tx: number, ty: number, anchor: string) => {
    const el = svgEl("text", { x: tx, y: ty, "text-anchor": anchor, "font-size": 9, "font-weight": 700, fill: "var(--text-muted)" });
    el.textContent = text;
    svg.appendChild(el);
  };
  corner(corners[0], x1 - 4, y0 + 12, "end");
  corner(corners[1], x0 + 4, y0 + 12, "start");
  corner(corners[2], x1 - 4, y1 - 5, "end");
  corner(corners[3], x0 + 4, y1 - 5, "start");

  const xlab = svgEl("text", { x: midX, y: height - 5, "text-anchor": "middle", "font-size": 10, fill: "var(--text-muted)" });
  xlab.textContent = opts.xLabel ?? "";
  svg.appendChild(xlab);
  const ylab = svgEl("text", { x: 10, y: midY, "text-anchor": "middle", "font-size": 10, fill: "var(--text-muted)", transform: `rotate(-90 10 ${midY})` });
  ylab.textContent = opts.yLabel ?? "";
  svg.appendChild(ylab);

  points.forEach((p) => {
    const cx = x0 + Math.max(0, Math.min(1, p.x)) * plotW;
    const cy = y1 - Math.max(0, Math.min(1, p.y)) * plotH;
    const attrs: Record<string, string | number> = { cx, cy, r: 6, fill: p.color, "fill-opacity": 0.85, stroke: "var(--background-primary)", "stroke-width": 1.5 };
    if (p.onClick) attrs.class = "pa-scatter-dot";
    const dot = svgEl("circle", attrs);
    const title = svgEl("title", {});
    title.textContent = p.title;
    dot.appendChild(title);
    if (p.onClick) dot.addEventListener("click", p.onClick);
    svg.appendChild(dot);
  });

  wrap.appendChild(svg);
}
