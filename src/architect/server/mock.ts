import type { ArchitectAsset, ArchitectContentBlock, ArchitectEvent, ArchitectMessage } from '../protocol';
import type { ArchitectModel } from './run';

/**
 * Scripted stand-in for the assistant: asks two questions, proposes a generic factory sized to the
 * uploaded image (furnished with 3D models when the request's asset catalog has the Kenney ids it
 * uses), then summarizes. For demos, host tests and e2e runs without credentials; it
 * does not look at the drawing. It reads the image size from a "W × H px" mention in the first
 * message (as `architectBrief` writes it).
 */

type Block = ArchitectContentBlock;
const text = (value: string): Block => ({ type: 'text', text: value });
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input });

function imageSize(messages: ArchitectMessage[]): { width: number; height: number } {
  const first = messages[0];
  const blocks: Block[] = typeof first?.content === 'string' ? [text(first.content)] : (first?.content ?? []);
  for (const block of blocks) {
    const match = block.type === 'text' && typeof block.text === 'string' ? /(\d+)\s*[×x]\s*(\d+)\s*px/.exec(block.text) : null;
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return { width: 1500, height: 1000 };
}

type MockMarker = { name: string; kind: string; x: number; y: number; model?: string; rotation?: number };

/**
 * Equipment and furniture for the mock factory as 3D models, in image pixels. `at(xm, ym)` maps
 * meters from a room's top-left corner to pixels. Only models in `available` are used.
 */
function furnish(
  rooms: { hall: [number, number]; warehouse: [number, number]; offices: [number, number]; canteen: [number, number]; loading: [number, number] },
  mpp: number,
  available: ReadonlySet<string>,
): MockMarker[] {
  const out: MockMarker[] = [];
  const add = (room: [number, number], name: string, kind: string, model: string, xm: number, ym: number, rotation = 0) => {
    if (!available.has(`kenney/${model}`)) return;
    out.push({
      name,
      kind,
      x: Math.round(room[0] + xm / mpp),
      y: Math.round(room[1] + ym / mpp),
      model: `kenney/${model}`,
      ...(rotation ? { rotation } : {}),
    });
  };
  // Two production lines: a machine feeding a chain of 2.6 m conveyor sections (running along x), robots beside it.
  for (const [line, y, machine] of [['A', 8, 'factory/machine'], ['B', 18, 'factory/machine-fortified']] as const) {
    add(rooms.hall, `Press ${line}`, 'machine', machine, 4, y);
    for (let i = 0; i < 6; i++) add(rooms.hall, `Conveyor ${line}${i + 1}`, 'conveyor', 'factory/conveyor-long', 6.1 + i * 2.6, y);
    add(rooms.hall, `Robot ${line}1`, 'machine', 'factory/robot-arm-a', 8.7, y - 2);
    add(rooms.hall, `Robot ${line}2`, 'machine', 'factory/robot-arm-a', 13.9, y - 2);
    add(rooms.hall, `Line ${line} status light`, 'signal', 'factory/warning-traffic', 21, y - 1.3);
  }
  // Racks in the warehouse: three rows with aisles.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) add(rooms.warehouse, `Rack ${row + 1}.${i + 1}`, 'rack', 'shop/shelf-boxes', 4 + i * 1.84, 6 + row * 5);
  }
  // Offices: desks facing down the page, chairs below them turned towards the desks.
  for (let i = 0; i < 3; i++) {
    add(rooms.offices, `Desk ${i + 1}`, 'furniture', 'furniture/desk', 3 + i * 3.5, 3);
    add(rooms.offices, `Office chair ${i + 1}`, 'furniture', 'furniture/chairDesk', 3 + i * 3.5, 3.85, 180);
  }
  // Canteen: two tables with a chair on each long side.
  for (let i = 0; i < 2; i++) {
    add(rooms.canteen, `Table ${i + 1}`, 'furniture', 'furniture/table', 4 + i * 3.5, 4);
    add(rooms.canteen, `Chair ${i * 2 + 1}`, 'furniture', 'furniture/chair', 4 + i * 3.5, 3.25);
    add(rooms.canteen, `Chair ${i * 2 + 2}`, 'furniture', 'furniture/chair', 4 + i * 3.5, 4.75, 180);
  }
  // Goods waiting at the docks.
  add(rooms.loading, 'Pallet 1', 'goods', 'factory/box-large', 3, 3);
  add(rooms.loading, 'Pallet 2', 'goods', 'factory/box-large', 4.6, 3);
  add(rooms.loading, 'Hand truck', 'equipment', 'shop/hand-truck', 7, 3);
  return out;
}

