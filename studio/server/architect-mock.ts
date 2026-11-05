import type Anthropic from '@anthropic-ai/sdk';

import type { ArchitectEvent } from '../src/features/import/protocol.ts';

/**
 * Scripted stand-in for the assistant (ARCHITECT_MOCK=1): asks questions, proposes a generic
 * factory sized to the uploaded image, then summarizes. Lets the wizard be demoed and tested
 * without credentials; it does not look at the drawing.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Block = Anthropic.Beta.BetaContentBlock;
const text = (value: string): Block => ({ type: 'text', text: value, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input }) as Block;

function imageSize(messages: Anthropic.Beta.BetaMessageParam[]): { width: number; height: number } {
  const first = messages[0];
  const blocks = typeof first?.content === 'string' ? [{ type: 'text', text: first.content }] : (first?.content ?? []);
  for (const block of blocks) {
    const match = block.type === 'text' && 'text' in block ? /(\d+)\s*[×x]\s*(\d+)\s*px/.exec(block.text) : null;
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return { width: 1500, height: 1000 };
}

/** A generic factory layout in image pixels: production hall, warehouse, docks, offices. */
function factoryProposal(width: number, height: number) {
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
          { name: 'CNC line', kind: 'machine', x: r(x0 + (xs - x0) * 0.3), y: r(y0 + (ys - y0) * 0.4) },
          { name: 'Press', kind: 'machine', x: r(x0 + (xs - x0) * 0.7), y: r(y0 + (ys - y0) * 0.4) },
          { name: 'Dock 1', kind: 'loading-dock', x: r(xs + (x1 - xs) * 0.3), y: y1 },
          { name: 'Dock 2', kind: 'loading-dock', x: r(xs + (x1 - xs) * 0.7), y: y1 },
          { name: 'Main entrance', kind: 'exit', x: r((x0 + xo) / 2), y: y1 },
        ],
      },
    ],
    assumptions: ['This is a mock draft - it does not read your drawing.', 'Halls are 9 m high, offices 3.5 m.'],
  };
}

async function streamText(value: string, send: (e: ArchitectEvent) => void, stopped: () => boolean) {
  for (const word of value.split(/(?<= )/)) {
    if (stopped()) return;
    send({ type: 'text', text: word });
    await sleep(15);
  }
}

export async function mockTurn(
  messages: Anthropic.Beta.BetaMessageParam[],
  send: (e: ArchitectEvent) => void,
  stopped: () => boolean,
): Promise<void> {
  const turn = messages.filter((m) => m.role === 'assistant').length;
  const { width, height } = imageSize(messages);
  send({ type: 'thinking', text: 'Mock mode: no model is called. ' });
  await sleep(400);

  if (turn === 0) {
    const intro =
      "Thanks for the drawing! I'm running in mock mode, so I won't really read it - but here's how the conversation works. Two quick questions before I draft:";
    await streamText(intro, send, stopped);
    send({
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
    });
    return;
  }

  const last = messages[messages.length - 1];
  const lastIsToolResult =
    Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result' && b.tool_use_id !== 'toolu_mock_ask');
  if (lastIsToolResult) {
    const summary =
      "Here's a first draft: a production hall and a warehouse under one roof, with offices, a canteen and a loading area along the south side, two docks and the main entrance. I assumed the building is 90 m wide. Tell me what to change - for example room names, sizes or missing areas.";
    await streamText(summary, send, stopped);
    send({ type: 'done', stopReason: 'end_turn', content: [text(summary)] });
    return;
  }

  for (let chars = 2000; chars <= 6000; chars += 2000) {
    if (stopped()) return;
    send({ type: 'tool_progress', chars });
    await sleep(250);
  }
  send({
    type: 'done',
    stopReason: 'tool_use',
    content: [toolUse(`toolu_mock_plan_${turn}`, 'propose_floor_plan', factoryProposal(width, height))],
  });
}
