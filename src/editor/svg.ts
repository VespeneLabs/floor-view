const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined | null | false>;

/** Create an SVG element with attributes (null/undefined/false values are skipped) and append it to `parent`. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null && value !== false) el.setAttribute(key, String(value));
  }
  parent?.appendChild(el);
  return el;
}

export function pointsAttr(points: readonly { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