/** A generic factory layout in image pixels: production hall, warehouse, docks, offices. */
function factoryProposal(width: number, height: number, assets: readonly ArchitectAsset[] = []) {
  const m = Math.round(Math.min(width, height) * 0.08);
  const [x0, y0, x1, y1] = [m, m, width - m, height - m];
  const r = (v: number) => Math.round(v);
  const xs = r(x0 + (x1 - x0) * 0.62); // production | warehouse
  const ys = r(y0 + (y1 - y0) * 0.72); // halls | offices & docks
  const xo = r(x0 + (x1 - x0) * 0.3); // offices | canteen
  const mpp = 90 / (x1 - x0); // the building is 90 m wide
  const gap = r(1.2 / mpp); // ~1.2 m door
  const ext = 0.3;
  const int = 0.15;
  const models = furnish(
    { hall: [x0, y0], warehouse: [xs, y0], offices: [x0, ys], canteen: [xo, ys], loading: [xs, ys] },
    Number(mpp.toFixed(4)),
    new Set(assets.map((a) => a.id)),
  );
  const machines: MockMarker[] = models.length
    ? models
    : [
        { name: 'CNC line', kind: 'machine', x: r(x0 + (xs - x0) * 0.3), y: r(y0 + (ys - y0) * 0.4) },
        { name: 'Press', kind: 'machine', x: r(x0 + (xs - x0) * 0.7), y: r(y0 + (ys - y0) * 0.4) },
      ];
  return {
    name: 'Factory (mock draft)',
    metersPerPixel: Number(mpp.toFixed(4)),
    scaleSource: 'Mock mode: assumed a 90 m wide building.',
    levels: [
      {
        name: 'Ground floor',
        elevation: 0,
        height: 9,
        walls: [
          [x0, y0, x1, y0, ext],
          [x1, y0, x1, y1, ext],
          [x1, y1, x0, y1, ext],
          [x0, y1, x0, y0, ext],
          [xs, y0, xs, r((y0 + ys) / 2) - gap, int],
          [xs, r((y0 + ys) / 2) + gap, xs, ys, int],
          [x0, ys, r((x0 + xo) / 2) - gap, ys, int, 3.5],
          [r((x0 + xo) / 2) + gap, ys, xo + r((xs - xo) / 2) - gap, ys, int, 3.5],
          [xo + r((xs - xo) / 2) + gap, ys, x1, ys, int],
          [xo, ys, xo, y1, int, 3.5],
          [xs, ys, xs, y1, int],
        ],
        rooms: [
          { name: 'Production hall', use: 'production', points: [[x0, y0], [xs, y0], [xs, ys], [x0, ys]] },
          { name: 'Warehouse', use: 'warehouse', points: [[xs, y0], [x1, y0], [x1, ys], [xs, ys]] },
          { name: 'Offices', use: 'office', points: [[x0, ys], [xo, ys], [xo, y1], [x0, y1]] },
          { name: 'Canteen', use: 'canteen', points: [[xo, ys], [xs, ys], [xs, y1], [xo, y1]] },
          { name: 'Loading area', use: 'loading', points: [[xs, ys], [x1, ys], [x1, y1], [xs, y1]] },
        ],
        markers: [
          ...machines,
          { name: 'Dock 1', kind: 'loading-dock', x: r(xs + (x1 - xs) * 0.3), y: y1 },
          { name: 'Dock 2', kind: 'loading-dock', x: r(xs + (x1 - xs) * 0.7), y: y1 },
          { name: 'Main entrance', kind: 'exit', x: r((x0 + xo) / 2), y: y1 },
        ],
      },
    ],
    assumptions: [
      'This is a mock draft - it does not read your drawing.',
      'Halls are 9 m high, offices 3.5 m.',
      ...(models.length ? ['Machines, racks and furniture are example placements, not read from the drawing.'] : []),
    ],
  };
}

