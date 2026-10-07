import { html, join, raw, type Child, type Html } from './html';

/**
 * Bausteine der Website mit denselben Namen und Regeln wie in
 * `src/ui/components.tsx`: ein Titel je Seite, eine Aussage je Fläche,
 * Nebenwege eingeklappt. Interaktion ohne JavaScript: Auswahl ist ein Link,
 * Aktionen sind Formulare.
 */

export type TabName = 'Plan' | 'Verlauf' | 'Statistik' | 'Coach' | 'Daten';
export const TABS: { name: TabName; href: string }[] = [
  { name: 'Verlauf', href: '/verlauf' },
  { name: 'Statistik', href: '/statistik' },
  { name: 'Plan', href: '/plan' },
  { name: 'Coach', href: '/coach' },
  { name: 'Daten', href: '/daten' },
];

export interface PageOptions {
  title: string;
  tab?: TabName;
  /** Steht rechts im Kopf: wann das Telefon zuletzt übertragen hat. */
  status?: { label: string; stale: boolean } | null;
  narrow?: boolean;
}

export function page(options: PageOptions, body: Child): Html {
  const status = options.status;
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>${options.title} · Runback</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="header">
  <div class="header-inner">
    <a class="brand" href="/verlauf">runback<span class="brand-mark"> /</span></a>
    ${
      options.tab
        ? html`<nav class="tabs" aria-label="Bereiche">
            ${TABS.map(
              tab =>
                html`<a
                  class="tab"
                  href="${tab.href}"
                  ${raw(tab.name === options.tab ? ' aria-current="page"' : '')}
                  >${tab.name}</a
                >`,
            )}
          </nav>`
        : html`<span class="tabs"></span>`
    }
    ${
      status
        ? html`<span class="header-status"
            ><span
              class="dot${status.stale ? ' stale' : ''}"
              aria-hidden="true"
            ></span
            >${status.label}</span
          >`
        : null
    }
  </div>
</header>
<main${raw(options.narrow ? ' class="narrow"' : '')}>
${body}
</main>
</body>
</html>`;
}

export const title = (text: string) => html`<h1 class="title">${text}</h1>`;

export const copy = (text: Child, muted = false) =>
  html`<p class="copy${muted ? ' muted' : ''}">${text}</p>`;

export const section = (heading: string | null, body: Child) =>
  html`<section class="section">
    ${heading ? html`<h2 class="section-title">${heading}</h2>` : null}${body}
  </section>`;

export const card = (
  body: Child,
  { accent = false, label }: { accent?: boolean; label?: Child } = {},
) =>
  html`<div class="card${accent ? ' accent' : ''}">
    ${label ? html`<span class="card-label">${label}</span>` : null}${body}
  </div>`;

export function row({
  title: rowTitle,
  subtitle,
  value,
  href,
}: {
  title: Child;
  subtitle?: Child;
  value?: Child;
  href?: string;
}): Html {
  const inner = html`<span class="row-text"
      ><span class="row-title">${rowTitle}</span>${subtitle
        ? html`<span class="row-subtitle">${subtitle}</span>`
        : null}</span
    >${value !== undefined && value !== null
      ? html`<span class="row-value">${value}</span>`
      : null}${href
      ? html`<span class="chevron" aria-hidden="true">›</span>`
      : null}`;
  return href
    ? html`<a class="row" href="${href}">${inner}</a>`
    : html`<div class="row">${inner}</div>`;
}

export const stat = (value: Child, label: Child, delta?: Child) =>
  html`<div class="stat">
    <span class="stat-value">${value}</span
    ><span class="stat-label">${label}</span>${delta
      ? html`<span class="stat-delta">${delta}</span>`
      : null}
  </div>`;

export const badge = (
  text: string,
  tone: 'green' | 'muted' | 'danger' = 'green',
) =>
  html`<span class="badge${tone === 'green' ? '' : ` ${tone}`}">${text}</span>`;

export const notice = (
  heading: string,
  body: Child,
  tone: 'green' | 'caution' | 'danger' = 'green',
) =>
  html`<div
    class="notice${tone === 'green' ? '' : ` ${tone}`}"
    role="${tone === 'danger' ? 'alert' : 'status'}"
  >
    <span class="notice-title">${heading}</span><span>${body}</span>
  </div>`;

export const emptyState = (
  heading: string,
  text: string,
  action?: { label: string; href: string },
) =>
  html`<div class="empty">
    <h2 class="empty-title">${heading}</h2>
    <p class="copy muted">${text}</p>
    ${action
      ? html`<div>
          <a class="button secondary small" href="${action.href}"
            >${action.label}</a
          >
        </div>`
      : null}
  </div>`;

export function segmented<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  href: (value: T) => string,
): Html {
  return html`<nav class="segmented" aria-label="${label}">
    ${options.map(
      option =>
        html`<a
          class="segment"
          href="${href(option.value)}"
          ${raw(option.value === value ? ' aria-current="true"' : '')}
          >${option.label}</a
        >`,
    )}
  </nav>`;
}

export function chips<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  href: (value: T) => string,
): Html {
  return html`<nav class="chips" aria-label="${label}">
    ${options.map(
      option =>
        html`<a
          class="chip"
          href="${href(option.value)}"
          ${raw(option.value === value ? ' aria-current="true"' : '')}
          >${option.label}</a
        >`,
    )}
  </nav>`;
}

export const disclosure = (
  heading: string,
  subtitle: Child,
  body: Child,
  open = false,
) =>
  html`<details class="disclosure" ${raw(open ? ' open' : '')}>
    <summary>
      <span class="row-text"
        ><span class="row-title">${heading}</span>${subtitle
          ? html`<span class="row-subtitle">${subtitle}</span>`
          : null}</span
      ><span class="chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="disclosure-body">${body}</div>
  </details>`;

export const progress = (done: number, total: number, label: string) =>
  html`<div
    class="progress"
    role="progressbar"
    aria-label="${label}"
    aria-valuemin="0"
    aria-valuemax="${total}"
    aria-valuenow="${done}"
  >
    <span
      style="width:${Math.round(
        (Math.min(done, total) / Math.max(1, total)) * 100,
      )}%"
    ></span>
  </div>`;

export const share = (fraction: number) =>
  html`<div class="share" aria-hidden="true">
    <span
      style="width:${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%"
    ></span>
  </div>`;

export interface Column {
  label: string;
  numeric?: boolean;
}

export function table(
  columns: Column[],
  rows: { cells: Child[]; href?: string }[],
  caption?: string,
): Html {
  return html`<div class="table-wrap">
    <table>
      ${caption
        ? html`<caption class="sr">
            ${caption}
          </caption>`
        : null}
      <thead>
        <tr>
          ${columns.map(
            column =>
              html`<th${raw(
                column.numeric ? ' class="num"' : '',
              )} scope="col">${column.label}</th>`,
          )}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          entry =>
            html`<tr${raw(entry.href ? ' class="link"' : '')}>${entry.cells.map(
              (cell, index) =>
                html`<td${raw(columns[index]?.numeric ? ' class="num"' : '')}>${
                  entry.href && index === 0
                    ? html`<a href="${entry.href}">${cell}</a>`
                    : cell
                }</td>`,
            )}</tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

/** Formular mit CSRF-Feld. Aktionen der Website sind immer POST. */
export const form = (
  action: string,
  csrf: string,
  body: Child,
  className = 'form',
) =>
  html`<form class="${className}" method="post" action="${action}">
    <input type="hidden" name="csrf" value="${csrf}" />${body}
  </form>`;

export const button = (
  label: string,
  variant: 'primary' | 'secondary' | 'danger' = 'primary',
  small = false,
) =>
  html`<button
    class="button${variant === 'primary' ? '' : ` ${variant}`}${small
      ? ' small'
      : ''}"
    type="submit"
  >
    ${label}
  </button>`;

export const field = (label: string, input: Html) =>
  html`<label class="field"
    ><span class="field-label">${label}</span>${input}</label
  >`;

export const list = (children: Child[]) => join(children);
