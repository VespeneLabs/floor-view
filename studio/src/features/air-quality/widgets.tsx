import { cn } from 'cn';
import type { ReactNode } from 'react';

import { legendGradient, type Metric, type Tone } from './metrics';

const TONE_CLASSES: Record<Tone, string> = {
  good: 'text-status-good bg-status-good/12',
  moderate: 'text-status-moderate bg-status-moderate/12',
  poor: 'text-status-poor bg-status-poor/12',
};

/** Status label with its color; the text carries the meaning, the color reinforces it. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}

/** Gradient bar for the metric's color scale with its labelled bands underneath. */
export function MetricLegend({ metric }: { metric: Metric }) {
  const span = metric.max - metric.min;
  let from = metric.min;
  const segments = metric.bands.map((band) => {
    const to = Math.min(band.below, metric.max);
    const segment = { band, width: ((to - from) / span) * 100, from };
    from = to;
    return segment;
  });

  return (
    <figure className="grid gap-1" aria-label={`${metric.label} color scale`}>
      <div className="h-2.5 rounded-full" style={{ background: legendGradient(metric) }} />
      <div className="flex text-[0.7rem] text-muted-foreground">
        {segments.map(({ band, width, from: start }) => (
          <div key={band.label} style={{ width: `${width}%` }} className="min-w-0 truncate border-l px-1 first:border-l-0 first:pl-0">
            <div className="truncate font-medium text-foreground">{band.label}</div>
            <div className="tabular-nums">{start === metric.min ? `< ${band.below}` : `≥ ${start}`}</div>
          </div>
        ))}
      </div>
      <figcaption className="text-[0.7rem] text-muted-foreground">Unit: {metric.unit}</figcaption>
    </figure>
  );
}