export interface MockArchitectModelOptions {
  /** Multiplies the scripted delays (word streaming, "thinking"). 0 for tests. Default 1. */
  latency?: number;
}

/** The scripted assistant as an `ArchitectModel`. */
export function createMockArchitectModel(options: MockArchitectModelOptions = {}): ArchitectModel {
  const latency = options.latency ?? 1;
  return {
    async *streamTurn({ messages, assets }, { signal, onUsage }) {
      const sleep = (ms: number) => (latency > 0 ? new Promise((r) => setTimeout(r, ms * latency)) : Promise.resolve());
      for await (const event of mockTurn(messages, assets, sleep)) {
        if (signal.aborted) return;
        if (event.type === 'done') onUsage?.({ model: 'mock', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        yield event;
      }
    },
  };
}

async function* streamText(value: string, sleep: (ms: number) => Promise<unknown>): AsyncGenerator<ArchitectEvent> {
  for (const word of value.split(/(?<= )/)) {
    yield { type: 'text', text: word };
    await sleep(15);
  }
}

async function* mockTurn(messages: ArchitectMessage[], assets: readonly ArchitectAsset[], sleep: (ms: number) => Promise<unknown>): AsyncGenerator<ArchitectEvent> {
  const turn = messages.filter((m) => m.role === 'assistant').length;
  const { width, height } = imageSize(messages);
  yield { type: 'thinking', text: 'Mock mode: no model is called. ' };
  await sleep(400);

  if (turn === 0) {
    const intro =
      "Thanks for the drawing! I'm running in mock mode, so I won't really read it - but here's how the conversation works. Two quick questions before I draft:";
    yield* streamText(intro, sleep);
    yield {
      type: 'done',
      stopReason: 'tool_use',
      content: [
        text(intro),
        toolUse('toolu_mock_ask', 'ask_user', {
          questions: [
            { id: 'scale', question: 'How wide is the building, roughly?', options: ['About 50 m', 'About 90 m', 'About 150 m', "I don't know"] },
            { id: 'mezzanine', question: 'Is there a mezzanine or upper floor above the offices?', options: ['No', 'Yes, partly', 'Yes, full floor'] },
          ],
        }),
      ],
    };
    return;
  }

  const last = messages[messages.length - 1];
  const lastIsToolResult =
    Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result' && b.tool_use_id !== 'toolu_mock_ask');
  if (lastIsToolResult) {
    const summary =
      "Here's a first draft: a production hall and a warehouse under one roof, with offices, a canteen and a loading area along the south side, two docks and the main entrance. I assumed the building is 90 m wide." +
      (assets.length ? ' I also placed example machines, conveyors, racks and furniture as 3D models.' : '') +
      ' Tell me what to change - for example room names, sizes or missing areas.';
    yield* streamText(summary, sleep);
    yield { type: 'done', stopReason: 'end_turn', content: [text(summary)] };
    return;
  }

  for (let chars = 2000; chars <= 6000; chars += 2000) {
    yield { type: 'tool_progress', chars };
    await sleep(250);
  }
  yield {
    type: 'done',
    stopReason: 'tool_use',
    content: [toolUse(`toolu_mock_plan_${turn}`, 'propose_floor_plan', factoryProposal(width, height, assets))],
  };
}
