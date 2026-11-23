/**
 * Simulated gas detectors for the demo. Detectors come from the plan (markers of kind
 * `DETECTOR_KIND`); readings come from scripted incidents: a gas escapes in a room for five
 * minutes, the cloud grows, the supply is isolated and the room clears. Deterministic for a given
 * plan, scenario and time, so scrubbing the timeline is reproducible. Replace `readingAt` with
 * real detector data in a product.
 */
import { pointInPolygon, polygonCentroid, type FloorPlan, type Level, type Point, type Room } from '@vespenelabs/floorview';

import { pipelineAlerts, smoothNoise } from '../air-quality/simulation';
import { alarmLevelOf, GAS_IDS, GASES, hazardOf, isGasId, readingFor, type AlarmLevel, type Gas } from './gases';
import { DETECTOR_KIND } from './site';

export interface Detector {
  /** The marker id. */
  id: string;
  /** Tag number, e.g. "GD-101" (the marker name). */
  tag: string;
  gas: Gas;
  /** Detector model, e.g. "OLCT 100 XP". Empty when the plan doesn't name one. */
  model: string;
  levelId: string;
  levelName: string;
  /** The room (zone) the detector stands in, if any. */
  roomId: string | null;
  roomName: string;
  position: Point;
}

function roomAt(level: Level, position: Point): Room | undefined {
  return level.rooms.find((room) => pointInPolygon(position, room.points));
}

/** The plan's gas detectors: markers of kind `DETECTOR_KIND` with a known gas in `data.gas`. */
export function detectorsFor(plan: FloorPlan): Detector[] {
  return plan.levels.flatMap((level) =>
    level.markers.flatMap((marker): Detector[] => {
      const gasId = marker.data?.gas;
      if (marker.kind !== DETECTOR_KIND || !isGasId(gasId)) return [];
      const room = roomAt(level, marker.position);
      const model = marker.data?.model;
      return [
        {
          id: marker.id,
          tag: marker.name || marker.id,
          gas: GASES[gasId],
          model: typeof model === 'string' ? model : '',
          levelId: level.id,
          levelName: level.name || level.id,
          roomId: room?.id ?? null,
          roomName: room ? room.name || room.id : level.name || level.id,
          position: marker.position,
        },
      ];
    }),
  );
}

/** A gas escaping at one place from `start` (seconds on the timeline). */
export interface Release {
  gas: Gas;
  levelId: string;
  roomId: string | null;
  roomName: string;
  position: Point;
  start: number;
}

export interface Scenario {
  id: string;
  label: string;
  releases: Release[];
}

/** Timeline length and step, in seconds. */
export const DURATION = 600;
export const STEP = 5;
/** A release runs this long before the supply is isolated. */
const LEAK_SECONDS = 300;
const FIRST_START = 60;

/** A release of the detector's gas in its room, halfway between the detector and the room center. */
function releaseNear(plan: FloorPlan, detector: Detector, start: number): Release {
  const level = plan.levels.find((l) => l.id === detector.levelId);
  const room = level?.rooms.find((r) => r.id === detector.roomId);
  const center = room ? polygonCentroid(room.points) : detector.position;
  return {
    gas: detector.gas,
    levelId: detector.levelId,
    roomId: detector.roomId,
    roomName: detector.roomName,
    position: { x: (detector.position.x + center.x) / 2, y: (detector.position.y + center.y) / 2 },
    start,
  };
}

/**
 * The incidents the page can play: normal operation, one release per gas the plan has detectors
 * for (near the first detector of that gas) and, when possible, two releases in different rooms.
 */
export function scenariosFor(plan: FloorPlan, detectors: readonly Detector[]): Scenario[] {
  const first = GAS_IDS.flatMap((id) => detectors.find((d) => d.gas.id === id) ?? []);
  const single = first.map((d): Scenario => ({ id: d.gas.id, label: `${d.gas.incident} · ${d.roomName}`, releases: [releaseNear(plan, d, FIRST_START)] }));
  const scenarios: Scenario[] = [{ id: 'normal', label: 'Normal operation', releases: [] }, ...single];

  const a = first[0];
  const elsewhere = first.filter((d) => a && d.roomId !== a.roomId);
  // Prefer a second gas of another hazard class, so the two alarms differ in kind.
  const b = elsewhere.find((d) => d.gas.hazard !== a?.gas.hazard) ?? elsewhere[0];
  if (a && b) {
    scenarios.push({
      id: 'two',
      label: `Two incidents · ${a.gas.formula} and ${b.gas.formula}`,
      releases: [releaseNear(plan, a, FIRST_START), releaseNear(plan, b, FIRST_START + 90)],
    });
  }
  return scenarios;
}

