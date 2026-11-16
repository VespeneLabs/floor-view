import {
  createId,
  markerFootprint,
  distance,
  movePipelineEnd,
  nearestPointOnPipeline,
  parsePlan,
  pipelineLength,
  PLAN_FORMAT_VERSION,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  type FloorPlan,
  type Level,
  type Marker,
  type ModelAsset,
  type PipeMedium,
  type PipePoint,
  type Pipeline,
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

/** What conversion needs to know about a pipe medium (a `PipeMedium`). */
export type ProposalMedium = Pick<PipeMedium, 'id' | 'name' | 'color' | 'diameter'>;

export interface ConvertProposalOptions {
  /** The models the assistant was offered. Markers may only use these ids. */
  assets?: readonly ProposalAsset[];
  /**
   * The pipe media the assistant was offered. A pipeline whose `medium` matches one (by id or
   * name, ignoring case) takes its id, color and, without a `diameter`, its typical diameter. Other
   * media are kept as free text.
   */
  media?: readonly ProposalMedium[];
}

/** Defaults for a proposed pipeline (the prompt names the height). */
const PIPE_HEIGHT = 2.6;
const PIPE_DIAMETER = 0.05;
const MIN_PIPE_DIAMETER = 0.003;
const MAX_PIPE_DIAMETER = 3;
const MAX_PIPE_HEIGHT = 100;
/** A pipeline end this close (m, in plan) to a marker's position or another pipeline joins it. */
const PIPE_CONNECT_REACH = 0.3;

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
  const media = options.media ?? [];
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
      pipelines: [],
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

    let pipesOutside = 0;
    (Array.isArray(raw.pipelines) ? raw.pipelines : []).forEach((p: unknown, pi) => {
      const where = `${at}.pipelines[${pi}]`;
      if (!isObj(p) || !Array.isArray(p.points)) return void errors.push(`${where} needs name and points.`);
      const name = str(p.name, `Pipeline ${pi + 1}`) || `Pipeline ${pi + 1}`;
      const label = `${where} ("${name}")`;
      let ok = true;
      const bad = (why: string) => {
        errors.push(`${label}: ${why}`);
        ok = false;
      };
      const inRange = (v: unknown) => isNum(v) && v >= 0 && v <= MAX_PIPE_HEIGHT;
      if (p.height !== undefined && p.height !== null && !inRange(p.height)) bad(`height must be meters above the floor (0 to ${MAX_PIPE_HEIGHT}), or left out.`);
      const diameterGiven = p.diameter !== undefined && p.diameter !== null;
      if (diameterGiven && (!isNum(p.diameter) || p.diameter < MIN_PIPE_DIAMETER || p.diameter > MAX_PIPE_DIAMETER)) {
        bad(`diameter must be meters (${MIN_PIPE_DIAMETER} to ${MAX_PIPE_DIAMETER}, e.g. 0.05 for a 50 mm pipe), or left out.`);
      }
      const raws = p.points as unknown[];
      const valid = raws.filter((q): q is number[] => Array.isArray(q) && isNum(q[0]) && isNum(q[1]) && (q.length < 3 || inRange(q[2])));
      if (valid.length !== raws.length) bad('has malformed points (expected [x, y] or [x, y, heightMeters]).');
      if (!ok) return;
      const height = isNum(p.height) ? p.height : PIPE_HEIGHT;
      if (valid.some(([x, y]) => outside(x!, y!))) pipesOutside++;
      const points = dedupe(valid.map(([x, y, z]) => ({ ...toM(x!, y!), z: round(z ?? height) })));
      if (points.length < 2) return void errors.push(`${label} needs at least 2 different points.`);
      const medium = str(p.medium);
      const preset = medium ? media.find((m) => m.id.toLowerCase() === medium.toLowerCase()) ?? media.find((m) => m.name.toLowerCase() === medium.toLowerCase()) : undefined;
      const pipe: Pipeline = { id: createId('pipe'), name, points, diameter: diameterGiven ? Math.round((p.diameter as number) * 1e4) / 1e4 : (preset?.diameter ?? PIPE_DIAMETER) };
      if (preset) Object.assign(pipe, { medium: preset.id, color: preset.color });
      else if (medium) pipe.medium = medium.slice(0, 60);
      level.pipelines.push(pipe);
    });
    if (pipesOutside) warnings.push(`${level.name}: ${pipesOutside} pipeline(s) extend beyond the image.`);
    connectPipelines(level, assets, warnings);

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

/** Drop points that repeat the one before them (same position and height). */
function dedupe(points: PipePoint[]): PipePoint[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || prev.x !== p.x || prev.y !== p.y || prev.z !== p.z;
  });
}

