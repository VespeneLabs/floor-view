/**
 * The demo site of the gas detection page: one process building with a compressor hall, a hydrogen
 * plant, a boiler house, an inert gas store, a laboratory, a control room, effluent treatment and a
 * cylinder store, furnished with Gas kit models, three gas lines and 19 fixed gas detectors.
 * Door openings are gaps between wall segments. Ids are stable.
 *
 * A detector is a marker of kind `DETECTOR_KIND` whose `data` names its gas and detector model, so
 * the page also works on any other plan that has such markers.
 */
import { PLAN_FORMAT_VERSION, type FloorPlan, type Marker, type Pipeline, type Point, type Room, type Wall } from '@vespenelabs/floorview';
import { gasAssetId, gasMedium } from '@vespenelabs/floorview/gas';

import { GASES, type GasId } from './gases';

export const DETECTOR_KIND = 'gas-detector';

/**
 * Detector model per gas. The names are fixed detectors of the Teledyne Gas and Flame Detection
 * range, matched to the gas by sensing technology: infrared for methane, catalytic for hydrogen
 * (infrared does not see it), electrochemical for toxic gases and oxygen.
 */
const DETECTOR_MODELS: Record<GasId, string> = {
  CH4: 'OLCT 100 XP IR',
  H2: 'OLCT 100 XP',
  H2S: 'OLCT 100 IS',
  CO: 'OLCT 100 IS',
  O2: 'OLCT 100 IS',
};

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

