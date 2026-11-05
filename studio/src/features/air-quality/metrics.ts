/** Air-quality metrics: units, value → color stops (shared by heatmap, sensors and legend) and labelled bands. */

export type MetricId = 'co2' | 'temperature' | 'humidity' | 'pm25';
export type Tone = 'good' | 'moderate' | 'poor';

export interface Band {
  /** Upper bound (exclusive) of the band; the last band is unbounded. */
  below: number;
  label: string;
  tone: Tone;
}

export interface Metric {
  id: MetricId;
  label: string;
  /** Compact label for buttons. */
  short: string;
  unit: string;
  decimals: number;
  /** The best possible value; rankings measure distance from it. */
  ideal: number;
  /** Legend range. */
  min: number;
  max: number;
  colorStops: { value: number; color: string }[];
  bands: Band[];
}

const GREEN = '#22c55e';
const YELLOW = '#eab308';
const ORANGE = '#f97316';
const RED = '#dc2626';
const BLUE = '#3b82f6';

export const METRICS: Record<MetricId, Metric> = {
  co2: {
    id: 'co2',
    label: 'CO₂',
    short: 'CO₂',
    unit: 'ppm',
    decimals: 0,
    ideal: 400,
    min: 400,
    max: 1600,
    colorStops: [
      { value: 400, color: GREEN },
      { value: 800, color: YELLOW },
      { value: 1200, color: ORANGE },
      { value: 1600, color: RED },
    ],
    bands: [
      { below: 800, label: 'Good', tone: 'good' },
      { below: 1200, label: 'Moderate', tone: 'moderate' },
      { below: Infinity, label: 'Poor', tone: 'poor' },
    ],
  },
  temperature: {
    id: 'temperature',
    label: 'Temperature',
    short: 'Temp',
    unit: '°C',
    decimals: 1,
    ideal: 21.5,
    min: 16,
    max: 28,
    colorStops: [
      { value: 16, color: BLUE },
      { value: 19, color: '#38bdf8' },
      { value: 21.5, color: GREEN },
      { value: 24, color: YELLOW },
      { value: 26, color: ORANGE },
      { value: 28, color: RED },
    ],
    bands: [
      { below: 19, label: 'Cold', tone: 'moderate' },
      { below: 24, label: 'Comfortable', tone: 'good' },
      { below: 26, label: 'Warm', tone: 'moderate' },
      { below: Infinity, label: 'Hot', tone: 'poor' },
    ],
  },
  humidity: {
    id: 'humidity',
    label: 'Humidity',
    short: 'Humidity',
    unit: '%',
    decimals: 0,
    ideal: 45,
    min: 20,
    max: 80,
    colorStops: [
      { value: 20, color: ORANGE },
      { value: 30, color: YELLOW },
      { value: 40, color: GREEN },
      { value: 55, color: GREEN },
      { value: 65, color: '#38bdf8' },
      { value: 80, color: BLUE },
    ],
    bands: [
      { below: 30, label: 'Dry', tone: 'moderate' },
      { below: 60, label: 'Comfortable', tone: 'good' },
      { below: 70, label: 'Humid', tone: 'moderate' },
      { below: Infinity, label: 'Very humid', tone: 'poor' },
    ],
  },
  pm25: {
    id: 'pm25',
    label: 'PM2.5',
    short: 'PM2.5',
    unit: 'µg/m³',
    decimals: 0,
    ideal: 0,
    min: 0,
    max: 55,
    colorStops: [
      { value: 0, color: GREEN },
      { value: 12, color: YELLOW },
      { value: 35, color: ORANGE },
      { value: 55, color: RED },
    ],
    bands: [
      { below: 12, label: 'Good', tone: 'good' },
      { below: 35, label: 'Moderate', tone: 'moderate' },
      { below: Infinity, label: 'Poor', tone: 'poor' },
    ],
  },
};

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];

export function bandOf(metric: Metric, value: number): Band {
  return metric.bands.find((b) => value < b.below) ?? metric.bands[metric.bands.length - 1]!;
}

export function formatValue(metric: Metric, value: number): string {
  return `${value.toFixed(metric.decimals)} ${metric.unit}`;
}

const TONE_RANK: Record<Tone, number> = { good: 0, moderate: 1, poor: 2 };

/** Sort key (higher = worse): worse tone first, then distance from the metric's ideal value. */
export function severity(metric: Metric, value: number): number {
  return TONE_RANK[bandOf(metric, value).tone] * 1e6 + Math.abs(value - metric.ideal);
}

/** CSS `linear-gradient` matching the color stops over [min, max], for legends. */
export function legendGradient(metric: Metric): string {
  const span = metric.max - metric.min;
  const stops = metric.colorStops.map((s) => `${s.color} ${(((s.value - metric.min) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Color for a value, linearly interpolated between the metric's stops (hex in, `rgb()` out). */
export function colorFor(metric: Metric, value: number): string {
  const stops = metric.colorStops;
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (value <= first.value) return first.color;
  if (value >= last.value) return last.color;
  const i = stops.findIndex((s) => s.value >= value);
  const a = stops[i - 1]!;
  const b = stops[i]!;
  const t = (value - a.value) / (b.value - a.value);
  const [ar, ag, ab] = hex(a.color);
  const [br, bg, bb] = hex(b.color);
  const mix = (x = 0, y = 0) => Math.round(x + (y - x) * t);
  return `rgb(${mix(ar, br)}, ${mix(ag, bg)}, ${mix(ab, bb)})`;
}
