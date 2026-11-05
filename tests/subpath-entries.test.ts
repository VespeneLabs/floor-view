// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as model from '@vespenelabs/floorview/model';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_DIR = resolve(ROOT, 'src/model');

/**
 * Every module reachable from `entry` through relative runtime imports, plus the bare specifiers
 * it imports at runtime (type-only imports and dynamic `import()` are listed separately).
 */
function importGraph(entry: string) {
  const files = new Set<string>();
  const bare = new Set<string>();
  const typeOnly = new Set<string>();
  const dynamic = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [statement, spec] of source.matchAll(/^(?:import|export)\b[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
      const isType = /^(?:import|export)\s+type\b/.test(statement);
      if (spec!.startsWith('.')) {
        if (!isType) visit(resolve(dirname(file), spec!.endsWith('.ts') ? spec! : `${spec}.ts`));
      } else (isType ? typeOnly : bare).add(spec!);
    }
    for (const [, spec] of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) dynamic.add(spec!);
  };
  visit(entry);
  return { files: [...files], bare: [...bare], typeOnly: [...typeOnly], dynamic: [...dynamic] };
}

const DOM_GLOBALS = /\b(document|window|HTMLElement|SVGElement|navigator|Image|HTMLCanvasElement)\b/;
const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('@vespenelabs/floorview/model', () => {
  it('only reaches modules inside src/model and imports no packages', () => {
    const { files, bare } = importGraph(resolve(MODEL_DIR, 'index.ts'));
    expect(files.every((f) => f.startsWith(MODEL_DIR))).toBe(true);
    expect(bare).toEqual([]);
  });

  it('does not touch DOM globals', () => {
    for (const file of importGraph(resolve(MODEL_DIR, 'index.ts')).files) expect(code(file), file).not.toMatch(DOM_GLOBALS);
  });

  it('validates and normalizes plans in Node', () => {
    const plan = model.createPlan('Hall');
    const json = JSON.stringify(plan);
    expect(model.parsePlanJSON(json)).toEqual(plan);
    expect(() => model.parsePlan({ version: 1 })).toThrow(model.PlanValidationError);
    expect(model.createId('sensor')).toMatch(/^sensor_[0-9a-f]{8}$/);
  });
});

describe('@vespenelabs/floorview/architect/server', () => {
  const graph = importGraph(resolve(ROOT, 'src/architect/server/index.ts'));

  it('runs in Node: no DOM, no three, only node: built-ins at runtime', () => {
    expect(graph.bare.every((spec) => spec.startsWith('node:'))).toBe(true);
    for (const file of graph.files) {
      expect(file.startsWith(resolve(ROOT, 'src/architect'))).toBe(true);
      expect(code(file), file).not.toMatch(DOM_GLOBALS);
    }
  });

  it('loads @anthropic-ai/sdk only lazily (optional peer dependency)', () => {
    expect(graph.bare).not.toContain('@anthropic-ai/sdk');
    expect(graph.dynamic).toEqual(['@anthropic-ai/sdk']);
  });
});

describe('@vespenelabs/floorview/architect', () => {
  it('has no runtime dependencies (no three, no React, no SDK)', () => {
    const graph = importGraph(resolve(ROOT, 'src/architect/index.ts'));
    expect(graph.bare).toEqual([]);
    expect(graph.files.every((f) => f.startsWith(resolve(ROOT, 'src/architect')) || f.startsWith(MODEL_DIR) || f.includes('/src/core/'))).toBe(true);
  });
});
