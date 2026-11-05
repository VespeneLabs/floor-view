import { describe, expect, it, vi } from 'vitest';

import {
  ArchitectController,
  ArchitectTransportError,
  architectBrief,
  type ArchitectEvent,
  type ArchitectTransport,
  type Scan,
} from '@vespenelabs/floorview/architect';
import { createMockArchitectModel, runArchitectTurn } from '@vespenelabs/floorview/architect/server';

const scan: Scan = { fileName: 'plant.png', dataUrl: 'data:image/png;base64,AAAA', base64: 'AAAA', mediaType: 'image/png', width: 1200, height: 800 };
const brief = { buildingType: 'Factory', floors: 'One', knownMeasurement: '', include: ['walls', 'rooms'], notes: '' };
const renderPreview = vi.fn(async () => ({ base64: 'BBBB', mediaType: 'image/jpeg' as const }));

/** The mock model behind runArchitectTurn, as an in-process transport (no HTTP). */
const mockTransport: ArchitectTransport = (request, signal) => runArchitectTurn(request, createMockArchitectModel({ latency: 0 }), { signal });

function settle(controller: ArchitectController): Promise<void> {
  return new Promise((resolve) => {
    const check = () => controller.getState().status !== 'working' && (off(), resolve());
    const off = controller.on('change', check);
    check();
  });
}

describe('ArchitectController', () => {
  it('runs the tool loop: questions, answers, a proposal with a preview, then a summary', async () => {
    const controller = new ArchitectController({ transport: mockTransport, renderPreview });
    const proposals: number[] = [];
    controller.on('proposal', (p) => proposals.push(p.version));

    controller.start(scan, architectBrief(scan, brief), 'Uploaded plant.png');
    await settle(controller);
    let state = controller.getState();
    expect(state.status).toBe('answering');
    const questions = state.items.find((i) => i.kind === 'questions');
    expect(questions?.kind === 'questions' && questions.questions.map((q) => q.id)).toEqual(['scale', 'mezzanine']);

    controller.answer({ scale: 'About 90 m', mezzanine: 'No' });
    await settle(controller);
    state = controller.getState();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
    expect(proposals).toEqual([1]);
    expect(state.proposal?.plan.levels[0]?.rooms.map((r) => r.name)).toContain('Warehouse');
    expect(state.proposal?.underlay).toMatchObject({ url: scan.dataUrl, x: 0, y: 0 });
    expect(state.items.at(-1)).toMatchObject({ kind: 'assistant' });

    const messages = controller.getMessages();
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // The proposal's tool result carries the summary text and the rendered preview image.
    const result = (messages[4]!.content as { type: string; content?: unknown }[])[0]!;
    expect(result.type).toBe('tool_result');
    expect(JSON.stringify(result.content)).toContain('"data":"BBBB"');
    expect(renderPreview).toHaveBeenCalledOnce();
  });

  it('keeps earlier turns unchanged (append-only)', async () => {
    const controller = new ArchitectController({ transport: mockTransport, renderPreview });
    controller.start(scan, architectBrief(scan, brief));
    await settle(controller);
    const before = JSON.stringify(controller.getMessages());
    controller.send('About 50 m, no mezzanine');
    await settle(controller);
    expect(JSON.stringify(controller.getMessages()).startsWith(before.slice(0, -1))).toBe(true);
  });

  it('reports transport errors and retries the same conversation', async () => {
    let calls = 0;
    const transport: ArchitectTransport = async function* () {
      calls++;
      if (calls === 1) throw new ArchitectTransportError('The assistant endpoint answered 503', true, 503);
      yield { type: 'text', text: 'Hello' } satisfies ArchitectEvent;
      yield { type: 'done', content: [{ type: 'text', text: 'Hello' }], stopReason: 'end_turn' } satisfies ArchitectEvent;
    };
    const controller = new ArchitectController({ transport, renderPreview });
    controller.start(scan, 'hi');
    await settle(controller);
    expect(controller.getState().error).toEqual({ message: 'The assistant endpoint answered 503', retryable: true });
    expect(controller.getMessages()).toHaveLength(1);

    controller.retry();
    await settle(controller);
    expect(controller.getState().error).toBeNull();
    expect(controller.getMessages().map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('sends invalid proposals back to the model as an error tool result', async () => {
    const turns: ArchitectEvent[][] = [
      [{ type: 'done', stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_floor_plan', input: { metersPerPixel: -1 } }] }],
      [{ type: 'done', stopReason: 'end_turn', content: [{ type: 'text', text: 'Fixed.' }] }],
    ];
    const seen: unknown[] = [];
    const transport: ArchitectTransport = async function* (request) {
      seen.push(structuredClone(request.messages.at(-1)));
      yield* turns.shift()!;
    };
    const controller = new ArchitectController({ transport, renderPreview });
    controller.start(scan, 'hi');
    await settle(controller);
    expect(seen[1]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] });
    expect(controller.getState().proposal).toBeNull();
  });

  it('stops a streaming turn without an error', async () => {
    const transport: ArchitectTransport = async function* (_request, signal) {
      yield { type: 'thinking', text: 'Reading…' };
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
    };
    const controller = new ArchitectController({ transport, renderPreview });
    controller.start(scan, 'hi');
    await vi.waitFor(() => expect(controller.getState().activity?.thinking).toBe('Reading…'));
    controller.stop();
    await settle(controller);
    expect(controller.getState()).toMatchObject({ status: 'idle', error: null, activity: null });
  });
});
