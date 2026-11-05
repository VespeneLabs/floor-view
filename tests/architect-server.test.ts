// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createFetchTransport, ArchitectTransportError, type ArchitectEvent } from '@vespenelabs/floorview/architect';
import {
  ARCHITECT_SYSTEM,
  ArchitectRequestError,
  createAnthropicArchitectModel,
  createArchitectMiddleware,
  createMockArchitectModel,
  parseArchitectRequest,
  runArchitectTurn,
  type ArchitectModel,
  type ArchitectTurnInput,
} from '@vespenelabs/floorview/architect/server';

const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text', text }] });
const image = (bytes: number) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(Math.ceil((bytes * 4) / 3)) } });

async function collect(events: AsyncIterable<ArchitectEvent>) {
  const out: ArchitectEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('parseArchitectRequest', () => {
  it('accepts a valid conversation', () => {
    expect(parseArchitectRequest({ messages: [user('hi')] }).messages).toHaveLength(1);
  });

  it.each([
    [{}, 400],
    [{ messages: [] }, 400],
    [{ messages: [{ role: 'system', content: 'x' }] }, 400],
    [{ messages: [user('a'), { role: 'assistant', content: 'b' }] }, 400], // must end with the user
  ])('rejects %j with %i', (body, status) => {
    expect(() => parseArchitectRequest(body)).toThrow(expect.objectContaining({ name: 'ArchitectRequestError', status }));
  });

  it('enforces the size limits with 413', () => {
    const big = { messages: [{ role: 'user', content: [image(3 * 1024 * 1024)] }] };
    expect(() => parseArchitectRequest(big, { maxImageBytes: 2 * 1024 * 1024 })).toThrow(ArchitectRequestError);
    expect(() => parseArchitectRequest(big)).not.toThrow();
    const long = { messages: Array.from({ length: 5 }, () => user('x')) };
    expect(() => parseArchitectRequest(long, { maxMessages: 4 })).toThrow(expect.objectContaining({ status: 413 }));
    // Images inside tool results count too.
    const nested = { messages: [user('a'), { role: 'assistant', content: 'b' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image(10), image(10)] }] }] };
    expect(() => parseArchitectRequest(nested, { maxImages: 1 })).toThrow(expect.objectContaining({ status: 413 }));
  });
});

describe('runArchitectTurn', () => {
  it('passes the agent prompt plus the host instructions to the model', async () => {
    let input: ArchitectTurnInput | undefined;
    const model: ArchitectModel = {
      async *streamTurn(i) {
        input = i;
        yield { type: 'done', content: [], stopReason: 'end_turn' };
      },
    };
    await collect(runArchitectTurn({ messages: [user('hi')] }, model, { extraInstructions: '  Mark rooms with gas equipment.  ' }));
    expect(input?.system).toEqual([ARCHITECT_SYSTEM, 'Mark rooms with gas equipment.']);
    expect(input?.tools.map((t) => t.name)).toEqual(['ask_user', 'propose_floor_plan']);
  });

  it('turns invalid requests, throws and unfinished turns into error events', async () => {
    const throwing: ArchitectModel = {
      async *streamTurn() {
        yield { type: 'text', text: 'Hm' };
        throw new Error('boom');
      },
    };
    const errors: unknown[] = [];
    expect(await collect(runArchitectTurn({ messages: [] }, throwing))).toEqual([
      expect.objectContaining({ type: 'error', retryable: false }),
    ]);
    expect((await collect(runArchitectTurn({ messages: [user('hi')] }, throwing, { onError: (e) => errors.push(e) }))).at(-1)).toMatchObject({
      type: 'error',
      retryable: true,
    });
    expect(errors).toHaveLength(1);

    const silent: ArchitectModel = { async *streamTurn() {} };
    expect(await collect(runArchitectTurn({ messages: [user('hi')] }, silent))).toEqual([
      { type: 'error', message: 'The assistant stopped before finishing its reply.', retryable: true },
    ]);
  });

  it('yields nothing more once aborted', async () => {
    const abort = new AbortController();
    const model: ArchitectModel = {
      async *streamTurn() {
        yield { type: 'text', text: 'a' };
        abort.abort();
        yield { type: 'text', text: 'b' };
      },
    };
    expect(await collect(runArchitectTurn({ messages: [user('hi')] }, model, { signal: abort.signal }))).toEqual([{ type: 'text', text: 'a' }]);
  });
});

describe('createArchitectMiddleware + createFetchTransport', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function serve(options: Parameters<typeof createArchitectMiddleware>[0]) {
    const middleware = createArchitectMiddleware(options);
    server = createServer((req, res) => void middleware(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return `http://127.0.0.1:${port}`;
  }

  it('streams a mock turn as NDJSON over HTTP', async () => {
    const base = await serve({ model: createMockArchitectModel({ latency: 0 }) });
    const transport = createFetchTransport({ url: `${base}/api/architect`, headers: () => ({ 'x-test': '1' }) });
    const events = await collect(transport({ messages: [user('Image size: 1000 × 600 px.')] }, new AbortController().signal));
    expect(events[0]).toMatchObject({ type: 'thinking' });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('answers 413/400/404 before streaming', async () => {
    const base = await serve({ model: createMockArchitectModel({ latency: 0 }), maxBodyBytes: 1000 });
    const transport = createFetchTransport({ url: `${base}/api/architect` });
    const tooBig = { messages: [{ role: 'user' as const, content: 'x'.repeat(5000) }] };
    await expect(collect(transport(tooBig, new AbortController().signal))).rejects.toMatchObject({ status: 413, retryable: false });
    await expect(collect(transport({ messages: [] }, new AbortController().signal))).rejects.toBeInstanceOf(ArchitectTransportError);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });
});

describe('createAnthropicArchitectModel', () => {
  it('maps the request and the stream events', async () => {
    let params: Record<string, unknown> | undefined;
    const deltas = [
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Reading' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'x'.repeat(2500) } },
    ];
    const client = {
      beta: {
        messages: {
          stream(p: Record<string, unknown>) {
            params = p;
            return Object.assign(
              (async function* () {
                yield* deltas;
              })(),
              {
                finalMessage: async () => ({
                  model: 'claude-opus-5-5',
                  content: [{ type: 'text', text: 'Hi' }],
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
                }),
              },
            );
          },
        },
      },
    };
    const model = createAnthropicArchitectModel({ client: client as never, effort: 'medium' });
    const usage: unknown[] = [];
    const events = await collect(runArchitectTurn({ messages: [user('hi')] }, model, { extraInstructions: 'Gas.', onUsage: (u) => usage.push(u) }));
    expect(usage).toEqual([{ model: 'claude-opus-5-5', inputTokens: 12, outputTokens: 34, cacheReadTokens: 5000, cacheWriteTokens: 0 }]);
    expect(events).toEqual([
      { type: 'thinking', text: 'Reading' },
      { type: 'text', text: 'Hi' },
      { type: 'tool_progress', chars: 2500 },
      { type: 'done', content: [{ type: 'text', text: 'Hi' }], stopReason: 'end_turn' },
    ]);
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      system: [{ type: 'text', text: ARCHITECT_SYSTEM }, { type: 'text', text: 'Gas.' }],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
    });
    const tools = params!.tools as { name: string; eager_input_streaming?: boolean }[];
    expect(tools.find((t) => t.name === 'propose_floor_plan')?.eager_input_streaming).toBe(true);
    expect(tools.find((t) => t.name === 'ask_user')).not.toHaveProperty('eager_input_streaming');
  });
});
