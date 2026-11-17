import { describe, expect, it } from 'vitest';
import { readNdjson, type ArchitectEvent } from '@vespenelabs/floorview/architect';
import { createAnthropicArchitectModel } from '@vespenelabs/floorview/architect/server';
import { applyPlanCommands, createPlan, PLAN_COMMAND_DEFINITIONS, planCommandFromTool } from '@vespenelabs/floorview/model';

/**
 * The model adapter and the NDJSON helpers are also for hosts' own agents (docs/architect.md,
 * "Your own agent"): nothing in them may depend on the architect's prompt, tools or scans.
 */
describe('model adapter and stream helpers with a host agent', () => {
  it('passes the host system prompt, tools and messages through and streams the turn', async () => {
    let params: Record<string, unknown> | undefined;
    const content = [
      { type: 'text', text: 'Adding the wall.' },
      { type: 'tool_use', id: 'tu_1', name: 'add_wall', input: { levelId: 'L', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } } },
    ];
    const client = {
      beta: {
        messages: {
          stream(p: Record<string, unknown>) {
            params = p;
            const events = (async function* () {
              yield { type: 'content_block_start' };
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Adding the wall.' } };
            })();
            return Object.assign(events, {
              finalMessage: async () => ({ model: 'm', content, stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } }),
            });
          },
        },
      },
    };
    const model = createAnthropicArchitectModel({ client: client as never, model: 'host-model', maxTokens: 8000, effort: 'medium', fallbacks: false });
    const tools = [
      ...PLAN_COMMAND_DEFINITIONS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      { name: 'find_item', description: 'A host tool.', input_schema: { type: 'object', properties: {} } },
    ];
    const usage: unknown[] = [];
    const events: ArchitectEvent[] = [];
    for await (const event of model.streamTurn(
      { system: ['You edit floor plans.', 'Host rules.'], tools, messages: [{ role: 'user', content: 'Add a wall' }], assets: [], media: [] },
      { signal: new AbortController().signal, onUsage: (u) => usage.push(u) },
    )) {
      events.push(event);
    }

    expect(params).toMatchObject({ model: 'host-model', max_tokens: 8000, output_config: { effort: 'medium' }, messages: [{ role: 'user', content: 'Add a wall' }] });
    expect(params).not.toHaveProperty('fallbacks');
    expect((params!.system as { text: string }[]).map((b) => b.text)).toEqual(['You edit floor plans.', 'Host rules.']);
    expect((params!.tools as { name: string }[]).map((t) => t.name)).toEqual(tools.map((t) => t.name));
    expect(events).toEqual([
      { type: 'text', text: 'Adding the wall.' },
      { type: 'done', content, stopReason: 'tool_use' },
    ]);
    expect(usage).toHaveLength(1);

    // The tool call becomes a plan command.
    const plan = createPlan();
    plan.levels[0]!.id = 'L';
    const call = content[1] as { name: string; input: unknown };
    const result = applyPlanCommands(plan, [planCommandFromTool(call.name, call.input)]);
    expect(result.ok && result.plan.levels[0]!.walls).toHaveLength(1);
  });

  it('reads any NDJSON event stream, split anywhere', async () => {
    const lines = '{"type":"text","text":"a"}\n{"type":"done","content":[],"stopReason":"end_turn"}';
    const bytes = new TextEncoder().encode(lines);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    const events: ArchitectEvent[] = [];
    for await (const event of readNdjson(body)) events.push(event);
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });
});
