// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as model from '@vespenelabs/floorview/model';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_DIR = resolve(ROOT, 'src/model');

/** Every module reachable from `entry` through relative imports, plus the bare specifiers it uses. */
function importGraph(entry: string) {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
      if (!spec) continue;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`));
      else bare.add(spec);
    }
  };
  visit(entry);
  return { files: [...files], bare: [...bare] };
}

describe('@vespenelabs/floorview/model', () => {
  it('only reaches modules inside src/model and imports no packages', () => {
    const { files, bare } = importGraph(resolve(MODEL_DIR, 'index.ts'));
    expect(files.every((f) => f.startsWith(MODEL_DIR))).toBe(true);
    expect(bare).toEqual([]);
  });

  it('does not touch DOM globals', () => {
    for (const file of importGraph(resolve(MODEL_DIR, 'index.ts')).files) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\b(document|window|HTMLElement|SVGElement|navigator)\b/);
    }
  });

  it('validates and normalizes plans in Node', () => {
    const plan = model.createPlan('Hall');
    const json = JSON.stringify(plan);
    expect(model.parsePlanJSON(json)).toEqual(plan);
    expect(() => model.parsePlan({ version: 1 })).toThrow(model.PlanValidationError);
    expect(model.createId('sensor')).toMatch(/^sensor_[0-9a-f]{8}$/);
  });
});
