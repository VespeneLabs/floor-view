import { describe, expect, it } from 'vitest';
import { createLevel, findEntity, levelBounds, removeEntity, translateEntity } from '../src/model/plan';
import {
  isRiser,
  nearestPointOnPipeline,
  pipelineJunctions,
  pipelineLength,
  segmentRotation,
} from '../src/model/pipeline';
import type { FloorPlan, Level, PipePoint, Pipeline } from '../src/model/types';
import { parsePlan, PlanValidationError } from '../src/model/validate';
import { createSamplePlan as samplePlan } from '../src/samples';

const pt = (x: number, y: number, z = 2.6): PipePoint => ({ x, y, z });

function pipe(id: string, points: PipePoint[], extra: Partial<Pipeline> = {}): Pipeline {
  return { id, name: id, points, diameter: 0.05, ...extra };
}

/** Sample plan with a supply line from the desk 1 marker plus a fitting on it. */
function planWithPipes(): FloorPlan {
  const plan = samplePlan();
  const level = plan.levels[0]!;
  level.pipelines.push(
    pipe('pipe_main', [pt(8, 1.5, 0.5), pt(8, 1.5), pt(16, 1.5), pt(16, 6)], {
      medium: 'natural-gas',
      color: '#facc15',
      from: 'marker_desk1',
      data: { pressureBar: 4 },
    }),
  );
  level.markers.push({ id: 'marker_valve', name: 'Valve', position: { x: 12, y: 1.5 }, elevation: 2.4, pipelineId: 'pipe_main' });
  return plan;
}

