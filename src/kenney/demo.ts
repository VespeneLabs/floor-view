import { PLAN_FORMAT_VERSION, type FloorPlan, type Marker, type Point, type Wall } from '../model/types';
import type { KenneyKitId } from './catalog';

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

/**
 * A demo site furnished with Kenney models (`kenneyAssets`): a factory floor (two production
 * lines, machining, storage, a loading yard, offices, a break room and first aid) and a small
 * clinic on the level above the offices. Door openings are gaps between wall segments.
 * Ids are stable, so the plan works in tests and docs.
 */
export function createKenneyDemoPlan(): FloorPlan {
  let wallSeq = 0;
  let markerSeq = 0;
  const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.12, height?: number): Wall => ({
    id: `wall_d${++wallSeq}`,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    ...(height ? { height } : {}),
  });
  /** A marker showing a Kenney model: name, kit/model, position, rotation (° clockwise), extras. */
  const item = (name: string, kit: KenneyKitId, model: string, x: number, y: number, rotation = 0, extra: Partial<Marker> = {}): Marker => ({
    id: `item_${++markerSeq}`,
    name,
    kind: kit === 'furniture' || kit === 'station' ? 'furniture' : kit === 'vehicles' ? 'vehicle' : 'equipment',
    position: { x, y },
    model: `kenney/${kit}/${model}`,
    ...(rotation ? { rotation } : {}),
    ...extra,
  });
  const row = (count: number, step: number, make: (i: number) => Marker): Marker[] => Array.from({ length: count }, (_, i) => make(i * step));

  // ------------------------------------------------------------------ ground floor
  const OFFICE_H = 3;
  const groundWalls: Wall[] = [
    // exterior: lobby entrance (north, x 28–30) and loading door (south, x 8–14)
    wall(0, 0, 28, 0, 0.3), wall(30, 0, 36, 0, 0.3),
    wall(36, 0, 36, 22, 0.3),
    wall(36, 22, 14, 22, 0.3), wall(8, 22, 0, 22, 0.3),
    wall(0, 22, 0, 0, 0.3),
    // hall / office block, doors at y 3–5 and 9–11
    wall(24, 0, 24, 3, 0.2), wall(24, 5, 24, 9, 0.2), wall(24, 11, 24, 22, 0.2),
    // office partitions (lower than the hall)
    wall(24, 6, 29, 6, 0.12, OFFICE_H), wall(31, 6, 36, 6, 0.12, OFFICE_H),
    wall(24, 13, 26, 13, 0.12, OFFICE_H), wall(28, 13, 33, 13, 0.12, OFFICE_H), wall(34.5, 13, 36, 13, 0.12, OFFICE_H),
    wall(31, 13, 31, 19, 0.12, OFFICE_H), wall(31, 20.5, 31, 22, 0.12, OFFICE_H),
    wall(31, 18, 36, 18, 0.12, OFFICE_H),
  ];

  const conveyorLine = (y: number) => row(6, 2.6, (dx) => item('Conveyor', 'factory', 'conveyor-long', 4.3 + dx, y));
  const groundMarkers: Marker[] = [
    // production line A
    item('Press A', 'factory', 'machine', 1.9, 5),
    ...conveyorLine(5),
    item('Robot arm A1', 'factory', 'robot-arm-a', 6.9, 3.3),
    item('Robot arm A2', 'factory', 'robot-arm-a', 12.1, 3.3),
    item('Quality scanner', 'factory', 'scanner-high', 16, 5),
    item('Output pallet A', 'factory', 'box-large', 20.4, 5),
    // production line B
    item('Press B', 'factory', 'machine-fortified', 1.9, 11),
    ...conveyorLine(11),
    item('Robot arm B1', 'factory', 'robot-arm-b', 9.5, 12.7, 180),
    item('Robot arm B2', 'factory', 'robot-arm-b', 14.7, 12.7, 180),
    item('Hopper', 'factory', 'hopper-high-round', 20.3, 11),
    item('Line control', 'factory', 'screen-panel-wide', 21.5, 8, 270),
    // machining
    item('CNC 1', 'factory', 'machine-window', 3.5, 17.5, 90),
    item('CNC 2', 'factory', 'machine-window', 7, 17.5, 90),
    // storage racks and goods in
    ...row(3, 2, (dx) => item('Rack', 'shop', 'shelf-boxes', 17.5 + dx, 16.3)),
    ...row(3, 2, (dx) => item('Rack', 'shop', 'shelf-bags', 17.5 + dx, 19.6, 180)),
    item('Pallet', 'factory', 'box-large', 11.8, 19.2),
    item('Pallet', 'factory', 'box-large', 13.4, 19.2),
    item('Crate', 'factory', 'box-wide', 12.6, 17.6),
    item('Hand truck', 'shop', 'hand-truck', 10.4, 20.4, 90),
    item('Cone', 'factory', 'cone', 7.6, 21.4),
    item('Cone', 'factory', 'cone', 14.4, 21.4),
    item('Signal light', 'factory', 'warning-traffic', 23.4, 2.4),
    item('Signal light', 'factory', 'warning-traffic', 23.4, 8.4),
    // loading yard
    item('Truck', 'vehicles', 'truck', 11, 27.6),
    item('Van', 'vehicles', 'van', 15.6, 27.8),
    item('Container 1', 'industrial', 'shipping-container-a', 2.2, 27.2),
    item('Container 2', 'industrial', 'shipping-container-b', 5.4, 27.2),
    item('Coolant tank', 'industrial', 'detail-tank', 20.6, 29.8),
    item('Cone', 'vehicles', 'cone', 14.2, 23.6),
    item('Cone', 'vehicles', 'cone', 17, 23.6),
    // lobby
    item('Reception desk', 'furniture', 'deskCorner', 34, 2.2, 180),
    item('Reception chair', 'furniture', 'chairDesk', 34.4, 3.4, 180),
    item('Sofa', 'furniture', 'loungeSofa', 26.2, 0.7),
    item('Coffee table', 'furniture', 'tableCoffee', 26.2, 2.1),
    item('Armchair', 'furniture', 'loungeChair', 26.2, 3.6, 180),
    item('Plant', 'furniture', 'pottedPlant', 24.6, 5.4),
    item('Plant', 'furniture', 'pottedPlant', 35.4, 5.4),
    item('Coat rack', 'furniture', 'coatRackStanding', 31, 0.6),
    // open office: two back-to-back desk clusters
    ...[25.9, 27.5, 29.9, 31.5].flatMap((x, i) => [
      item(`Desk ${2 * i + 1}`, 'furniture', 'desk', x, 8.9, 180),
      item(`Desk ${2 * i + 2}`, 'furniture', 'desk', x, 9.7),
      item('Office chair', 'furniture', 'chairDesk', x, 7.9),
      item('Office chair', 'furniture', 'chairDesk', x, 10.7, 180),
    ]),
    item('Bookcase', 'furniture', 'bookcaseClosedWide', 35.6, 9.5, 90),
    item('Plant', 'furniture', 'pottedPlant', 33.6, 12.4),
    // break room
    item('Kitchen cabinet', 'furniture', 'kitchenCabinet', 24.6, 21.4, 180),
    item('Sink', 'furniture', 'kitchenSink', 25.5, 21.4, 180),
    item('Kitchen cabinet', 'furniture', 'kitchenCabinet', 26.4, 21.4, 180),
    item('Fridge', 'furniture', 'kitchenFridge', 27.4, 21.6, 180),
    ...[26, 29].flatMap((x) => [
      item('Table', 'furniture', 'table', x, 17),
      item('Chair', 'furniture', 'chair', x - 0.45, 16.25),
      item('Chair', 'furniture', 'chair', x + 0.45, 16.25),
      item('Chair', 'furniture', 'chair', x - 0.45, 17.75, 180),
      item('Chair', 'furniture', 'chair', x + 0.45, 17.75, 180),
    ]),
    item('Bin', 'furniture', 'trashcan', 30.5, 21.5),
    // first aid
    item('Treatment bed', 'furniture', 'bedSingle', 35.2, 15.5),
    item('Wheelchair', 'prototype', 'wheelchair', 32.4, 16.9),
    item('Wash basin', 'furniture', 'bathroomSink', 32, 13.4),
    item('Medicine cabinet', 'furniture', 'bathroomCabinet', 33.2, 17.8, 180),
    // WC
    item('Toilet', 'furniture', 'toilet', 33, 21.4, 180),
    item('Toilet', 'furniture', 'toilet', 35, 21.4, 180),
    item('Wash basin', 'furniture', 'bathroomSink', 35.4, 18.4),
  ];

  // ------------------------------------------------------------------ clinic (level 1)
  const clinicWalls: Wall[] = [
    wall(24, 0, 36, 0, 0.25), wall(36, 0, 36, 22, 0.25), wall(36, 22, 24, 22, 0.25), wall(24, 22, 24, 0, 0.25),
    // reception / wards; the corridor (x 29–31) opens onto reception
    wall(24, 5, 29, 5), wall(31, 5, 36, 5),
    // corridor walls with doors
    wall(29, 5, 29, 6.5), wall(29, 8, 29, 12), wall(29, 13.5, 29, 18), wall(29, 19.5, 29, 22),
    wall(31, 5, 31, 6.5), wall(31, 8, 31, 12), wall(31, 13.5, 31, 18), wall(31, 19.5, 31, 22),
    // between rooms
    wall(24, 10.5, 29, 10.5), wall(31, 10.5, 36, 10.5), wall(24, 16, 29, 16), wall(31, 16, 36, 16),
  ];
  const ward = (n: number, x: number, y: number, flip: boolean): Marker[] => {
    const side = flip ? -1 : 1; // beds against the outer wall, equipment toward the corridor
    const bedX = flip ? 35.2 : 24.8;
    return [
      item(`Bed ${n}`, 'furniture', 'bedSingle', bedX, y + 2.4),
      item('Bedside table', 'furniture', 'sideTableDrawers', bedX + side * 0.2, y + 0.6),
      item('Monitor', 'station', 'display-wall', bedX + side * 1.4, y + 1.6, flip ? 270 : 90),
      item('Visitor chair', 'furniture', 'chairCushion', x + side * 0.2, y + 3.8, flip ? 270 : 90),
    ];
  };
  const clinicMarkers: Marker[] = [
    // reception and waiting
    item('Reception desk', 'furniture', 'deskCorner', 34, 2, 180),
    item('Reception chair', 'furniture', 'chairDesk', 34.4, 1.1),
    ...row(4, 0.6, (dx) => item('Waiting chair', 'furniture', 'chairCushion', 25 + dx, 0.6)),
    ...row(4, 0.6, (dx) => item('Waiting chair', 'furniture', 'chairCushion', 25 + dx, 3.4, 180)),
    item('Coffee table', 'furniture', 'tableCoffee', 25.9, 2),
    item('Plant', 'furniture', 'pottedPlant', 28.4, 0.6),
    item('Plant', 'furniture', 'pottedPlant', 31.6, 4.4),
    // wards
    ...ward(1, 27.5, 5, false),
    ...ward(2, 27.5, 10.5, false),
    ...ward(3, 32.5, 5, true),
    ...ward(4, 32.5, 10.5, true),
    // treatment room
    item('Examination table', 'station', 'bed-single', 26.5, 19),
    item('Diagnostics', 'station', 'computer-wide', 25.2, 21.3, 180),
    item('Supplies', 'station', 'container-tall', 24.8, 16.8),
    item('Wash basin', 'furniture', 'bathroomSink', 28.3, 16.4),
    item('Wheelchair', 'prototype', 'wheelchair', 28, 21.2),
    // staff room
    item('Staff table', 'furniture', 'table', 33.5, 18.6),
    item('Chair', 'furniture', 'chair', 33, 17.85),
    item('Chair', 'furniture', 'chair', 34, 17.85),
    item('Chair', 'furniture', 'chair', 33, 19.35, 180),
    item('Chair', 'furniture', 'chair', 34, 19.35, 180),
    item('Sofa', 'furniture', 'loungeSofa', 33.5, 21.4, 180),
    item('Fridge', 'furniture', 'kitchenFridge', 35.6, 16.6, 90),
    item('Kitchen cabinet', 'furniture', 'kitchenCabinet', 35.5, 17.6, 90),
    // corridor
    item('Wheelchair', 'prototype', 'wheelchair', 30, 21.2),
  ];

  return {
    version: PLAN_FORMAT_VERSION,
    id: 'plan_kenney_demo',
    name: 'Vespene Works (3D assets demo)',
    levels: [
      {
        id: 'level_factory',
        name: 'Factory floor',
        elevation: 0,
        height: 4.5,
        walls: groundWalls,
        rooms: [
          { id: 'room_hall', name: 'Production hall', points: rect(0, 0, 24, 22), color: '#cbd5e1', data: { capacity: 30 } },
          { id: 'room_yard', name: 'Loading yard', points: rect(0, 22, 24, 32), color: '#d6d3d1' },
          { id: 'room_lobby', name: 'Lobby', points: rect(24, 0, 36, 6), color: '#bbf7d0', data: { capacity: 10 } },
          { id: 'room_office', name: 'Open office', points: rect(24, 6, 36, 13), color: '#bae6fd', data: { capacity: 12 } },
          { id: 'room_break', name: 'Break room', points: rect(24, 13, 31, 22), color: '#fde68a', data: { capacity: 16 } },
          { id: 'room_aid', name: 'First aid', points: rect(31, 13, 36, 18), color: '#fecaca', data: { capacity: 2 } },
          { id: 'room_wc', name: 'WC', points: rect(31, 18, 36, 22), color: '#e9d5ff' },
        ],
        markers: groundMarkers,
      },
      {
        id: 'level_clinic',
        name: 'Clinic',
        elevation: 4.5,
        height: 3,
        walls: clinicWalls,
        rooms: [
          { id: 'room_reception', name: 'Reception', points: rect(24, 0, 36, 5), color: '#bbf7d0', data: { capacity: 12 } },
          { id: 'room_corridor', name: 'Corridor', points: rect(29, 5, 31, 22), color: '#e2e8f0' },
          { id: 'room_ward1', name: 'Ward 1', points: rect(24, 5, 29, 10.5), color: '#bfdbfe', data: { capacity: 1 } },
          { id: 'room_ward2', name: 'Ward 2', points: rect(24, 10.5, 29, 16), color: '#bfdbfe', data: { capacity: 1 } },
          { id: 'room_ward3', name: 'Ward 3', points: rect(31, 5, 36, 10.5), color: '#bfdbfe', data: { capacity: 1 } },
          { id: 'room_ward4', name: 'Ward 4', points: rect(31, 10.5, 36, 16), color: '#bfdbfe', data: { capacity: 1 } },
          { id: 'room_treatment', name: 'Treatment', points: rect(24, 16, 29, 22), color: '#fecaca', data: { capacity: 3 } },
          { id: 'room_staff', name: 'Staff room', points: rect(31, 16, 36, 22), color: '#fde68a', data: { capacity: 6 } },
        ],
        markers: clinicMarkers,
      },
    ],
  };
}
