import { PLAN_FORMAT_VERSION, type FloorPlan, type Point, type Wall } from './model/types';

let wallSeq = 0;
const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.15): Wall => ({
  id: `wall_s${++wallSeq}`,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness,
});
const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

/** A two-level sample office (used by Floorview Studio, tests and docs). Door openings are modeled as gaps between wall segments. */
export function createSamplePlan(): FloorPlan {
  wallSeq = 0;
  return {
    version: PLAN_FORMAT_VERSION,
    id: 'plan_sample',
    name: 'VespeneLabs HQ',
    levels: [
      {
        id: 'level_ground',
        name: 'Ground floor',
        elevation: 0,
        height: 3,
        walls: [
          // exterior (entrance gap at the bottom-left)
          wall(0, 0, 20, 0, 0.25),
          wall(20, 0, 20, 12, 0.25),
          wall(20, 12, 5, 12, 0.25),
          wall(3, 12, 0, 12, 0.25),
          wall(0, 12, 0, 0, 0.25),
          // corridor, north side
          wall(0, 5, 2, 5), wall(3, 5, 9, 5), wall(10, 5, 16, 5), wall(17, 5, 20, 5),
          // corridor, south side
          wall(3, 7, 9, 7), wall(10, 7, 12, 7), wall(13, 7, 16, 7), wall(17, 7, 20, 7),
          // partitions
          wall(6, 0, 6, 5), wall(14, 0, 14, 5),
          wall(8, 7, 8, 12), wall(11, 7, 11, 12), wall(14, 7, 14, 12),
        ],
        rooms: [
          { id: 'room_meeting', name: 'Meeting A', points: rect(0, 0, 6, 5), color: '#c7d2fe', data: { capacity: 8 } },
          { id: 'room_open', name: 'Open office', points: rect(6, 0, 14, 5), color: '#bae6fd', data: { capacity: 24 } },
          { id: 'room_kitchen', name: 'Kitchen', points: rect(14, 0, 20, 5), color: '#fde68a', data: { capacity: 12 } },
          { id: 'room_corridor', name: 'Corridor', points: rect(0, 5, 20, 7), color: '#e2e8f0' },
          { id: 'room_lobby', name: 'Lobby', points: rect(0, 7, 8, 12), color: '#bbf7d0', data: { capacity: 15 } },
          { id: 'room_focus1', name: 'Focus 1', points: rect(8, 7, 11, 12), color: '#fbcfe8', data: { capacity: 2 } },
          { id: 'room_focus2', name: 'Focus 2', points: rect(11, 7, 14, 12), color: '#fbcfe8', data: { capacity: 2 } },
          { id: 'room_server', name: 'Server room', points: rect(14, 7, 20, 12), color: '#ddd6fe' },
        ],
        markers: [
          { id: 'marker_desk1', name: 'Desk 1', kind: 'desk', position: { x: 8, y: 1.5 } },
          { id: 'marker_desk2', name: 'Desk 2', kind: 'desk', position: { x: 10, y: 1.5 } },
          { id: 'marker_desk3', name: 'Desk 3', kind: 'desk', position: { x: 12, y: 1.5 } },
          { id: 'marker_desk4', name: 'Desk 4', kind: 'desk', position: { x: 10, y: 3.5 } },
          { id: 'marker_exit', name: 'Main entrance', kind: 'exit', color: '#16a34a', position: { x: 4, y: 11.5 } },
        ],
      },
      {
        id: 'level_first',
        name: 'First floor',
        elevation: 3,
        height: 3,
        walls: [
          wall(0, 0, 20, 0, 0.25),
          wall(20, 0, 20, 12, 0.25),
          wall(20, 12, 0, 12, 0.25),
          wall(0, 12, 0, 0, 0.25),
          wall(10, 0, 10, 5), wall(10, 7, 10, 12),
        ],
        rooms: [
          { id: 'room_board', name: 'Boardroom', points: rect(0, 0, 10, 12), color: '#fed7aa', data: { capacity: 20 } },
          { id: 'room_studio', name: 'Studio', points: rect(10, 0, 20, 12), color: '#a5f3fc', data: { capacity: 10 } },
        ],
        markers: [{ id: 'marker_screen', name: 'Main screen', kind: 'av', position: { x: 5, y: 0.6 } }],
      },
    ],
  };
}