/**
 * Join the proposed pipelines of a level to what their ends were drawn onto: a marker (the end
 * moves to its position and is linked as `from`/`to`; inside a model's footprint counts), else
 * another pipeline at about the same height (the end moves exactly onto it, making a tee). A
 * pipeline that collapses to one point is dropped with a warning.
 */
function connectPipelines(level: Level, assets: ReadonlyMap<string, ProposalAsset>, warnings: string[]): void {
  const markerAt = (p: Point): Marker | undefined => {
    let best: Marker | undefined;
    let bestDistance = Infinity;
    for (const marker of level.markers) {
      const asset = marker.model ? assets.get(marker.model) : undefined;
      const d = distance(p, marker.position);
      const hit = d <= PIPE_CONNECT_REACH || (asset !== undefined && pointInPolygon(p, markerFootprint(marker, asset)));
      if (hit && d < bestDistance) [best, bestDistance] = [marker, d];
    }
    return best;
  };

  for (const pipe of level.pipelines) {
    for (const end of ['start', 'end'] as const) {
      const at = end === 'start' ? pipe.points[0]! : pipe.points[pipe.points.length - 1]!;
      const marker = markerAt(at);
      if (marker) {
        if (end === 'end' && pipe.from === marker.id) continue; // a loop back to the same equipment
        movePipelineEnd(pipe, end, marker.position);
        pipe[end === 'start' ? 'from' : 'to'] = marker.id;
        continue;
      }
      for (const other of level.pipelines) {
        if (other === pipe) continue;
        const hit = nearestPointOnPipeline(other, at);
        if (!hit || hit.distance > PIPE_CONNECT_REACH || Math.abs(hit.point.z - at.z) > PIPE_CONNECT_REACH) continue;
        movePipelineEnd(pipe, end, { x: round(hit.point.x), y: round(hit.point.y) });
        (end === 'start' ? pipe.points[0]! : pipe.points[pipe.points.length - 1]!).z = round(hit.point.z);
        break;
      }
    }
    pipe.points = dedupe(pipe.points);
  }
  level.pipelines = level.pipelines.filter((pipe) => {
    if (pipe.points.length >= 2) return true;
    warnings.push(`${level.name}: dropped pipeline "${pipe.name}": it has no length.`);
    return false;
  });
}

function summarize(plan: FloorPlan, underlay: Underlay, warnings: string[]): string {
  const lines = [`The plan is now shown to the user. Drawing extent at this scale: ${underlay.width.toFixed(1)} × ${underlay.height.toFixed(1)} m.`];
  for (const level of plan.levels) {
    const area = level.rooms.reduce((sum, r) => sum + polygonArea(r.points), 0);
    const models = level.markers.filter((m) => m.model).length;
    const pipes = level.pipelines;
    const linked = pipes.filter((p) => p.from || p.to).length;
    const piping = pipes.length
      ? `, ${pipes.length} pipeline${pipes.length === 1 ? '' : 's'} (${Math.round(pipes.reduce((sum, p) => sum + pipelineLength(p), 0))} m in total${linked ? `, ${linked} connected to equipment` : ''})`
      : '';
    lines.push(
      `${level.name}: ${level.walls.length} walls, ${level.rooms.length} rooms (${Math.round(area)} m² in total), ${level.markers.length} markers${models ? ` (${models} as 3D models)` : ''}${piping}.`,
    );
  }
  if (warnings.length) lines.push('Warnings:', ...warnings.map((w) => `- ${w}`));
  return lines.join('\n');
}
