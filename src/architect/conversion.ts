import {
  createId,
  markerFootprint,
  distance,
  parsePlan,
  PLAN_FORMAT_VERSION,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  type FloorPlan,
  type Level,
  type Marker,
  type ModelAsset,
  type Point,
  type Underlay,
} from '../model/index';

/**
 * Converts the assistant's `propose_floor_plan` input (image pixels) into a validated FloorPlan
 * (meters). Tool inputs are untrusted model output (and streamed without server-side validation),
 * so everything is checked here; problems go back to the assistant as an error tool result.
 * Pure: no DOM, so a host can also run it on the server.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** What conversion needs to know about a 3D model (a `ModelAsset` or an `ArchitectAsset`). */
export type ProposalAsset = Pick<ModelAsset, 'id' | 'size'>;

export interface ConvertProposalOptions {
  /** The models the assistant was offered. Markers may only use these ids. */
  assets?: readonly ProposalAsset[];
}

/** Bounds for a model marker's `scale` (the prompt asks for 0.5-2). */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export type ProposalConversion =
  | { ok: true; plan: FloorPlan; underlay: Underlay; summary: string; warnings: string[]; assumptions: string[] }
  | { ok: false; errors: string[] };

const ROOM_COLORS: Record<string, string> = {
  production: '#bfdbfe',
  warehouse: '#fde68a',
  loading: '#fed7aa',
  office: '#c7d2fe',
  meeting: '#ddd6fe',
  canteen: '#fbcfe8',
  sanitary: '#a5f3fc',
  technical: '#e5e7eb',
  lab: '#bbf7d0',
  circulation: '#e2e8f0',
  other: '#e7e5e4',
};

