import { html, raw, type Html } from './html';

/**
 * Diagramme als SVG, auf dem Server gezeichnet. Wie in der App: Balken für
 * Kennzahlen mit echtem Nullpunkt, Punkte für Tempo und Gefühl. Ein Balken ist
 * ein Link; der gewählte ist grün und seine Details stehen darunter.
 * Fehlende Werte bleiben eine Lücke, nie eine Null.
 */

export interface BarPoint {
  key: string;
  label: string;
  fullLabel: string;
  value: number | null;
  href: string;
  readout: string;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

export function bucketChart(
  points: BarPoint[],
  {
    shape,
    selected,
    title,
  }: { shape: 'bar' | 'point'; selected: string | null; title: string },
): Html {
  const values = points
    .map(point => point.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (!points.length) return html``;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / points.length;
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  // Punkte brauchen keinen Nullpunkt; die Spanne zeigt die Unterschiede.
  const low =
    shape === 'bar' ? 0 : min - (max - min || Math.abs(max) * 0.1 || 1) * 0.15;
  const high =
    shape === 'bar'
      ? max || 1
      : max + (max - min || Math.abs(max) * 0.1 || 1) * 0.15;
  const y = (value: number) =>
    PAD.top + innerH - ((value - low) / (high - low || 1)) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const compactEvery = Math.max(1, Math.ceil(points.length / 4));
  const marks = points.map((point, index) => {
    const x = PAD.left + slot * index;
    const isSelected = point.key === selected;
    let mark: Html = html``;
    if (point.value !== null && Number.isFinite(point.value)) {
      if (shape === 'bar') {
        const top = y(point.value);
        const width = Math.max(2, slot * 0.64);
        mark = html`<rect
          class="bar${isSelected ? ' selected' : ''}"
          x="${(x + (slot - width) / 2).toFixed(1)}"
          y="${top.toFixed(1)}"
          width="${width.toFixed(1)}"
          height="${Math.max(1, PAD.top + innerH - top).toFixed(1)}"
          rx="3"
        ></rect>`;
      } else {
        mark = html`<circle
          class="point${isSelected ? ' selected' : ''}"
          cx="${(x + slot / 2).toFixed(1)}"
          cy="${y(point.value).toFixed(1)}"
          r="5"
        ></circle>`;
      }
    }
    const desktopLabel = index % labelEvery === 0;
    const compactLabel = index % compactEvery === Math.floor(compactEvery / 2);
    const label =
      desktopLabel || compactLabel
        ? html`<text
            class="${compactLabel
              ? 'compact-label'
              : 'desktop-label'}${desktopLabel ? '' : ' mobile-only'}"
            x="${(x + slot / 2).toFixed(1)}"
            y="${H - 8}"
            text-anchor="middle"
            >${point.label}</text
          >`
        : null;
    return html`<a
      href="${point.href}"
      aria-label="${point.fullLabel}: ${point.readout}"
      ><title>${point.fullLabel}: ${point.readout}</title
      ><rect
        x="${x.toFixed(1)}"
        y="0"
        width="${slot.toFixed(1)}"
        height="${H}"
        fill="transparent"
      ></rect
      >${mark}${label}</a
    >`;
  });
  return html`<svg
    class="chart bucket-chart"
    viewBox="0 0 ${W} ${H}"
    role="group"
    aria-label="${title} je Zeitraum, ${points.length} Werte"
  >
    <line
      class="grid-line"
      x1="${PAD.left}"
      x2="${W - PAD.right}"
      y1="${PAD.top + innerH}"
      y2="${PAD.top + innerH}"
    ></line>
    ${marks}
  </svg>`;
}

export interface LineSeries {
  /** x in Metern oder Sekunden. */
  points: { x: number; y: number | undefined }[];
  className?: string;
  /** Tempo: schneller ist oben. */
  invert?: boolean;
  label: string;
  format: (value: number) => string;
  average?: number;
}

/** Verlauf eines Laufs über die Strecke; Lücken bleiben Lücken. */
export function lineChart(
  series: LineSeries,
  xLabel: (x: number) => string,
): Html {
  const defined = series.points.filter(
    p => p.y !== undefined && Number.isFinite(p.y),
  ) as { x: number; y: number }[];
  if (defined.length < 2) return html``;
  const height = 180;
  const innerW = W - PAD.left - PAD.right - 48;
  const innerH = height - PAD.top - PAD.bottom;
  const xs = series.points.map(p => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  // Ausreißer (Stehen an der Ampel) sollen die Achse nicht sprengen.
  const sorted = defined.map(p => p.y).sort((a, b) => a - b);
  const q = (f: number) =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.round(f * (sorted.length - 1))),
      )
    ];
  let low = q(0.02);
  let high = q(0.98);
  if (high - low < 1e-6) {
    low -= 1;
    high += 1;
  }
  const pad = (high - low) * 0.1;
  low -= pad;
  high += pad;
  const px = (x: number) =>
    PAD.left + 48 + ((x - minX) / (maxX - minX || 1)) * innerW;
  const py = (value: number) => {
    const clamped = Math.max(low, Math.min(high, value));
    const fraction = (clamped - low) / (high - low);
    return PAD.top + (series.invert ? fraction : 1 - fraction) * innerH;
  };
  let d = '';
  let open = false;
  series.points.forEach(point => {
    if (point.y === undefined || !Number.isFinite(point.y)) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${px(point.x).toFixed(1)},${py(point.y).toFixed(
      1,
    )}`;
    open = true;
  });
  const ticks = [low + pad, (low + high) / 2, high - pad];
  const xTicks = [minX, (minX + maxX) / 2, maxX];
  return html`<svg
    class="chart"
    viewBox="0 0 ${W} ${height}"
    role="img"
    aria-label="${series.label} über die Strecke"
  >
    ${ticks.map(
      tick =>
        html`<line
            class="grid-line"
            x1="${PAD.left + 48}"
            x2="${W - PAD.right}"
            y1="${py(tick).toFixed(1)}"
            y2="${py(tick).toFixed(1)}"
          ></line
          ><text
            x="${PAD.left + 40}"
            y="${(py(tick) + 4).toFixed(1)}"
            text-anchor="end"
            >${series.format(tick)}</text
          >`,
    )}${series.average !== undefined
      ? html`<line
          class="avg"
          x1="${PAD.left + 48}"
          x2="${W - PAD.right}"
          y1="${py(series.average).toFixed(1)}"
          y2="${py(series.average).toFixed(1)}"
        ></line>`
      : null}
    <path
      class="line${series.className ? ` ${series.className}` : ''}"
      d="${raw(d)}"
    ></path>
    ${xTicks.map(
      (tick, index) =>
        html`<text
          x="${px(tick).toFixed(1)}"
          y="${height - 8}"
          text-anchor="${index === 0
            ? 'start'
            : index === 2
            ? 'end'
            : 'middle'}"
          >${xLabel(tick)}</text
        >`,
    )}
  </svg>`;
}

/** Strecke als Linie ohne Kartenkacheln: keine Koordinate geht an einen Kartendienst. */
export function routeShape(
  points: { latitude: number; longitude: number; gap?: boolean }[],
): Html {
  if (points.length < 2) return html``;
  const lat0 = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map(p => p.longitude * kx);
  const ys = points.map(p => -p.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = 320;
  const pad = 16;
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY, 1e-9);
  const offX = (size - (maxX - minX) * scale) / 2;
  const offY = (size - (maxY - minY) * scale) / 2;
  const x = (i: number) => (offX + (xs[i] - minX) * scale).toFixed(1);
  const y = (i: number) => (offY + (ys[i] - minY) * scale).toFixed(1);
  let d = '';
  points.forEach((point, i) => {
    d += `${i === 0 || point.gap ? 'M' : 'L'}${x(i)},${y(i)}`;
  });
  const last = points.length - 1;
  return html`<svg
    class="route"
    viewBox="0 0 ${size} ${size}"
    role="img"
    aria-label="Form der Strecke"
    width="100%"
    style="max-width:${size}px"
  >
    <path d="${raw(d)}"></path>
    <circle cx="${x(0)}" cy="${y(0)}" r="5"></circle>
    <circle cx="${x(last)}" cy="${y(last)}" r="5" opacity="0.5"></circle>
  </svg>`;
}
