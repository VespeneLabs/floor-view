# AI architect

The AI architect turns a scanned drawing, blueprint or sketch into a first floor plan. It's an agent with two tools: `ask_user` (up to 4 multiple-choice questions) and `propose_floor_plan` (a complete plan in image pixels plus a scale). The library ships both halves, framework-free:

| Subpath | Runs in | Contents |
| --- | --- | --- |
| `@vespenelabs/floorview/architect` | browser | `ArchitectController` (the tool loop), `createFetchTransport`, `prepareScan`, `convertProposal`, protocol types |
| `@vespenelabs/floorview/architect/server` | Node | `runArchitectTurn`, `createArchitectMiddleware`, the `ArchitectModel` interface, `createAnthropicArchitectModel`, `createMockArchitectModel`, request limits |

Floorview Studio's AI import page (`studio/src/features/import/`) is the reference integration.

## How a conversation works

1. The browser prepares the scan (`prepareScan`) and starts the controller with a first message: the scan as an image plus a text brief (`architectBrief` writes one from wizard answers).
2. For each turn the controller POSTs the whole conversation `{ messages }` through the transport. The server validates it, runs **one** model turn and streams events back as NDJSON: `text`, `thinking`, `tool_progress`, then exactly one `done` (the complete assistant content) or `error`.
3. The controller appends the assistant content **unchanged** (thinking blocks included; never edit or drop earlier turns) and runs the tools:
   - `ask_user`: shows the questions and waits for `answer()` or `send()`.
   - `propose_floor_plan`: validates and converts the input (`convertProposal`; tool inputs are untrusted model output), publishes the proposal, and returns a summary plus an image of the plan drawn over the scan, so the model can check its own geometry. Invalid input goes back as an error tool result for the model to fix.
4. It loops (up to `maxAutoSteps`, default 6) until the assistant waits for the user.

The server keeps no state: the conversation lives in the browser and is resent every turn. Prompt caching makes the repeated prefix cheap.

## Browser

```ts
import { ArchitectController, architectBrief, createFetchTransport, prepareScan } from '@vespenelabs/floorview/architect';

const architect = new ArchitectController({
  transport: createFetchTransport({
    url: '/api/v1/floorplans/architect',
    credentials: 'include', // send the session cookie
    headers: () => ({ 'x-csrf-token': getCsrfToken() }),
  }),
});

architect.on('change', (state) => render(state)); // state: { items, status, activity, error, proposal }
architect.on('proposal', (proposal) => preview(proposal.plan, proposal.underlay));

const scan = await prepareScan(file);
architect.start(scan, architectBrief(scan, { buildingType: 'Factory', floors: '1', knownMeasurement: '', include: ['rooms'], notes: '' }));
// later: architect.answer({ scale: 'About 90 m' }), architect.send('Make the warehouse 40 m long'), stop(), retry(), dispose()
```

- `getState()` returns an immutable snapshot that changes identity on every update, so React can use `useSyncExternalStore((cb) => architect.on('change', cb), () => architect.getState())`.
- `state.items` is the chat transcript (`user`, `assistant`, `questions`, `proposal`, `notice`); `status` is `working`, `answering` (questions open) or `idle`; `error` carries a user-facing message and whether `retry()` makes sense.
- A proposal has `plan` (meters, validated with `parsePlan`), `underlay` (the scan placed under the plan, `url` is the scan's data URL), `assumptions` and `warnings`. Load it with `editor.setPlan(proposal.plan)` and `editor.setUnderlay(...)`/`viewer.setUnderlay(...)`.
- **Transport.** `ArchitectTransport` is `(request, signal) => AsyncIterable<ArchitectEvent>`. `createFetchTransport` covers HTTP (URL, headers, `credentials`, custom `fetch`); throw `ArchitectTransportError(message, retryable)` from a custom one for errors the user should see.
- `renderPreview` (option) replaces the canvas overlay sent back to the model; `getMessages()` returns a copy of the conversation (e.g. to store it).

## Server

`runArchitectTurn(body, model, options)` validates the parsed JSON body, runs one turn and yields events. It never throws: invalid requests, adapter errors and turns that end early become a final `error` event. Stream it from any framework:

```ts
import { ArchitectRequestError, createAnthropicArchitectModel, parseArchitectRequest, runArchitectTurn } from '@vespenelabs/floorview/architect/server';

const model = createAnthropicArchitectModel({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/v1/floorplans/architect', async (request, reply) => {
  try {
    parseArchitectRequest(request.body); // 400/413 before streaming
  } catch (err) {
    if (err instanceof ArchitectRequestError) return reply.code(err.status).send(err.message);
    throw err;
  }
  const abort = new AbortController();
  request.raw.on('close', () => abort.abort()); // client went away: stop generating
  reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  for await (const event of runArchitectTurn(request.body, model, {
    signal: abort.signal,
    extraInstructions: 'The facilities are industrial gas installations. Mark rooms where gas equipment sits.',
  })) {
    reply.raw.write(`${JSON.stringify(event)}\n`);
  }
  reply.raw.end();
});
```

Every request spends model credit: put the endpoint behind your own authentication and rate limits.

- **Body size.** Set your framework's body limit (Studio's middleware uses 25 MB: the scan plus one preview image per proposal is resent each turn).
- **Limits** (`limits` option, `DEFAULT_ARCHITECT_LIMITS`): `maxMessages` 100, `maxImageBytes` 20 MB decoded across all images, `maxImages` 40, `maxTextChars` 2,000,000. Violations are `ArchitectRequestError` with status 413; malformed requests 400.
- **`extraInstructions`** is appended to the agent's system prompt as a separate block. Keep it stable per deployment: it's part of the cached prefix.
- **`createArchitectMiddleware({ model, path?, extraInstructions?, limits?, maxBodyBytes?, onError? })`** is a Connect-style `(req, res, next)` handler for Node `http`, Express or Vite.

### Models

`ArchitectModel` is the provider interface: `streamTurn({ system, tools, messages }, { signal })` yields events and ends with one `done` or `error`. The wire messages use the Anthropic Messages shape (role plus content blocks, thinking blocks replayed verbatim), so an adapter for another provider translates them at its boundary. Tool definitions are plain JSON Schema (`ARCHITECT_TOOL_DEFINITIONS`); `streamInput: true` marks the large `propose_floor_plan` input.

- **`createAnthropicArchitectModel({ client?, apiKey?, model?, maxTokens?, effort?, fallbacks?, onError? })`** runs on Claude through `@anthropic-ai/sdk`, an optional peer dependency that is loaded on first use. Pass an existing `client` to reuse its configuration. Defaults: `claude-opus-5-5`, `max_tokens` 64000, adaptive thinking with summarized display, effort `high`, automatic prompt caching, eager tool-input streaming for the plan, and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`; set `fallbacks: false` off the Claude API).
- **`createMockArchitectModel({ latency? })`** is a scripted assistant for demos, host tests and e2e runs: it asks two questions, proposes a generic factory sized to the image (read from "W × H px" in the first message) and summarizes. `latency: 0` removes the delays.
