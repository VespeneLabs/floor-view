import { describe, expect, it } from 'vitest';

import { convertProposal } from '../studio/src/features/import/plan-conversion';

const image = { width: 1000, height: 600 };

const proposal = (overrides: Record<string, unknown> = {}) => ({
  name: 'Plant 1',
  metersPerPixel: 0.1,
  scaleSource: 'dimension string',
  assumptions: ['Halls are 9 m high'],
  levels: [
    {
      name: 'Ground floor',
      height: 9,
      walls: [
        [100, 100, 900, 100, 0.3],
        [900, 100, 900, 500, 0.3],
        [900, 500, 100, 500, 0.3],
        [100, 500, 100, 100, 0.3],
        [500, 100, 500, 500, 0.15, 4],
      ],
      rooms: [
        { name: 'Production', use: 'production', points: [[100, 100], [500, 100], [500, 500], [100, 500]] },
        { name: 'Offices', use: 'office', points: [[500, 100], [900, 100], [900, 500], [500, 500], [500, 100]] },
      ],
      markers: [{ name: 'Dock 1', kind: 'loading-dock', x: 700, y: 500 }],
    },
  ],
  ...overrides,
});

describe('convertProposal', () => {
  it('converts pixels to meters and builds a valid plan with an aligned underlay', () => {
    const result = convertProposal(proposal(), image);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const level = result.plan.levels[0]!;
    expect(level.walls).toHaveLength(5);
    expect(level.walls[0]).toMatchObject({ start: { x: 10, y: 10 }, end: { x: 90, y: 10 }, thickness: 0.3 });
    expect(level.walls[4]).toMatchObject({ thickness: 0.15, height: 4 });
    expect(level.walls[0]).not.toHaveProperty('height'); // equal to the level height
    expect(level.rooms[1]!.points).toHaveLength(4); // repeated closing point dropped
    expect(level.rooms[0]).toMatchObject({ name: 'Production', color: '#bfdbfe', data: { use: 'production' } });
    expect(level.markers[0]).toMatchObject({ kind: 'loading-dock', position: { x: 70, y: 50 } });
    expect(result.underlay).toMatchObject({ x: 0, y: 0, width: 100, height: 60 });
    expect(result.summary).toContain('2 rooms (3200 m² in total)');
    expect(result.assumptions).toEqual(['Halls are 9 m high']);
  });

  it('rejects implausible scales and malformed geometry with actionable messages', () => {
    const tiny = convertProposal(proposal({ metersPerPixel: 0.0001 }), image);
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.errors[0]).toMatch(/implausible/);

    const broken = convertProposal(
      proposal({ levels: [{ name: 'L', height: 3, walls: [[1, 2, 3]], rooms: [{ name: 'R', use: 'office', points: [[0, 0], [1, 1]] }] }] }),
      image,
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.errors.some((e) => e.includes('walls[0]'))).toBe(true);
      expect(broken.errors.some((e) => e.includes('at least 3 points'))).toBe(true);
    }
    expect(convertProposal('nope', image).ok).toBe(false);
  });

  it('warns about overlapping rooms, tiny rooms and geometry outside the image', () => {
    const result = convertProposal(
      proposal({
        levels: [
          {
            name: 'GF',
            height: 9,
            walls: [[100, 100, 2000, 100, 0.3]],
            rooms: [
              { name: 'Hall', use: 'production', points: [[100, 100], [900, 100], [900, 500], [100, 500]] },
              { name: 'Booth', use: 'office', points: [[400, 200], [500, 200], [500, 300], [400, 300]] },
              { name: 'Speck', use: 'other', points: [[0, 0], [2, 0], [2, 2]] },
            ],
          },
        ],
      }),
      image,
    );
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(result.warnings.join('\n')).toMatch(/"Booth" overlaps "Hall"/);
    expect(result.warnings.join('\n')).toMatch(/Dropped "Speck"/);
    expect(result.warnings.join('\n')).toMatch(/beyond the image/);
    expect(result.plan.levels[0]!.rooms).toHaveLength(2);
  });
});
