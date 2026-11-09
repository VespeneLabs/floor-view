# AI architect

The AI architect turns a scanned drawing, blueprint or sketch into a first floor plan. It's an agent with two tools: `ask_user` (up to 4 multiple-choice questions) and `propose_floor_plan` (a complete plan in image pixels plus a scale, optionally with [3D models](#3d-models) from the host's catalog). The library ships both halves, framework-free:

| Subpath | Runs in | Contents |
| --- | --- | --- |
| `@vespenelabs/floorview/architect` | browser | `ArchitectController` (the tool loop), `createFetchTransport`, `prepareScan`, `convertProposal`, protocol types |
| `@vespenelabs/floorview/architect/server` | Node | `runArchitectTurn`, `createArchitectMiddleware`, the `ArchitectModel` interface, `createAnthropicArchitectModel`, `createMockArchitectModel`, `formatAssetCatalog`, request limits |

Floorview Studio's AI import page (`studio/src/features/import/`) is the reference integration.

## How a conversation works

1. The browser prepares the scan (`prepareScan`) and starts the controller with a first message: the scan as an image plus a text brief (`architectBrief` writes one from wizard answers).
2. For each turn the controller POSTs the whole conversation `{ messages, assets? }` through the transport. The server validates it, runs **one** model turn and streams events back as NDJSON: `text`, `thinking`, `tool_progress`, then exactly one `done` (the complete assistant content) or `error`.
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
- `renderPreview(scan, plan, metersPerPixel, assets)` (option) replaces the canvas overlay sent back to the model; `getMessages()` returns a copy of the conversation (e.g. to store it).
- `assets` (option) or `setAssets(list)` before `start()`: the 3D models the assistant may place (see [3D models](#3d-models)).

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
- **Limits** (`limits` option, `DEFAULT_ARCHITECT_LIMITS`): `maxMessages` 100, `maxImageBytes` 20 MB decoded across all images, `maxImages` 40, `maxTextChars` 2,000,000, `maxAssets` 2000 and `maxCatalogChars` 400,000 (the asset catalog's text, about 100k tokens). Violations are `ArchitectRequestError` with status 413; malformed requests (including malformed assets) 400.
- **`extraInstructions`** is appended to the agent's system prompt as a separate block. Keep it stable per deployment: it's part of the cached prefix.
- **`onUsage(usage)`** (option of `runArchitectTurn` and the middleware) reports each completed turn's tokens: `{ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`, e.g. to log cost per tenant. Usage never goes into the event stream, so it doesn't reach the browser.
- **`assets`** (option of `runArchitectTurn` and the middleware) is a server-chosen model catalog. When set, the request's `assets` are ignored: use it when the browser must not decide what goes into the prompt.
- **`createArchitectMiddleware({ model, path?, extraInstructions?, assets?, limits?, maxBodyBytes?, onError?, onUsage? })`** is a Connect-style `(req, res, next)` handler for Node `http`, Express or Vite.

### Models

`ArchitectModel` is the provider interface: `streamTurn({ system, tools, messages, assets }, { signal, onUsage })` yields events, ends with one `done` or `error`, and reports token usage through `onUsage` when it knows it. The wire messages use the Anthropic Messages shape (role plus content blocks, thinking blocks replayed verbatim), so an adapter for another provider translates them at its boundary. Tool definitions are plain JSON Schema (`ARCHITECT_TOOL_DEFINITIONS`); `streamInput: true` marks the large `propose_floor_plan` input.

- **`createAnthropicArchitectModel({ client?, apiKey?, model?, maxTokens?, effort?, fallbacks?, onError? })`** runs on Claude through `@anthropic-ai/sdk`, an optional peer dependency that is loaded on first use. Pass an existing `client` to reuse its configuration. Defaults: `claude-opus-5-5`, `max_tokens` 64000, adaptive thinking with summarized display, effort `high`, prompt caching (a breakpoint on the last system block plus automatic caching of the conversation), eager tool-input streaming for the plan, and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`; set `fallbacks: false` off the Claude API).
- **`createMockArchitectModel({ latency? })`** is a scripted assistant for demos, host tests and e2e runs: it asks two questions, proposes a generic factory sized to the image (read from "W × H px" in the first message) and summarizes. When the request's catalog contains the Kenney ids it uses (`kenney/factory/machine`, `kenney/factory/conveyor-long`, `kenney/shop/shelf-boxes`, `kenney/furniture/desk`…), the factory is furnished with machines, conveyors, racks and furniture. `latency: 0` removes the delays.

## 3D models

When the drawing shows objects (machines, conveyors, racks, furniture, sanitary fittings, vehicles, tanks), the assistant can place them as 3D models: markers with `model`, `rotation` and `scale` (see [assets.md](assets.md)). The host decides which models are available.

```ts
import { kenneyAssets } from '@vespenelabs/floorview/kenney';

const architect = new ArchitectController({ transport, assets: kenneyAssets('/floorview-assets/kenney') });
```

- **What the model sees.** The controller sends the assets with every request as `assets: [{ id, name, category?, size, description? }]` (URLs and previews stay in the browser; models with `ai: false` are left out). The server renders them with `formatAssetCatalog` into one system block: placement guidance plus one line per model, `id | name | width × depth × height | description`, grouped by category. Hosts with their own catalog should fill in `ModelAsset.description` (what it is, how it looks on a plan drawing, where it is used, synonyms): matching works from it.
- **In the proposal.** `propose_floor_plan` markers take optional `model` (a catalog id), `rotation` (degrees clockwise on the drawing; 0 = the model's front faces down the image, +y, the same convention as `marker.rotation`) and `scale`. `x`, `y` is the footprint center in image pixels. The prompt asks the assistant to match by meaning first and footprint second, to use one marker per object, and to fall back to a plain marker (or nothing) when no model fits.
- **Validation.** `convertProposal(input, image, { assets })` rejects unknown ids (suggesting similar ids), non-numeric rotations, `scale` outside 0.25-4 and models when there is no catalog; the assistant gets the list and proposes again. Rotations are normalized to 0-360. Models sticking out of the image produce a warning. Model markers get no kind color, so they render in the viewer's model style.
- **Self-check.** The preview image sent back to the model draws each model's footprint in orange with a thick front edge, so the assistant can check position, size and orientation against the scan.
- **Keep it stable.** The catalog is fixed per conversation (`setAssets` is ignored after `start()`), because it is part of the cached prompt.

**Why a catalog in the prompt, not a search tool.** The assistant compares what it sees in the drawing with the whole catalog at once and places dozens of objects in a single proposal. A search tool would cost a model round trip per lookup (each resending the scan) and would hide close alternatives it didn't search for. A curated catalog is small: the Kenney catalog's 213 AI models are about 48,000 characters (about 12k tokens). It is cached: the block goes after the agent prompt and `extraInstructions` in `system`, ahead of the conversation, and the Anthropic adapter puts a cache breakpoint on the last system block, so tools + system (catalog included) are written once and read by every later turn and every later conversation that sends the same list. The automatic breakpoint caches the growing conversation as before. Without assets the system prompt is byte-identical to before. The catalog is rendered from the request deterministically, so keep the asset list (and its order) stable per deployment; any change re-writes the cache once. For catalogs far beyond the limits (thousands of models), a server could pre-filter by the user's brief or add a search tool through its own `ArchitectModel`, which receives `assets` alongside the rendered prompt.

**Trust.** Request assets come from the browser and end up in the system prompt. The server validates them (ids without spaces or `<>|`, field lengths, sizes, count, total size), flattens each entry to one line without angle brackets so it cannot close the `<asset_catalog>` block, and the guidance says entries are data, not instructions. If that is not enough for your deployment, pass the catalog on the server (`assets` option) and ignore the browser's.