const MARKER_COLORS: Record<string, string> = {
  exit: '#16a34a',
  'loading-dock': '#ea580c',
  'fire-equipment': '#dc2626',
  machine: '#7c3aed',
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const round = (v: number) => Math.round(v * 1000) / 1000;

export function convertProposal(input: unknown, image: ImageSize, options: ConvertProposalOptions = {}): ProposalConversion {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assets = new Map((options.assets ?? []).map((a) => [a.id, a]));
  if (!isObj(input)) return { ok: false, errors: ['The input must be an object.'] };

  const mpp = input.metersPerPixel;
  if (!isNum(mpp) || mpp <= 0) return { ok: false, errors: ['metersPerPixel must be a positive number.'] };
  const extentM = Math.max(image.width, image.height) * mpp;
  if (extentM < 3 || extentM > 5000) {
    errors.push(`metersPerPixel ${mpp} makes the drawing ${extentM.toFixed(1)} m across, which is implausible; re-check the scale.`);
  }
  if (!Array.isArray(input.levels) || input.levels.length === 0) errors.push('levels must contain at least one level.');
  if (errors.length) return { ok: false, errors };

  const margin = 0.05 * Math.max(image.width, image.height);
  const outside = (x: number, y: number) => x < -margin || y < -margin || x > image.width + margin || y > image.height + margin;
  const toM = (x: number, y: number): Point => ({ x: round(x * mpp), y: round(y * mpp) });

  const levels: Level[] = [];
  (input.levels as unknown[]).forEach((raw, li) => {
    const at = `levels[${li}]`;
    if (!isObj(raw)) return void errors.push(`${at} must be an object.`);
    const height = isNum(raw.height) && raw.height > 0 ? raw.height : 3;
    const level: Level = {
      id: createId('level'),
      name: str(raw.name, `Level ${li + 1}`) || `Level ${li + 1}`,
      elevation: isNum(raw.elevation) ? raw.elevation : 0,
      height,
      walls: [],
      rooms: [],
      markers: [],
    };

    let wallsOutside = 0;
    (Array.isArray(raw.walls) ? raw.walls : []).forEach((w: unknown, wi) => {
      if (!Array.isArray(w) || w.length < 4 || !w.slice(0, 4).every(isNum)) {
        return void errors.push(`${at}.walls[${wi}] must be [x1, y1, x2, y2, thicknessMeters].`);
      }
      const [x1, y1, x2, y2, t, h] = w as number[];
      if (outside(x1!, y1!) || outside(x2!, y2!)) wallsOutside++;
      const start = toM(x1!, y1!);
      const end = toM(x2!, y2!);
      if (distance(start, end) < 0.05) return; // degenerate: drop silently
      level.walls.push({
        id: createId('wall'),
        start,
        end,
        thickness: isNum(t) && t > 0 ? Math.min(Math.max(t, 0.05), 2) : 0.2,
        ...(isNum(h) && h > 0 && Math.abs(h - height) > 0.01 ? { height: h } : {}),
      });
    });
    if (wallsOutside) warnings.push(`${level.name}: ${wallsOutside} wall(s) extend beyond the image.`);

    (Array.isArray(raw.rooms) ? raw.rooms : []).forEach((r: unknown, ri) => {
      if (!isObj(r) || !Array.isArray(r.points)) return void errors.push(`${at}.rooms[${ri}] needs name, use and points.`);
      const pts = (r.points as unknown[]).filter((p): p is number[] => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
      if (pts.length !== r.points.length) errors.push(`${at}.rooms[${ri}] has malformed points (expected [x, y] pairs).`);
      const points = pts.map(([x, y]) => toM(x!, y!));
      // Drop a repeated closing point.
      if (points.length > 3 && distance(points[0]!, points[points.length - 1]!) < 0.01) points.pop();
      const name = str(r.name, `Room ${ri + 1}`) || `Room ${ri + 1}`;
      if (points.length < 3) return void errors.push(`${at}.rooms[${ri}] ("${name}") needs at least 3 points.`);
      const area = polygonArea(points);
      if (area < 0.5) return void warnings.push(`Dropped "${name}": its area is only ${area.toFixed(2)} m².`);
      const use = str(r.use, 'other');
      level.rooms.push({ id: createId('room'), name, points, color: ROOM_COLORS[use] ?? ROOM_COLORS.other, data: { use } });
    });

    let modelsOutside = 0;
    (Array.isArray(raw.markers) ? raw.markers : []).forEach((m: unknown, mi) => {
      if (!isObj(m) || !isNum(m.x) || !isNum(m.y)) return void errors.push(`${at}.markers[${mi}] needs name, kind, x and y.`);
      const kind = str(m.kind, 'other') || 'other';
      const marker: Marker = { id: createId('marker'), name: str(m.name, kind) || kind, kind, position: toM(m.x, m.y) };
      const model = modelFields(m, `${at}.markers[${mi}] ("${marker.name}")`, assets, errors);
      if (model) {
        Object.assign(marker, model.fields);
        if (markerFootprint(marker, model.asset).some((p) => outside(p.x / mpp, p.y / mpp))) modelsOutside++;
      } else if (MARKER_COLORS[kind]) marker.color = MARKER_COLORS[kind];
      level.markers.push(marker);
    });
    if (modelsOutside) warnings.push(`${level.name}: ${modelsOutside} 3D model(s) extend beyond the image; check their position and rotation.`);

    if (level.walls.length === 0 && level.rooms.length === 0) errors.push(`${at} ("${level.name}") has no walls and no rooms.`);

    // Overlapping rooms are the most common geometry slip: flag rooms whose center lies inside another room.
    for (const a of level.rooms) {
      const c = polygonCentroid(a.points);
      const host = level.rooms.find((b) => b !== a && pointInPolygon(c, b.points) && polygonArea(b.points) >= polygonArea(a.points));
      if (host) warnings.push(`${level.name}: "${a.name}" overlaps "${host.name}"; neighbouring rooms should share edges, not overlap.`);
    }
    levels.push(level);
  });

  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };

  const plan: FloorPlan = { version: PLAN_FORMAT_VERSION, id: createId('plan'), name: str(input.name, 'Imported plan') || 'Imported plan', levels };
  try {
    parsePlan(plan); // final structural check with the library's own validator
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }

  const assumptions = Array.isArray(input.assumptions) ? input.assumptions.filter((a): a is string => typeof a === 'string') : [];
  const underlay: Underlay = { url: '', x: 0, y: 0, width: round(image.width * mpp), height: round(image.height * mpp) };
  return { ok: true, plan, underlay, summary: summarize(plan, underlay, warnings), warnings, assumptions };
}

/**
 * The validated `model`/`rotation`/`scale` of a proposed marker, or null for a plain marker (no
 * model, or an invalid one: the problem is added to `errors`).
 */
function modelFields(
  m: Obj,
  at: string,
  assets: ReadonlyMap<string, ProposalAsset>,
  errors: string[],
): { asset: ProposalAsset; fields: Pick<Marker, 'model' | 'rotation' | 'scale'> } | null {
  if (m.model === undefined || m.model === null || m.model === '') return null;
  if (typeof m.model !== 'string') {
    errors.push(`${at}: model must be a catalog id (a string).`);
    return null;
  }
  if (assets.size === 0) {
    errors.push(`${at}: there is no asset catalog in this conversation, so leave out "model".`);
    return null;
  }
  const asset = assets.get(m.model);
  if (!asset) {
    const tail = m.model.split('/').pop()!.toLowerCase();
    const near = [...assets.keys()].filter((id) => id.toLowerCase().endsWith(`/${tail}`) || id.toLowerCase().includes(tail)).slice(0, 3);
    errors.push(`${at}: unknown model "${m.model}". Use an id exactly as listed in the asset catalog${near.length ? ` (did you mean ${near.map((id) => `"${id}"`).join(', ')}?)` : ''}, or leave out "model".`);
    return null;
  }
  let ok = true;
  if (m.rotation !== undefined && m.rotation !== null && !isNum(m.rotation)) {
    errors.push(`${at}: rotation must be a number of degrees.`);
    ok = false;
  }
  if (m.scale !== undefined && m.scale !== null && (!isNum(m.scale) || m.scale < MIN_SCALE || m.scale > MAX_SCALE)) {
    errors.push(`${at}: scale must be a number between ${MIN_SCALE} and ${MAX_SCALE} (usually 0.5 to 2), or left out.`);
    ok = false;
  }
  if (!ok) return null;
  const rotation = isNum(m.rotation) ? Math.round((((m.rotation % 360) + 360) % 360) * 10) / 10 : 0;
  const scale = isNum(m.scale) ? Math.round(m.scale * 1000) / 1000 : 1;
  return {
    asset,
    fields: { model: asset.id, ...(rotation && rotation !== 360 ? { rotation } : {}), ...(scale !== 1 ? { scale } : {}) },
  };
}

function summarize(plan: FloorPlan, underlay: Underlay, warnings: string[]): string {
  const lines = [`The plan is now shown to the user. Drawing extent at this scale: ${underlay.width.toFixed(1)} × ${underlay.height.toFixed(1)} m.`];
  for (const level of plan.levels) {
    const area = level.rooms.reduce((sum, r) => sum + polygonArea(r.points), 0);
    const models = level.markers.filter((m) => m.model).length;
    lines.push(
      `${level.name}: ${level.walls.length} walls, ${level.rooms.length} rooms (${Math.round(area)} m² in total), ${level.markers.length} markers${models ? ` (${models} as 3D models)` : ''}.`,
    );
  }
  if (warnings.length) lines.push('Warnings:', ...warnings.map((w) => `- ${w}`));
  return lines.join('\n');
}
