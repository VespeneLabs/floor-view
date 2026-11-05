import type { FloorPlan } from '../model/types';

/**
 * Preparing scans for the assistant. Images are scaled to fit the model's vision limits
 * (2576 px long edge, 3.75 MP) so the API doesn't resize them again - the assistant's pixel
 * coordinates then refer to exactly the image we hold.
 */

const MAX_EDGE = 2576;
const MAX_PIXELS = 3_750_000;
/** Stay under the API's per-image size limit (base64 of the encoded file). */
const MAX_BASE64 = 4_500_000;

export interface Scan {
  fileName: string;
  /** For <img> and the plan underlay. */
  dataUrl: string;
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/** Image types `prepareScan` accepts. */
export const ACCEPTED_SCAN_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file could not be read as an image.'));
    img.src = src;
  });
}

function encode(canvas: HTMLCanvasElement): Pick<Scan, 'dataUrl' | 'base64' | 'mediaType'> {
  // PNG keeps line drawings crisp; fall back to JPEG when it would be too large.
  let dataUrl = canvas.toDataURL('image/png');
  let mediaType: Scan['mediaType'] = 'image/png';
  for (const quality of [0.92, 0.85, 0.75]) {
    if (dataUrl.length - 22 <= MAX_BASE64) break;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    mediaType = 'image/jpeg';
  }
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType };
}

/**
 * Reads an uploaded image, flattens transparency onto white and scales it to the model's vision
 * limits. Browser only (uses an <img> and a canvas).
 */
export async function prepareScan(file: File): Promise<Scan> {
  if (!ACCEPTED_SCAN_TYPES.includes(file.type)) {
    throw new Error('Please upload a PNG, JPG or WebP image. For a PDF, export the page as an image first.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight), Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight)));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process images.');
    ctx.fillStyle = '#fff'; // transparent PNGs: flatten onto white paper
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { fileName: file.name, width, height, ...encode(canvas) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The proposed plan drawn over the scan (walls red, room outlines blue, markers green), at most
 * `maxEdge` px, for the assistant to check its own geometry against the drawing.
 */
export async function renderProposalOverlay(scan: Scan, plan: FloorPlan, metersPerPixel: number, maxEdge = 1600): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const img = await loadImage(scan.dataUrl);
  const k = Math.min(1, maxEdge / Math.max(scan.width, scan.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scan.width * k);
  canvas.height = Math.round(scan.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgb(255 255 255 / 0.35)'; // fade the scan so the overlay stands out
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const px = (m: number) => (m / metersPerPixel) * k;

  for (const level of plan.levels) {
    ctx.strokeStyle = 'rgb(37 99 235 / 0.9)';
    ctx.fillStyle = 'rgb(37 99 235 / 0.12)';
    ctx.lineWidth = 2;
    for (const room of level.rooms) {
      ctx.beginPath();
      room.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.y)) : ctx.moveTo(px(p.x), px(p.y))));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgb(220 38 38 / 0.9)';
    ctx.lineCap = 'square';
    for (const wall of level.walls) {
      ctx.lineWidth = Math.max(2, px(wall.thickness));
      ctx.beginPath();
      ctx.moveTo(px(wall.start.x), px(wall.start.y));
      ctx.lineTo(px(wall.end.x), px(wall.end.y));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgb(22 163 74)';
    for (const marker of level.markers) {
      ctx.beginPath();
      ctx.arc(px(marker.position.x), px(marker.position.y), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
}