export function createGasDemoPlan(): FloorPlan {
  let wallSeq = 0;
  let itemSeq = 0;
  const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.2): Wall => ({
    id: `wall_g${++wallSeq}`,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
  });
  const room = (id: string, name: string, points: Point[], color: string): Room => ({ id: `room_${id}`, name, points, color });
  /** Equipment: a marker showing a model (`asset` is a full asset id). Rotation in degrees, clockwise. */
  const item = (name: string, asset: string, x: number, y: number, rotation = 0): Marker => ({
    id: `equip_${++itemSeq}`,
    name,
    kind: 'equipment',
    position: { x, y },
    model: asset,
    ...(rotation ? { rotation } : {}),
  });
  const gas = (name: string, model: string, x: number, y: number, rotation = 0) => item(name, gasAssetId(model), x, y, rotation);
  const detector = (tag: string, gasId: GasId, x: number, y: number, model = DETECTOR_MODELS[gasId]): Marker => ({
    id: `det_${tag.toLowerCase().replace(/\W+/g, '_')}`,
    name: tag,
    kind: DETECTOR_KIND,
    position: { x, y },
    model: gasAssetId('gas-detection-post'),
    color: GASES[gasId].color,
    data: { gas: gasId, model },
  });
  const pipe = (id: string, name: string, medium: string, points: [number, number, number][]): Pipeline => {
    const preset = gasMedium(medium);
    // Hydrogen's preset color is red, which this page keeps for alarms: its pipes take the gas's color.
    const color = medium === 'H2' ? GASES.H2.color : preset?.color;
    return {
      id: `pipe_${id}`,
      name,
      medium,
      diameter: preset?.diameter ?? 0.025,
      ...(color ? { color } : {}),
      points: points.map(([x, y, z]) => ({ x, y, z })),
    };
  };

  const walls: Wall[] = [
    // exterior: west corridor exit (y 11.75–13.25) and the cylinder store loading door (south, x 34–40)
    wall(0, 0, 44, 0, 0.3),
    wall(44, 0, 44, 26, 0.3),
    wall(44, 26, 40, 26, 0.3),
    wall(34, 26, 0, 26, 0.3),
    wall(0, 26, 0, 13.25, 0.3),
    wall(0, 11.75, 0, 0, 0.3),
    // corridor, north side (one door per room)
    wall(0, 11, 6, 11), wall(7.5, 11, 18, 11), wall(19.4, 11, 28, 11), wall(29.4, 11, 38, 11), wall(39.4, 11, 44, 11),
    // corridor, south side
    wall(0, 14, 5, 14), wall(6.4, 14, 15, 14), wall(16.4, 14, 24, 14), wall(25.4, 14, 36, 14), wall(37.4, 14, 44, 14),
    // partitions
    wall(14, 0, 14, 11), wall(24, 0, 24, 11), wall(33, 0, 33, 11),
    wall(12, 14, 12, 26), wall(19, 14, 19, 26), wall(31, 14, 31, 26),
  ];

  const rooms: Room[] = [
    room('compressor', 'Compressor hall', rect(0, 0, 14, 11), '#e2e8f0'),
    room('hydrogen', 'Hydrogen plant', rect(14, 0, 24, 11), '#dbeafe'),
    room('boiler', 'Boiler house', rect(24, 0, 33, 11), '#fde68a'),
    room('inert', 'Inert gas store', rect(33, 0, 44, 11), '#ddd6fe'),
    room('corridor', 'Corridor', rect(0, 11, 44, 14), '#f1f5f9'),
    room('lab', 'Laboratory', rect(0, 14, 12, 26), '#bbf7d0'),
    room('control', 'Control room', rect(12, 14, 19, 26), '#fbcfe8'),
    room('effluent', 'Effluent treatment', rect(19, 14, 31, 26), '#bae6fd'),
    room('cylinders', 'Cylinder store', rect(31, 14, 44, 26), '#fed7aa'),
  ];

  const equipment: Marker[] = [
    // compressor hall
    gas('Natural gas service entry', 'pipeline-entry', 1.2, 2),
    gas('Compressor K-101', 'air-compressor-skid', 5, 3.2),
    gas('Compressor K-102', 'air-compressor-skid', 5, 7.2),
    gas('Gas manifold', 'valve-manifold-panel', 10.5, 1),
    gas('Gas cooler', 'chiller-unit', 10.5, 7.4),
    gas('Compressor MCC', 'electrical-cabinet', 13.5, 8.5, 90),
    gas('ESD button', 'esd-button-post', 8.2, 10.5, 180),
    gas('Fire extinguishers', 'fire-extinguisher-stand', 9.4, 10.6, 180),
    // hydrogen plant
    gas('Electrolyser', 'hydrogen-generator', 17.5, 1.2),
    gas('H₂ purifier', 'gas-purifier', 21, 1),
    ...[5, 6.6, 8.2].map((y, i) => gas(`H₂ bundle ${i + 1}`, 'cylinder-bundle', 15, y, 270)),
    gas('H₂ valve box', 'valve-manifold-box', 22.8, 5.5, 90),
    gas('Gas cabinet 1', 'gas-cabinet', 20.8, 10.4, 180),
    gas('Gas cabinet 2', 'gas-cabinet', 21.9, 10.4, 180),
    // boiler house
    ...[26, 27.2, 28.4].map((x, i) => gas(`Boiler ${i + 1}`, 'wall-boiler', x, 0.35)),
    gas('Hydraulic separator', 'hydraulic-separator', 30.2, 0.3),
    gas('Expansion vessel', 'expansion-vessel-large', 31.6, 0.4),
    gas('Hot water cylinder 1', 'hot-water-cylinder', 32, 3.2),
    gas('Hot water cylinder 2', 'hot-water-cylinder', 32, 4.4),
    gas('Water filter station', 'water-filter-station', 24.25, 6, 270),
    gas('Heating manifold', 'ufh-manifold-cabinet', 32.75, 8, 90),
    // inert gas store
    ...[1.5, 2.6, 3.7, 4.8].map((y, i) => gas(`LN₂ dewar ${i + 1}`, 'dewar', 34.2, y)),
    gas('Nitrogen generator', 'nitrogen-generator', 39, 1.2),
    gas('Gas mixing panel', 'gas-mixing-panel', 42.4, 0.6),
    gas('Argon bank 1', 'gas-cylinder-bank', 43, 4.2, 90),
    gas('Argon bank 2', 'gas-cylinder-bank', 43, 6.4, 90),
    gas('Cylinder cart', 'cylinder-cart', 36.5, 9),
    // corridor
    gas('Emergency shower', 'emergency-shower', 13, 11.7),
    gas('Fire extinguishers', 'fire-extinguisher-stand', 22, 11.4),
    gas('ESD button', 'esd-button-post', 31, 11.4),
    // laboratory
    ...[4, 8].flatMap((x, i) => [
      gas(`Bench ${2 * i + 1}`, 'lab-workbench', x, 19),
      gas(`Bench ${2 * i + 2}`, 'lab-workbench', x, 22.4),
      gas('Stool', 'lab-stool', x, 19.9),
      gas('Stool', 'lab-stool', x, 23.3),
    ]),
    gas('Fume hood 1', 'fume-hood', 2.6, 25.4, 180),
    gas('Fume hood 2', 'fume-hood', 4.3, 25.4, 180),
    gas('Solvent cabinet', 'flammable-cabinet', 0.55, 16.5, 270),
    gas('Calibration gas cabinet', 'gas-cabinet', 10.4, 25.5, 180),
    gas('Lab gas panel', 'regulator-panel-4', 11.75, 20, 90),
    // control room
    gas('MX 43 controller cabinet', 'electrical-cabinet', 13.6, 25.5, 180),
    gas('Power distribution', 'electrical-cabinet', 15, 25.5, 180),
    item('Operator desk 1', 'kenney/furniture/desk', 14.2, 17.4),
    item('Operator desk 2', 'kenney/furniture/desk', 16.6, 17.4),
    item('Chair', 'kenney/furniture/chairDesk', 14.2, 18.4, 180),
    item('Chair', 'kenney/furniture/chairDesk', 16.6, 18.4, 180),
    // effluent treatment
    ...[16, 17.4, 18.8].map((y, i) => gas(`Dosing tote ${i + 1}`, 'ibc-tote', 20.2, y)),
    gas('Odor scrubber', 'scrubber-tower', 25.2, 20.2),
    gas('Exhaust fan', 'exhaust-fan', 21.4, 24.6),
    gas('Chemical dosing', 'chemical-dispense-cabinet', 28, 25.3, 180),
    gas('Drums', 'drum-spill-pallet', 29.8, 16),
    gas('Drum', 'drum', 29.9, 17.6),
    // cylinder store
    ...[17, 18.2, 19.4, 20.6].map((y, i) => gas(`Cylinder bundle ${i + 1}`, 'cylinder-bundle', 32, y, 270)),
    gas('Cylinder cage 1', 'cylinder-cage', 42.9, 17.4, 90),
    gas('Cylinder cage 2', 'cylinder-cage', 42.9, 21.4, 90),
    ...Array.from({ length: 6 }, (_, i) => gas(`Cylinder ${i + 1}`, 'gas-cylinder', 31.6 + i * 0.4, 25.5)),
    gas('Forklift', 'forklift', 37, 22.4),
    gas('Pallet jack', 'pallet-jack', 34.6, 23.6, 90),
    gas('Fire extinguishers', 'fire-extinguisher-stand', 38.4, 14.4),
  ];

  // The first detector of each gas marks where that gas's simulated release starts (simulation.ts).
  const detectors: Marker[] = [
    detector('GD-101', 'CH4', 3.4, 5.2, 'GD10P'),
    detector('GD-102', 'CH4', 8, 5.6, 'GD10P'),
    detector('GD-103', 'CH4', 11.6, 3, 'GD10P'),
    detector('GD-201', 'H2', 18.5, 3.6),
    detector('GD-202', 'H2', 17, 7.4),
    detector('GD-301', 'CO', 27.2, 2.6),
    detector('GD-302', 'CH4', 29.8, 5),
    detector('GD-303', 'CO', 27.5, 8),
    detector('GD-401', 'O2', 36, 3.2),
    detector('GD-402', 'O2', 40.5, 7),
    detector('GD-501', 'CH4', 9, 12.5),
    detector('GD-502', 'O2', 37, 12.5),
    detector('GD-601', 'H2', 6, 20.7),
    detector('GD-602', 'O2', 10, 23.6),
    detector('GD-701', 'H2S', 23, 17.5),
    detector('GD-702', 'H2S', 27.6, 21.6),
    detector('GD-703', 'CH4', 22, 22),
    detector('GD-801', 'H2', 34.5, 18.8),
    detector('GD-802', 'O2', 39.5, 19),
  ];

  const pipelines: Pipeline[] = [
    pipe('ng_main', 'Natural gas 1', 'NG', [[1.2, 2, 1.1], [1.2, 2, 3.2], [1.2, 5.2, 3.2], [10.5, 5.2, 3.2], [10.5, 1.4, 3.2], [10.5, 1.4, 1.6]]),
    pipe('ng_boilers', 'Natural gas 2', 'NG', [[10.5, 5.2, 3.2], [10.5, 12.4, 3.2], [29.6, 12.4, 3.2], [29.6, 1.2, 3.2], [27.2, 1.2, 3.2], [27.2, 1.2, 2.4]]),
    pipe('h2_main', 'Hydrogen 1', 'H2', [[17.5, 2, 3], [17.5, 5.5, 3], [22.8, 5.5, 3], [22.8, 5.5, 1.8]]),
    pipe('h2_lab', 'Hydrogen 2', 'H2', [[22.8, 5.5, 3], [22.8, 11.8, 3], [11.4, 11.8, 3], [11.4, 20, 3], [11.4, 20, 1.5]]),
    pipe('n2_lab', 'Nitrogen 1', 'N2', [[39, 2, 3.4], [39, 13.2, 3.4], [9.8, 13.2, 3.4], [9.8, 21.6, 3.4], [9.8, 21.6, 1.2]]),
  ];

  return {
    version: PLAN_FORMAT_VERSION,
    id: 'plan_gas_demo',
    name: 'Gas detection demo site',
    levels: [
      {
        id: 'level_process',
        name: 'Process building',
        elevation: 0,
        height: 4,
        walls,
        rooms,
        markers: [...equipment, ...detectors],
        pipelines,
      },
    ],
  };
}
