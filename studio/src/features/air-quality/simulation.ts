/**
 * Simulated air-quality sensors for the demo: one sensor per room, with readings that follow a
 * plausible office day (people raise CO₂, temperature and humidity; the kitchen spikes PM2.5 at
 * lunch; the server room runs hot). Deterministic for a given plan and time, so scrubbing the
 * timeline is reproducible. Replace with real sensor data in a product.
 */
import { pointInPolygon, polygonArea, polygonCentroid, type FloorPlan, type Point } from '@vespenelabs/floorview';

import type { MetricId } from './metrics';

export interface Sensor {
  id: string;
  roomId: string;
  roomName: string;
  levelId: string;
  levelName: string;
  position: Point;
  /** People per m² relative to a dense office (0–1). */
  load: number;
  kind: 'kitchen' | 'server' | 'room';
}

export type Reading = Record<MetricId, number>;

/** Room center nudged towards the top-right, falling back to the center for tiny/odd rooms. */
function sensorPosition(points: Point[]): Point {
  const c = polygonCentroid(points);
  const nudged = { x: c.x + 0.9, y: c.y - 0.7 };
  return pointInPolygon(nudged, points) ? nudged : c;
}

/** Rooms smaller than this (m²) get no sensor. */
const MIN_ROOM_AREA = 2;

export function sensorsFor(plan: FloorPlan): Sensor[] {
  return plan.levels.flatMap((level) =>
    level.rooms
      .filter((room) => polygonArea(room.points) >= MIN_ROOM_AREA)
      .map((room): Sensor => {
        const name = room.name.toLowerCase();
        const kind = name.includes('kitchen') ? 'kitchen' : name.includes('server') ? 'server' : 'room';
        const capacity = Number(room.data?.capacity ?? 0);
        const area = polygonArea(room.points);
        const load = capacity > 0 ? Math.min(1, (capacity * 1.2) / area) : kind === 'server' ? 0 : 0.08;
        return {
          id: `aq_${room.id}`,
          roomId: room.id,
          roomName: room.name || room.id,
          levelId: level.id,
          levelName: level.name || level.id,
          // Beside the room center, so the sensor isn't hidden under the room label.
          position: sensorPosition(room.points),
          load,
          kind,
        };
      }),
  );
}

/** Deterministic hash noise in [-1, 1]. */
function hash(key: string, slot: number): number {
  let h = 2166136261 ^ slot;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (((h >>> 0) % 2001) - 1000) / 1000;
}

/** Noise that changes smoothly over time (interpolated between quarter-hour slots). */
function smoothNoise(key: string, hour: number): number {
  const slot = Math.floor(hour * 4);
  const t = hour * 4 - slot;
  return hash(key, slot) * (1 - t) + hash(key, slot + 1) * t;
}

/** Share of people in the office at `hour` (0–1): an arc over 7:00–19:00. */
function occupancy(hour: number): number {
  if (hour <= 7 || hour >= 19) return 0.02;
  return Math.max(0.02, Math.sin((Math.PI * (hour - 7)) / 12) ** 0.7);
}

/** Lunch-time bump centered on 12:30. */
function lunch(hour: number): number {
  return Math.exp(-(((hour - 12.5) / 0.7) ** 2));
}

/** Simulated readings for a sensor at `hour` (0–24, fractional). */
export function readingAt(sensor: Sensor, hour: number): Reading {
  const occ = occupancy(hour);
  const lunchPeak = lunch(hour);
  const people = (sensor.kind === 'kitchen' ? Math.max(occ * 0.3, lunchPeak) : occ * (1 - 0.3 * lunchPeak)) * sensor.load;
  const n = (metric: string) => smoothNoise(`${sensor.id}:${metric}`, hour);
  const outdoor = 0.9 * Math.sin((2 * Math.PI * (hour - 9)) / 24);

  return {
    co2: Math.max(400, 420 + 1150 * people + 25 * n('co2')),
    temperature: 20.6 + outdoor + 2.6 * people + (sensor.kind === 'server' ? 5.2 : 0) + 0.35 * n('temp'),
    humidity: Math.min(95, Math.max(15, 41 + 16 * people + (sensor.kind === 'kitchen' ? 14 * lunchPeak : 0) + 3 * n('hum'))),
    pm25: Math.max(0, 5 + 9 * people + (sensor.kind === 'kitchen' ? 40 * lunchPeak : 0) + 2 * n('pm')),
  };
}

export function formatHour(hour: number): string {
  const minutes = Math.round(hour * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
