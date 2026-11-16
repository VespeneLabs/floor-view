import { pipelineEndRun, type PipePoint, type Pipeline } from '@vespenelabs/floorview';

import { CommitInput } from '@/components/CommitInput';

const AXES = ['x', 'y', 'z'] as const;

/**
 * The points of a pipeline as an editable table (x, y in plan meters, z = height above the floor).
 * An end attached to a marker follows that marker, so its x / y are read-only here. Edits that
 * would put two consecutive points on the same spot are ignored (pipelines can't have them).
 */
export function PipePointsTable({ pipe, onChange }: { pipe: Pipeline; onChange: (points: PipePoint[]) => void }) {
  const locked = new Set([...(pipe.from ? pipelineEndRun(pipe, 'start') : []), ...(pipe.to ? pipelineEndRun(pipe, 'end') : [])]);

  const commit = (index: number, axis: (typeof AXES)[number], raw: string) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || (axis === 'z' && value < 0)) return;
    const points = pipe.points.map((p, i) => (i === index ? { ...p, [axis]: Math.round(value * 1000) / 1000 } : p));
    const same = (a: PipePoint, b: PipePoint | undefined) => !!b && a.x === b.x && a.y === b.y && a.z === b.z;
    if (points.some((p, i) => same(p, points[i + 1]))) return;
    onChange(points);
  };

  return (
    <table className="w-full text-xs tabular-nums">
      <caption className="mb-1.5 text-left text-muted-foreground">Points (m)</caption>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="w-6 text-left font-normal">
            #
          </th>
          {AXES.map((a) => (
            <th key={a} scope="col" className="text-left font-normal">
              {a === 'z' ? 'z (height)' : a}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pipe.points.map((p, i) => (
          <tr key={i}>
            <th scope="row" className="text-left font-normal text-muted-foreground">
              {i + 1}
            </th>
            {AXES.map((axis) => {
              const fixed = axis !== 'z' && locked.has(i);
              return (
                <td key={axis} className="py-0.5 pr-1">
                  <CommitInput
                    type="number"
                    step={axis === 'z' ? 0.1 : 0.05}
                    min={axis === 'z' ? 0 : undefined}
                    className="h-7 px-1.5 text-xs"
                    aria-label={`Point ${i + 1} ${axis}`}
                    title={fixed ? 'Follows the connected equipment' : undefined}
                    disabled={fixed}
                    value={p[axis]}
                    onCommit={(v) => commit(i, axis, v)}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