describe('pipelines in parsePlan', () => {
  it('round-trips pipelines and marker links', () => {
    const plan = planWithPipes();
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('defaults a missing pipelines array (older v1 plans)', () => {
    const plan = samplePlan() as unknown as { levels: Partial<Level>[] };
    delete plan.levels[0]!.pipelines;
    expect(parsePlan(plan).levels[0]!.pipelines).toEqual([]);
  });

  it('reports invalid pipelines with their JSON path', () => {
    const tooShort = planWithPipes();
    tooShort.levels[0]!.pipelines[0]!.points.splice(1);
    expect(() => parsePlan(tooShort)).toThrow(/\$\.levels\[0\]\.pipelines\[0\]\.points: a pipeline needs at least 2 points/);

    const noZ = planWithPipes() as unknown as { levels: { pipelines: { points: Partial<PipePoint>[] }[] }[] };
    delete noZ.levels[0]!.pipelines[0]!.points[2]!.z;
    expect(() => parsePlan(noZ)).toThrow(/pipelines\[0\]\.points\[2\]\.z/);

    const repeated = planWithPipes();
    repeated.levels[0]!.pipelines[0]!.points.splice(2, 0, pt(8, 1.5));
    expect(() => parsePlan(repeated)).toThrow(/points\[2\]: repeats the previous point/);

    const badDiameter = planWithPipes();
    badDiameter.levels[0]!.pipelines[0]!.diameter = 0;
    expect(() => parsePlan(badDiameter)).toThrow(/pipelines\[0\]\.diameter/);
  });

  it('accepts a riser (same plan position, different z)', () => {
    const plan = planWithPipes();
    expect(parsePlan(plan).levels[0]!.pipelines[0]!.points.slice(0, 2)).toEqual([pt(8, 1.5, 0.5), pt(8, 1.5)]);
  });

  it('shares the plan-wide id space', () => {
    const plan = planWithPipes();
    plan.levels[0]!.pipelines[0]!.id = 'marker_desk2';
    expect(() => parsePlan(plan)).toThrow(PlanValidationError);
  });

  it('drops links that do not resolve on the same level', () => {
    const plan = planWithPipes();
    plan.levels[0]!.pipelines[0]!.to = 'marker_screen'; // exists, but on the first floor
    plan.levels[1]!.markers[0]!.pipelineId = 'pipe_main';
    const parsed = parsePlan(plan);
    expect(parsed.levels[0]!.pipelines[0]).toMatchObject({ from: 'marker_desk1' });
    expect(parsed.levels[0]!.pipelines[0]).not.toHaveProperty('to');
    expect(parsed.levels[0]!.markers.find((m) => m.id === 'marker_valve')).toMatchObject({ pipelineId: 'pipe_main' });
    expect(parsed.levels[1]!.markers[0]).not.toHaveProperty('pipelineId');
  });
});

describe('pipeline plan helpers', () => {
  it('creates levels with an empty pipeline list', () => {
    expect(createLevel().pipelines).toEqual([]);
  });

  it('finds and translates pipelines, keeping z', () => {
    const plan = planWithPipes();
    const ref = { kind: 'pipeline', id: 'pipe_main', levelId: 'level_ground' } as const;
    const found = findEntity(plan, ref) as Pipeline;
    translateEntity('pipeline', found, 1, 2);
    expect(found.points[0]).toEqual(pt(9, 3.5, 0.5));
  });

  it('includes pipelines in the level bounds', () => {
    const level = createLevel({ pipelines: [pipe('p', [pt(-3, 2), pt(4, 9)])] });
    expect(levelBounds(level)).toEqual({ minX: -3, minY: 2, maxX: 4, maxY: 9 });
  });

  it('removing a marker detaches pipeline ends; removing a pipeline unlinks its fittings', () => {
    const plan = planWithPipes();
    const level = plan.levels[0]!;
    removeEntity(plan, { kind: 'marker', id: 'marker_desk1', levelId: level.id });
    expect(level.pipelines[0]).not.toHaveProperty('from');

    removeEntity(plan, { kind: 'pipeline', id: 'pipe_main', levelId: level.id });
    expect(level.pipelines).toEqual([]);
    expect(level.markers.find((m) => m.id === 'marker_valve')).not.toHaveProperty('pipelineId');
  });
});

describe('pipeline geometry', () => {
  const main = pipe('main', [pt(0, 0, 0.5), pt(0, 0), pt(10, 0), pt(10, 5)]);

  it('measures 3D length including risers', () => {
    expect(pipelineLength(main)).toBeCloseTo(2.1 + 10 + 5);
    expect(isRiser(main.points[0]!, main.points[1]!)).toBe(true);
    expect(isRiser(main.points[1]!, main.points[2]!)).toBe(false);
  });

  it('projects plan points onto the pipeline with interpolated z', () => {
    const sloped = pipe('s', [pt(0, 0, 2), pt(10, 0, 3)]);
    expect(nearestPointOnPipeline(sloped, { x: 4, y: 1 })).toEqual({
      point: { x: 4, y: 0, z: 2.4 },
      segment: 0,
      t: 0.4,
      distance: 1,
    });
    expect(nearestPointOnPipeline(main, { x: 11, y: 3 })).toMatchObject({ point: pt(10, 3), segment: 2, distance: 1 });
  });

  it('gives a clockwise plan rotation along a segment', () => {
    expect(segmentRotation({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(segmentRotation({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(segmentRotation({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(180);
    expect(segmentRotation({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(270);
    expect(segmentRotation({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('derives tees and joints in 3D', () => {
    const level = createLevel({
      pipelines: [
        main,
        pipe('branch', [pt(5, 0), pt(5, 4)]), // starts on main's horizontal run → tee
        pipe('corner', [pt(10, 0), pt(14, 0)]), // starts on main's interior vertex → tee on segment 2
        pipe('next', [pt(10, 5), pt(10, 8)]), // continues from main's end → joint
        pipe('crossing', [pt(5, -2, 3.5), pt(5, 2, 3.5)]), // crosses main higher up → nothing
      ],
    });
    const junctions = pipelineJunctions(level);
    expect(junctions).toEqual([
      { kind: 'joint', point: pt(10, 5), pipelineId: 'main', end: 'end', otherId: 'next', otherEnd: 'start' },
      { kind: 'tee', point: pt(5, 0), pipelineId: 'branch', end: 'start', otherId: 'main', segment: 1 },
      { kind: 'tee', point: pt(10, 0), pipelineId: 'corner', end: 'start', otherId: 'main', segment: 2 },
    ]);
  });
});
