/**
 * The gases of the gas detection demo: units, clean-air value, two alarm thresholds and how a
 * reading maps to the shared hazard scale that colors the heatmap. Measuring ranges follow common
 * fixed-detector ranges; the alarm thresholds are typical demo values, and a real site sets its own
 * in the controller.
 */
import type { PointShape } from '@vespenelabs/floorview';

export type GasId = 'CH4' | 'H2' | 'H2S' | 'CO' | 'O2';

/** 0 = normal, 1 = alarm 1 (warning), 2 = alarm 2 (action). */
export type AlarmLevel = 0 | 1 | 2;

export interface Gas {
  id: GasId;
  formula: string;
  name: string;
  /** What the detector warns about. */
  hazard: 'Flammable' | 'Toxic' | 'Oxygen deficiency';
  /** Name of the simulated incident. */
  incident: string;
  unit: string;
  decimals: number;
  /** Reading in clean air. */
  normal: number;
  /** Alarm thresholds. For oxygen they lie below `normal`: the alarm trips on a falling reading. */
  alarm1: number;
  alarm2: number;
  /** Reading at the end of the color scale (hazard 3). */
  full: number;
  /** Identification color of the gas on the plan and in the legend (not a status color). */
  color: string;
  /** Point shape by hazard class, so gases are not told apart by color alone. */
  shape: PointShape;
  /** Pipeline media (`pipeline.medium`) that can be the source of this reading. */
  media: readonly string[];
}

export const GASES: Record<GasId, Gas> = {
  CH4: {
    id: 'CH4',
    formula: 'CH₄',
    name: 'Methane',
    hazard: 'Flammable',
    incident: 'Methane leak',
    unit: '%LEL',
    decimals: 0,
    normal: 0,
    alarm1: 20,
    alarm2: 40,
    full: 60,
    color: '#a855f7',
    shape: 'diamond',
    media: ['NG', 'LPG'],
  },
  H2: {
    id: 'H2',
    formula: 'H₂',
    name: 'Hydrogen',
    hazard: 'Flammable',
    incident: 'Hydrogen leak',
    unit: '%LEL',
    decimals: 0,
    normal: 0,
    alarm1: 20,
    alarm2: 40,
    full: 60,
    color: '#06b6d4',
    shape: 'diamond',
    media: ['H2'],
  },
  H2S: {
    id: 'H2S',
    formula: 'H₂S',
    name: 'Hydrogen sulfide',
    hazard: 'Toxic',
    incident: 'H₂S release',
    unit: 'ppm',
    decimals: 1,
    normal: 0,
    alarm1: 5,
    alarm2: 10,
    full: 20,
    color: '#ec4899',
    shape: 'sphere',
    media: [],
  },
  CO: {
    id: 'CO',
    formula: 'CO',
    name: 'Carbon monoxide',
    hazard: 'Toxic',
    incident: 'CO build-up',
    unit: 'ppm',
    decimals: 0,
    normal: 0,
    alarm1: 30,
    alarm2: 100,
    full: 200,
    color: '#94a3b8',
    shape: 'sphere',
    media: [],
  },
  O2: {
    id: 'O2',
    formula: 'O₂',
    name: 'Oxygen',
    hazard: 'Oxygen deficiency',
    incident: 'Inert gas leak',
    unit: '%vol',
    decimals: 1,
    normal: 20.9,
    alarm1: 19.5,
    alarm2: 18,
    full: 16,
    color: '#3b82f6',
    shape: 'box',
    // An inert gas pushes the oxygen out.
    media: ['N2', 'Ar', 'He', 'CO2'],
  },
};

export const GAS_IDS = Object.keys(GASES) as GasId[];

export function isGasId(value: unknown): value is GasId {
  return typeof value === 'string' && value in GASES;
}

/** The hazard scale's anchors: clean air, alarm 1, alarm 2 and the end of the scale. */
function anchors(gas: Gas): [number, number, number, number] {
  return [gas.normal, gas.alarm1, gas.alarm2, gas.full];
}

/**
 * A reading on the shared hazard scale: 0 in clean air, 1 at alarm 1, 2 at alarm 2 and 3 at the end
 * of the scale, linear in between and clamped. It makes gases with different units comparable.
 */
export function hazardOf(gas: Gas, value: number): number {
  const a = anchors(gas);
  const sign = Math.sign(a[3] - a[0]);
  if ((value - a[0]) * sign <= 0) return 0;
  for (let i = 1; i < a.length; i++) {
    if ((value - a[i]!) * sign <= 0) return i - 1 + (value - a[i - 1]!) / (a[i]! - a[i - 1]!);
  }
  return 3;
}

/** The reading for a hazard value: the inverse of `hazardOf`. */
export function readingFor(gas: Gas, hazard: number): number {
  const a = anchors(gas);
  const h = Math.min(3, Math.max(0, hazard));
  const i = Math.min(2, Math.floor(h));
  return a[i]! + (h - i) * (a[i + 1]! - a[i]!);
}

export function alarmLevelOf(gas: Gas, value: number): AlarmLevel {
  const falling = gas.alarm1 < gas.normal;
  const reached = (threshold: number) => (falling ? value <= threshold : value >= threshold);
  return reached(gas.alarm2) ? 2 : reached(gas.alarm1) ? 1 : 0;
}

export const ALARM_LABELS: Record<AlarmLevel, string> = { 0: 'Normal', 1: 'Alarm 1', 2: 'Alarm 2' };

export function formatReading(gas: Gas, value: number): string {
  return `${value.toFixed(gas.decimals)} ${gas.unit}`;
}

/** "A1 20 · A2 40 %LEL"; for oxygen "A1 ≤ 19.5 · A2 ≤ 18.0 %vol". */
export function formatThresholds(gas: Gas): string {
  const sign = gas.alarm1 < gas.normal ? '≤ ' : '';
  return `A1 ${sign}${gas.alarm1.toFixed(gas.decimals)} · A2 ${sign}${gas.alarm2.toFixed(gas.decimals)} ${gas.unit}`;
}

/**
 * Heatmap colors over the hazard scale: a calm green in clean air (dark or light with the theme,
 * so a normal floor stays quiet), amber at alarm 1 and red at alarm 2.
 */
export function hazardStops(dark: boolean): { value: number; color: string }[] {
  return [
    { value: 0, color: dark ? '#14532d' : '#bbf7d0' },
    { value: 0.5, color: '#a3e635' },
    { value: 1, color: '#f59e0b' },
    { value: 2, color: '#dc2626' },
    { value: 3, color: '#be123c' },
  ];
}

/** CSS `linear-gradient` of `hazardStops`, for the legend. */
export function hazardGradient(dark: boolean): string {
  return `linear-gradient(to right, ${hazardStops(dark).map((s) => `${s.color} ${((s.value / 3) * 100).toFixed(1)}%`).join(', ')})`;
}
