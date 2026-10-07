import { color, radius, space, type } from '../../.generated/tokens';

/**
 * Stylesheet der Website, erzeugt aus denselben Token wie die App
 * (`src/ui/components.tsx`). Die Klassen heißen wie die Bausteine in
 * `src/ui/components.tsx` und sehen genauso aus. Regeln: docs/design-language.md.
 */

const font = (entry: {
  fontSize: number;
  lineHeight: number;
  fontWeight: string;
}) =>
  `font-size:${entry.fontSize}px;line-height:${entry.lineHeight}px;font-weight:${entry.fontWeight}`;

export const STYLESHEET = `
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:${color.bg};color:${
  color.text
};font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;${font(
  type.body,
)};-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid ${
  color.green
};outline-offset:2px}
.num{font-variant-numeric:tabular-nums}
.muted{color:${color.muted}}
.danger{color:${color.danger}}
.caution{color:${color.caution}}
.green{color:${color.green}}

.header{position:sticky;top:0;z-index:2;background:${
  color.bg
};border-bottom:1px solid ${color.line}}
.header-inner{max-width:960px;margin:0 auto;display:flex;align-items:center;gap:${
  space.lg
}px;padding:0 ${space.md}px;min-height:64px}
.brand{${font(type.heading)};letter-spacing:-0.4px}
.brand-mark{color:${color.green}}
.tabs{display:flex;gap:${space.xxs}px;flex:1}
.tab{min-height:48px;display:flex;align-items:center;padding:0 ${
  space.sm
}px;border-radius:${radius.sm}px;color:${color.muted};${font(type.label)}}
.tab:hover{color:${color.text}}
.tab[aria-current=page]{color:${color.text};background:${color.surface}}
.header-status{color:${color.muted};${font(
  type.micro,
)};text-align:right;display:flex;align-items:center;gap:${space.xs}px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:${
  color.green
}}
.dot.stale{background:${color.danger}}

main{max-width:960px;margin:0 auto;padding:${space.lg}px ${space.md}px ${
  space.xxl * 2
}px}
.narrow{max-width:640px}
.title{${font(type.title)};letter-spacing:-0.6px;margin:${space.xs}px 0 ${
  space.md
}px}
.copy{margin:0}
.section{margin-top:${space.xl}px;display:flex;flex-direction:column;gap:${
  space.sm
}px}
.section-title{${font(type.heading)};margin:0}
.card{background:${color.surface};border-radius:${radius.md}px;padding:${
  space.lg
}px;display:flex;flex-direction:column;gap:${space.md}px}
.card.accent{border:1px solid ${color.green}}
.card-label{color:${color.muted};${font(
  type.micro,
)};text-transform:uppercase;letter-spacing:0.6px}
.card-title{${font(type.heading)};margin:0}
.grid{display:grid;gap:${space.md}px}
.grid.two{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:${
  space.md
}px}

.row{min-height:64px;display:flex;align-items:center;gap:${
  space.sm
}px;padding:${space.md}px 0;border-bottom:1px solid ${color.line}}
a.row:hover .row-title{color:${color.green}}
.row-text{flex:1;display:flex;flex-direction:column;gap:${
  space.xxs
}px;min-width:0}
.row-title{${font(type.body)};font-weight:500}
.row-subtitle{color:${color.muted};${font(type.label)};font-weight:400}
.row-value{${font(
  type.body,
)};font-variant-numeric:tabular-nums;text-align:right}
.chevron{font-size:26px;color:${color.muted};width:24px;text-align:center}
.week{display:flex;justify-content:space-between;gap:${space.sm}px;padding:${
  space.lg
}px 0 ${space.xxs}px;color:${color.muted};${font(type.label)}}

.stat{display:flex;flex-direction:column;gap:${space.xxs}px}
.stat-value{${font(type.value)};font-variant-numeric:tabular-nums}
.stat-label{color:${color.muted};${font(type.label)};font-weight:400}
.stat-delta{color:${color.muted};${font(
  type.label,
)};font-weight:400;font-variant-numeric:tabular-nums}

.badge{display:inline-block;border:1px solid ${color.green};border-radius:${
  radius.pill
}px;padding:2px ${space.xs}px;color:${color.green};${font(
  type.micro,
)};font-weight:600;white-space:nowrap}
.badge.muted{border-color:${color.muted};color:${color.muted}}
.badge.danger{border-color:${color.danger};color:${color.danger}}

.segmented{display:flex;background:${color.surface};border-radius:${
  radius.md
}px;padding:${space.xxs}px;gap:${space.xxs}px}
.segment{flex:1;min-height:48px;border-radius:${
  radius.sm
}px;display:flex;align-items:center;justify-content:center;padding:0 ${
  space.xs
}px;color:${color.muted};${font(type.label)};text-align:center}
.segment[aria-current=true]{background:${color.raised};color:${
  color.text
};font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:${space.xs}px}
.chip{min-height:48px;display:flex;align-items:center;padding:0 ${
  space.md
}px;border-radius:${radius.pill}px;border:1px solid ${color.line};background:${
  color.surface
};color:${color.muted};${font(type.label)}}
.chip[aria-current=true]{background:${color.greenSoft};border-color:${
  color.green
};color:${color.text};font-weight:600}

.notice{background:${color.raised};border-radius:${radius.sm}px;padding:${
  space.md
}px;display:flex;flex-direction:column;gap:${
  space.xxs
}px;border-left:3px solid ${color.green}}
.notice.caution{border-left-color:${color.caution}}
.notice.danger{border-left-color:${color.danger}}
.notice-title{${font(type.label)};font-weight:700}
.empty{padding:${space.xxl}px 0;display:flex;flex-direction:column;gap:${
  space.md
}px}
.empty-title{${font(type.heading)};margin:0}

.button{display:inline-flex;align-items:center;justify-content:center;min-height:54px;border-radius:${
  radius.md
}px;background:${color.green};color:${color.ink};border:0;padding:${
  space.md
}px ${space.ml}px;${font(
  type.body,
)};font-weight:700;cursor:pointer;font-family:inherit}
.button.secondary{background:${color.surface};border:1px solid ${
  color.line
};color:${color.text}}
.button.small{min-height:48px;padding:${space.sm}px ${space.md}px}
.button.danger{background:${color.surface};border:1px solid ${
  color.danger
};color:${color.danger}}
.button:hover{opacity:.88}
.actions{display:flex;flex-wrap:wrap;gap:${space.sm}px;align-items:center}

.field{display:flex;flex-direction:column;gap:${space.xs}px}
.field-label{${font(type.label)}}
.input{border:1px solid ${color.line};border-radius:${radius.sm}px;padding:${
  space.sm
}px;color:${color.text};background:${color.surface};${font(
  type.body,
)};min-height:52px;font-family:inherit;width:100%}
textarea.input{min-height:140px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:20px;resize:vertical}
form{margin:0}
.form{display:flex;flex-direction:column;gap:${space.md}px}

details.disclosure{border-bottom:1px solid ${color.line}}
details.disclosure>summary{list-style:none;min-height:64px;display:flex;align-items:center;gap:${
  space.sm
}px;padding:${space.md}px 0;cursor:pointer}
details.disclosure>summary::-webkit-details-marker{display:none}
details.disclosure>summary .chevron{transition:transform .15s}
details.disclosure[open]>summary .chevron{transform:rotate(180deg)}
.disclosure-body{padding:0 0 ${
  space.md
}px;display:flex;flex-direction:column;gap:${space.sm}px}

.table-wrap{overflow-x:auto;border-radius:${radius.md}px;background:${
  color.surface
}}
table{width:100%;border-collapse:collapse;${font(type.label)};font-weight:400}
th,td{text-align:left;padding:${space.sm}px ${
  space.md
}px;border-bottom:1px solid ${color.line};white-space:nowrap}
th{color:${color.muted};font-weight:500}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
tr.link:hover td{color:${color.green}}

.chart{width:100%;height:auto;display:block}
.chart text{fill:${color.muted};font-size:14px;font-family:inherit}
.chart .mobile-only{display:none}
.chart .bar{fill:${color.raised}}
.chart .bar.selected,.chart a:hover .bar{fill:${color.green}}
.chart .grid-line{stroke:${color.line};stroke-width:1}
.chart .line{fill:none;stroke:${
  color.green
};stroke-width:2;stroke-linejoin:round}
.chart .line.heart{stroke:${color.series.heart}}
.chart .line.cadence{stroke:${color.series.cadence}}
.chart .area{fill:${color.raised}}
.chart .avg{stroke:${color.muted};stroke-dasharray:4 4}
.chart .point{fill:${color.raised};stroke:${color.muted}}
.chart .point.selected,.chart a:hover .point{fill:${color.green};stroke:${
  color.green
}}
.chart-detail{display:flex;flex-direction:column;gap:${space.xxs}px;padding:${
  space.sm
}px ${space.md}px;background:${color.raised};border-radius:${radius.sm}px}
.share{height:6px;border-radius:${radius.pill}px;background:${
  color.line
};overflow:hidden}
.share>span{display:block;height:100%;background:${color.green}}
.progress{height:6px;border-radius:${radius.pill}px;background:${
  color.line
};overflow:hidden}
.progress>span{display:block;height:100%;background:${color.green}}
.route{background:${color.surface};border-radius:${radius.md}px}
.route path{fill:none;stroke:${
  color.green
};stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
.route circle{fill:${color.text}}
pre.code{background:${color.surface};border-radius:${radius.sm}px;padding:${
  space.md
}px;overflow-x:auto;font-size:13px;line-height:20px;margin:0}
code{background:${
  color.raised
};border-radius:4px;padding:1px 5px;font-size:13px}
.secret{word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;${font(
  type.body,
)};background:${color.raised};padding:${space.sm}px;border-radius:${
  radius.sm
}px}
.pair-code{${font(
  type.display,
)};font-variant-numeric:tabular-nums;letter-spacing:4px}
.footer{margin-top:${space.xxl}px;color:${color.muted};${font(type.micro)}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

@media (max-width:640px){
  .bucket-chart .desktop-label{display:none}
  .bucket-chart .compact-label{display:block;font-size:28px}
  .header-inner{flex-wrap:wrap;gap:${space.xs}px;padding-top:${space.xs}px}
  .tabs{order:3;flex-basis:100%;overflow-x:auto}
  .header-status{margin-left:auto}
  .title{${font(type.heading)};font-size:24px;line-height:30px}
}
`;