/** Highest hazard at the leak; above alarm 2 (2) and below the end of the scale (3). */
const PEAK = 2.9;
/** Share of a room's concentration that reaches a detector in another room. */
const THROUGH_WALLS = 0.45;

/** Hazard (0–3) that `release` causes at `detector` at time `t`. */
function plume(release: Release, detector: Detector, t: number): number {
  const dt = t - release.start;
  if (dt <= 0 || detector.gas.id !== release.gas.id || detector.levelId !== release.levelId) return 0;
  const leaking = Math.min(dt, LEAK_SECONDS);
  // Builds up while it leaks, then the ventilation clears it.
  const strength = (1 - Math.exp(-leaking / 70)) * Math.exp(-(dt - leaking) / 60);
  // The cloud grows from 2 m to 11 m (standard deviation), so near detectors trip first.
  const sigma = 2 + 0.03 * leaking;
  const d = Math.hypot(detector.position.x - release.position.x, detector.position.y - release.position.y);
  const contained = detector.roomId === release.roomId ? 1 : THROUGH_WALLS;
  return PEAK * strength * Math.exp(-(d * d) / (2 * sigma * sigma)) * contained;
}

export interface Reading {
  /** In the gas's unit, rounded as displayed. */
  value: number;
  level: AlarmLevel;
  /** The value on the shared hazard scale (0–3), for the heatmap and for ranking. */
  hazard: number;
}

/** The simulated reading of `detector` at `t` seconds into `scenario`. */
export function readingAt(detector: Detector, scenario: Scenario, t: number): Reading {
  const noise = smoothNoise(detector.id, t / 80);
  const background = 0.035 + 0.025 * noise;
  const gas = detector.gas;
  const released = Math.max(0, ...scenario.releases.map((r) => plume(r, detector, t)));
  const raw = readingFor(gas, released * (1 + 0.04 * noise) + background);
  const value = Number(raw.toFixed(gas.decimals));
  return { value, level: alarmLevelOf(gas, value), hazard: hazardOf(gas, value) };
}

export interface AlarmEvent {
  /** Seconds on the timeline. */
  time: number;
  detector: Detector;
  /** The level the detector changed to (0: back to normal). */
  level: AlarmLevel;
  value: number;
}

/** Every alarm level change of the detectors from the start of the scenario up to `until`, oldest first. */
export function alarmEvents(detectors: readonly Detector[], scenario: Scenario, until: number): AlarmEvent[] {
  const events: AlarmEvent[] = [];
  const levels = new Map<string, AlarmLevel>();
  for (let time = 0; time <= until; time += STEP) {
    for (const detector of detectors) {
      const { level, value } = readingAt(detector, scenario, time);
      if (level !== (levels.get(detector.id) ?? 0)) events.push({ time, detector, level, value });
      levels.set(detector.id, level);
    }
  }
  return events;
}

export interface SuspectPipeline {
  id: string;
  name: string;
  levelId: string;
  roomName: string;
  gas: Gas;
}

/**
 * Pipelines that may be the source of an alarm: they run through a room where a detector of a gas
 * is in alarm and carry a medium that explains that gas (e.g. natural gas for methane, nitrogen
 * for low oxygen).
 */
export function suspectPipelines(plan: FloorPlan, alarming: readonly Detector[]): SuspectPipeline[] {
  const media = new Map(plan.levels.flatMap((level) => level.pipelines.map((p) => [p.id, p.medium])));
  const suspects = new Map<string, SuspectPipeline>();
  for (const id of GAS_IDS) {
    const gas = GASES[id];
    const rooms = new Set(alarming.flatMap((d) => (d.gas.id === id && d.roomId ? [d.roomId] : [])));
    if (rooms.size === 0 || gas.media.length === 0) continue;
    for (const alert of pipelineAlerts(plan, rooms)) {
      if (gas.media.includes(media.get(alert.id) ?? '') && !suspects.has(alert.id)) suspects.set(alert.id, { ...alert, gas });
    }
  }
  return [...suspects.values()];
}

/** "02:35" for seconds on the timeline. */
export function formatElapsed(seconds: number): string {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
