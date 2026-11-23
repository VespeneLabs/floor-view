import { cn } from 'cn';

import { StatusBadge } from '../air-quality/widgets';
import type { Tone } from '../air-quality/metrics';
import { ALARM_LABELS, hazardGradient, type AlarmLevel, type Gas } from './gases';
import { useTheme } from '@/lib/theme';

const TONES: Record<AlarmLevel, Tone> = { 0: 'good', 1: 'moderate', 2: 'poor' };

/** Alarm state as a labelled badge; the text carries the meaning, the color reinforces it. */
export function AlarmBadge({ level }: { level: AlarmLevel }) {
  return <StatusBadge tone={TONES[level]}>{ALARM_LABELS[level]}</StatusBadge>;
}

const GLYPH_SHAPES: Partial<Record<Gas['shape'], string>> = {
  sphere: 'rounded-full',
  box: 'rounded-[2px]',
  diamond: 'scale-85 rotate-45 rounded-[2px]',
};

/** The gas's mark on the plan: its identification color in the shape of its hazard class. */
export function GasGlyph({ gas, className }: { gas: Gas; className?: string }) {
  return <span aria-hidden className={cn('size-2.5 shrink-0', GLYPH_SHAPES[gas.shape], className)} style={{ background: gas.color }} />;
}

/**
 * The heatmap's color scale with its three bands. With a gas, the bands show that gas's alarm
 * thresholds; without one, every gas is on its own alarm scale.
 */
export function HazardLegend({ gas }: { gas: Gas | null }) {
  const dark = useTheme() === 'dark';
  const falling = gas ? gas.alarm1 < gas.normal : false;
  const at = (value: number) => `${falling ? '≤' : '≥'} ${value.toFixed(gas?.decimals ?? 0)}`;
  const bands = [
    { label: ALARM_LABELS[0], range: gas ? `${falling ? '>' : '<'} ${gas.alarm1.toFixed(gas.decimals)}` : null },
    { label: ALARM_LABELS[1], range: gas ? at(gas.alarm1) : null },
    { label: ALARM_LABELS[2], range: gas ? at(gas.alarm2) : null },
  ];
  return (
    <figure className="grid gap-1" aria-label={gas ? `${gas.name} color scale` : 'Alarm level color scale'}>
      <div className="h-2.5 rounded-full" style={{ background: hazardGradient(dark) }} />
      <div className="grid grid-cols-3 text-[0.7rem] text-muted-foreground">
        {bands.map((band) => (
          <div key={band.label} className="min-w-0 border-l px-1 first:border-l-0 first:pl-0">
            <div className="truncate font-medium text-foreground">{band.label}</div>
            {band.range && <div className="tabular-nums">{band.range}</div>}
          </div>
        ))}
      </div>
      <figcaption className="text-[0.7rem] text-muted-foreground">
        {gas ? `Unit: ${gas.unit} · interpolated between the detectors of a room` : 'Each gas on its own alarm scale · interpolated between the detectors of a room'}
      </figcaption>
    </figure>
  );
}
