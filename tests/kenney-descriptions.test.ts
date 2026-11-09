// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { KENNEY_AI_EXCLUDED, KENNEY_AI_EXCLUSIONS, KENNEY_DESCRIPTIONS, kenneyAssets } from '@vespenelabs/floorview/kenney';

const all = kenneyAssets('/kenney');

describe('Kenney descriptions', () => {
  it('give every catalog model exactly one of: a description, an AI exclusion', () => {
    for (const { id } of all) {
      const described = id in KENNEY_DESCRIPTIONS;
      expect(described !== KENNEY_AI_EXCLUDED.has(id), id).toBe(true);
    }
  });

  it('only name models that exist, each once', () => {
    const ids = new Set(all.map((a) => a.id));
    const excluded = KENNEY_AI_EXCLUSIONS.flatMap((g) => g.ids);
    expect(new Set(excluded).size).toBe(excluded.length);
    for (const id of [...Object.keys(KENNEY_DESCRIPTIONS), ...excluded]) expect(ids.has(id), id).toBe(true);
  });

  it('are short single-line texts', () => {
    for (const [id, text] of Object.entries(KENNEY_DESCRIPTIONS)) {
      expect(text.length, id).toBeGreaterThan(30);
      expect(text.length, id).toBeLessThanOrEqual(400);
      expect(text, id).not.toMatch(/[\n<>|]/);
    }
  });

  it('reach the assets: described models carry the text, excluded ones ai: false', () => {
    const desk = all.find((a) => a.id === 'kenney/furniture/desk');
    expect(desk?.description).toBe(KENNEY_DESCRIPTIONS['kenney/furniture/desk']);
    expect(desk).not.toHaveProperty('ai');
    expect(all.find((a) => a.id === 'kenney/space/alien')).toMatchObject({ ai: false });
    expect(all.filter((a) => a.ai !== false)).toHaveLength(Object.keys(KENNEY_DESCRIPTIONS).length);
  });
});
