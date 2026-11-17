import type { ModelAsset } from './assets';
import { pointInPolygon, polygonArea } from './geometry';
import { pipelineLength } from './pipeline';
import { levelBounds } from './plan';
import type { FloorPlan, Level, Point } from './types';

export interface DescribePlanOptions {
  /** Describe only this level (the other levels are listed by name). Default: every level. */
  levelId?: string;
  /**
   * `'full'` (default) lists every wall, room, marker and pipeline with its id and geometry;
   * `'summary'` gives counts, rooms and what kinds of markers there are, for large plans.
   */
  detail?: 'summary' | 'full';
  /** Names for marker models (`"Desk"` next to the model id). */
  assets?: readonly ModelAsset[] | ReadonlyMap<string, ModelAsset>;
}

/** Meters with at most 2 decimals, without trailing zeros. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100 + 0);
}

const xy = (p: Point): string => `(${n(p.x)},${n(p.y)})`;
const quote = (text: string): string => JSON.stringify(text);

function describeLevel(level: Level, full: boolean, assets: ReadonlyMap<string, ModelAsset>): string[] {
  const bounds = levelBounds(level);
  const lines = [
    `Level ${quote(level.name)} [${level.id}]: floor at ${n(level.elevation)} m, wall height ${n(level.height)} m` +
      (bounds ? `, extent x ${n(bounds.minX)}..${n(bounds.maxX)}, y ${n(bounds.minY)}..${n(bounds.maxY)}` : ', empty'),
  ];
  const roomOf = (p: Point): string => {
    const room = level.rooms.find((r) => pointInPolygon(p, r.points));
    return room ? ` in ${quote(room.name || room.id)}` : '';
  };

  lines.push(`Rooms (${level.rooms.length}):`);
  for (const room of level.rooms) {
    lines.push(`- ${room.id} ${quote(room.name)} ${n(polygonArea(room.points))} m²${full ? `: ${room.points.map(xy).join(' ')}` : ''}`);
  }

  if (full) {
    lines.push(`Walls (${level.walls.length}): id start->end thickness [height]`);
    for (const wall of level.walls) {
      lines.push(`- ${wall.id} ${xy(wall.start)}->${xy(wall.end)} ${n(wall.thickness)}${wall.height === undefined ? '' : ` h${n(wall.height)}`}`);
    }
    lines.push(`Markers (${level.markers.length}):`);
    for (const m of level.markers) {
      const model = m.model ? ` model ${m.model}${assets.get(m.model) ? ` (${assets.get(m.model)!.name})` : ''}` : '';
      lines.push(
        `- ${m.id} ${quote(m.name)} at ${xy(m.position)}${roomOf(m.position)}${model}` +
          (m.kind ? ` kind ${m.kind}` : '') +
          (m.rotation ? ` rotation ${n(m.rotation)}` : '') +
          (m.scale !== undefined && m.scale !== 1 ? ` scale ${n(m.scale)}` : '') +
          (m.elevation ? ` elevation ${n(m.elevation)}` : '') +
          (m.color ? ` color ${m.color}` : '') +
          (m.pipelineId ? ` on pipeline ${m.pipelineId}` : ''),
      );
    }
    lines.push(`Pipelines (${level.pipelines.length}): points are (x,y,z)`);
    for (const p of level.pipelines) {
      lines.push(
        `- ${p.id} ${quote(p.name)}${p.medium ? ` medium ${p.medium}` : ''} diameter ${n(p.diameter)} length ${n(pipelineLength(p))} m` +
          (p.from ? ` from ${p.from}` : '') +
          (p.to ? ` to ${p.to}` : '') +
          `: ${p.points.map((q) => `(${n(q.x)},${n(q.y)},${n(q.z)})`).join(' ')}`,
      );
    }
  } else {
    lines.push(`Walls: ${level.walls.length}`);
    const groups = new Map<string, number>();
    for (const m of level.markers) {
      const key = m.model ? (assets.get(m.model)?.name ?? m.model) : (m.kind ?? 'plain marker');
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const kinds = [...groups].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} × ${key}`);
    lines.push(`Markers: ${level.markers.length}${kinds.length ? ` (${kinds.join(', ')})` : ''}`);
    const length = level.pipelines.reduce((sum, p) => sum + pipelineLength(p), 0);
    const media = [...new Set(level.pipelines.map((p) => p.medium).filter(Boolean))];
    lines.push(`Pipelines: ${level.pipelines.length}${level.pipelines.length ? ` (${n(length)} m in total${media.length ? `; media: ${media.join(', ')}` : ''})` : ''}`);
  }
  return lines;
}

/**
 * A compact text description of a plan for prompts and tool results: ids, names, rounded
 * coordinates, room areas, which room a marker is in. Much smaller than the plan JSON (no
 * metadata, two decimals) and enough to write plan commands from. `detail: 'summary'` leaves out
 * the lists of walls, markers and pipelines.
 */
export function describePlan(plan: FloorPlan, options: DescribePlanOptions = {}): string {
  const full = (options.detail ?? 'full') === 'full';
  const assets: ReadonlyMap<string, ModelAsset> = !options.assets
    ? new Map()
    : options.assets instanceof Map
      ? (options.assets as ReadonlyMap<string, ModelAsset>)
      : new Map((options.assets as readonly ModelAsset[]).map((a) => [a.id, a]));
  const shown = options.levelId === undefined ? plan.levels : plan.levels.filter((l) => l.id === options.levelId);
  const lines = [
    `Plan ${quote(plan.name)}: ${plan.levels.length} level${plan.levels.length === 1 ? '' : 's'}. Lengths in meters; x grows right, y grows down (seen from above).`,
  ];
  if (options.levelId !== undefined) {
    if (shown.length === 0) lines.push(`There is no level "${options.levelId}".`);
    lines.push(`Levels: ${plan.levels.map((l) => `${quote(l.name)} [${l.id}]`).join(', ')}.`);
  }
  for (const level of shown) lines.push('', ...describeLevel(level, full, assets));
  return lines.join('\n');
}
