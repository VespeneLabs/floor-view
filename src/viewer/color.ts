import * as THREE from 'three';

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, string>();

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (canvas) canvas.width = canvas.height = 1;
      ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

/**
 * Normalize any CSS color (`hsl(120 70% 50%)`, `oklch(0.7 0.1 250)`, `rebeccapurple`, `#abc`…)
 * into a THREE.Color. three's own parser only handles a subset of CSS syntax, so non-hex colors
 * are painted onto a 1×1 canvas and read back as sRGB. Alpha is ignored.
 */
export function toThreeColor(css: string, target = new THREE.Color()): THREE.Color {
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(css)) return target.set(css);
  let hex = cache.get(css);
  if (hex === undefined) {
    const c = context();
    if (c) {
      c.clearRect(0, 0, 1, 1);
      c.fillStyle = '#000';
      c.fillStyle = css; // invalid values are ignored, leaving black
      c.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = c.getImageData(0, 0, 1, 1).data;
      hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    } else {
      hex = css; // no DOM (tests/SSR): let three try
    }
    cache.set(css, hex);
  }
  return target.set(hex);
}
