import { describe, expect, it } from 'vitest';
import { GAS_MEDIA, gasAssetId, gasAssets, gasMedium } from '../src/gas/index';
import { parsePlan } from '../src/model/validate';

describe('GAS_MEDIA', () => {
  it('has unique ids, hex colors and positive diameters', () => {
    expect(new Set(GAS_MEDIA.map((m) => m.id)).size).toBe(GAS_MEDIA.length);
    for (const m of GAS_MEDIA) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.diameter).toBeGreaterThan(0);
      expect(m.name).not.toBe('');
    }
    expect(new Set(GAS_MEDIA.map((m) => m.color)).size).toBe(GAS_MEDIA.length);
  });

  it('looks presets up by id', () => {
    expect(gasMedium('N2')?.name).toBe('Nitrogen');
    expect(gasMedium('steam')).toBeUndefined();
    expect(gasMedium(undefined)).toBeUndefined();
  });

  it('makes valid pipelines', () => {
    const ng = gasMedium('NG')!;
    const plan = parsePlan({
      version: 1,
      id: 'plan',
      name: 'Plan',
      levels: [
        {
          id: 'l',
          name: 'L',
          elevation: 0,
          height: 3,
          walls: [],
          rooms: [],
          markers: [],
          pipelines: [{ id: 'p', name: ng.name, medium: ng.id, color: ng.color, diameter: ng.diameter, points: [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }] }],
        },
      ],
    });
    expect(plan.levels[0]!.pipelines[0]).toMatchObject({ medium: 'NG', color: '#facc15', diameter: 0.05 });
  });
});

describe('pipe support model', () => {
  it('is mounted, so a support snapped under a pipe stays on the floor', () => {
    const support = gasAssets('/gas').find((a) => a.id === gasAssetId('pipe-floor-support'))!;
    expect(support.mounted).toBe(true);
    expect(support.size.height).toBeGreaterThan(2.6);
  });
});
