import { polygonCentroid, type FloorPlan, type PointLayer, type Room, type RoomLayer } from '@vespenelabs/floorview';

/** Deterministic pseudo-random value in [0, 1) per key and tick: the data "moves" but is reproducible. */
function noise(key: string, tick: number): number {
  let h = 2166136261 ^ tick;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const occupancyRatio = (room: Room, tick: number) => (room.data?.capacity ? noise(room.id, tick) : null);

/** Simulated live occupancy: rooms with a `capacity` are colored green (empty) to red (full). */
export function occupancyLayer(tick: number): RoomLayer {
  return {
    id: 'occupancy',
    type: 'rooms',
    color: (room) => {
      const ratio = occupancyRatio(room, tick);
      return ratio === null ? null : `hsl(${130 - ratio * 130} 70% 55%)`;
    },
    tooltip: (room) => {
      const ratio = occupancyRatio(room, tick);
      const capacity = Number(room.data?.capacity ?? 0);
      return ratio === null
        ? room.name
        : `${room.name}\n${Math.round(ratio * capacity)} / ${capacity} people (${Math.round(ratio * 100)}%)`;
    },
  };
}

/** Simulated temperature sensors, one per room, near its centroid. Hot rooms show red. */
export function sensorLayer(plan: FloorPlan, tick: number): PointLayer {
  return {
    id: 'sensors',
    type: 'points',
    color: '#f97316',
    size: 0.2,
    elevation: 2.2,
    points: plan.levels.flatMap((level) =>
      level.rooms.map((room) => {
        const c = polygonCentroid(room.points);
        const temp = 19 + noise(`${room.id}:temp`, tick) * 6;
        return {
          id: `sensor_${room.id}`,
          levelId: level.id,
          position: { x: c.x + 0.8, y: c.y - 0.6 },
          color: temp > 23.5 ? '#ef4444' : '#f97316',
          data: { room: room.name, temp },
        };
      }),
    ),
    tooltip: (p) => `Temperature sensor · ${String(p.data?.room)}\n${Number(p.data?.temp).toFixed(1)} °C`,
  };
}
