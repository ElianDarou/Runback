/**
 * Minimal HTML templating: everything is escaped unless it is explicitly
 * `Html`. This way no text from the data reaches the document unfiltered.
 */

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export type Child = Html | string | number | null | undefined | false | Child[];

export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(child: Child): string {
  if (child === null || child === undefined || child === false) return '';
  if (Array.isArray(child)) return child.map(render).join('');
  if (child instanceof Html) return child.value;
  return escape(String(child));
}

export function html(strings: TemplateStringsArray, ...values: Child[]): Html {
  let out = strings[0];
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1];
  });
  return new Html(out);
}

export const raw = (value: string) => new Html(value);
export const join = (children: Child[]) => new Html(render(children));

/** Query string from fixed parameters; empty values are dropped. */
export function query(
  params: Record<string, string | number | null | undefined>,
): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '')
      search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}
