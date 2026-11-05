import type { ArchitectContentBlock, ArchitectEvent, ArchitectMessage, ArchitectRequest } from '../protocol';
import { ARCHITECT_SYSTEM, ARCHITECT_TOOL_DEFINITIONS, type ArchitectToolDefinition } from './agent';

/** What a model adapter receives for one turn. */
export interface ArchitectTurnInput {
  /** System prompt parts, in order: the agent's prompt, then the host's `extraInstructions`. */
  system: string[];
  tools: ArchitectToolDefinition[];
  messages: ArchitectMessage[];
}

/** Token usage of one model turn (server side only; never sent to the browser). */
export interface ArchitectUsage {
  /** The model that served the turn (after any fallback). */
  model: string;
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ArchitectStreamOptions {
  signal: AbortSignal;
  /** Called once per completed turn with its token usage. */
  onUsage?: (usage: ArchitectUsage) => void;
}

/**
 * A model provider. `streamTurn` yields `text`/`thinking`/`tool_progress` events and ends with
 * exactly one `done` (the complete assistant content) or `error` (a user-facing message). It
 * should stop promptly when `signal` aborts, and report token usage through `onUsage` when it
 * knows it. Unexpected throws become a generic retryable error.
 */
export interface ArchitectModel {
  streamTurn(input: ArchitectTurnInput, options: ArchitectStreamOptions): AsyncIterable<ArchitectEvent>;
}

export interface ArchitectLimits {
  /** Messages in the conversation. Default 100. */
  maxMessages: number;
  /** Total decoded size of all base64 images in the conversation. Default 20 MB. */
  maxImageBytes: number;
  /** Number of images in the conversation (scan + one preview per proposal). Default 40. */
  maxImages: number;
  /** Total characters of text and tool input/result text. Default 2,000,000. */
  maxTextChars: number;
}

export const DEFAULT_ARCHITECT_LIMITS: ArchitectLimits = {
  maxMessages: 100,
  maxImageBytes: 20 * 1024 * 1024,
  maxImages: 40,
  maxTextChars: 2_000_000,
};

/** An invalid or oversized request. `status` is the HTTP status to answer with (400 or 413). */
export class ArchitectRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = 'ArchitectRequestError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function measure(blocks: unknown, totals: { imageBytes: number; images: number; textChars: number }, depth = 0): void {
  if (typeof blocks === 'string') {
    totals.textChars += blocks.length;
    return;
  }
  if (!Array.isArray(blocks) || depth > 3) return;
  for (const block of blocks as unknown[]) {
    if (!isObj(block)) continue;
    if (block.type === 'image' && isObj(block.source) && typeof block.source.data === 'string') {
      totals.images++;
      totals.imageBytes += Math.floor((block.source.data.length * 3) / 4);
    }
    for (const key of ['text', 'thinking'] as const) if (typeof block[key] === 'string') totals.textChars += (block[key] as string).length;
    if (block.type === 'tool_use') totals.textChars += JSON.stringify(block.input ?? null).length;
    if (block.type === 'tool_result') measure(block.content, totals, depth + 1);
  }
}

/**
 * Validates a request body (already JSON-parsed) against the protocol and the limits. Throws
 * `ArchitectRequestError` with a 400 or 413 status. Call it before starting to stream so the
 * host can answer with a proper HTTP status; `runArchitectTurn` checks again.
 */
export function parseArchitectRequest(body: unknown, limits: Partial<ArchitectLimits> = {}): ArchitectRequest {
  const max = { ...DEFAULT_ARCHITECT_LIMITS, ...limits };
  if (!isObj(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ArchitectRequestError('Expected { messages: [...] } with at least one message.', 400);
  }
  const messages = body.messages as unknown[];
  if (messages.length > max.maxMessages) {
    throw new ArchitectRequestError(`The conversation is too long (${messages.length} messages, limit ${max.maxMessages}). Start a new one.`, 413);
  }
  messages.forEach((m, i) => {
    const ok =
      isObj(m) &&
      (m.role === 'user' || m.role === 'assistant') &&
      (typeof m.content === 'string' || (Array.isArray(m.content) && (m.content as unknown[]).every((b) => isObj(b) && typeof b.type === 'string')));
    if (!ok) throw new ArchitectRequestError(`messages[${i}] must be { role: "user" | "assistant", content: string | blocks[] }.`, 400);
  });
  if ((messages[0] as ArchitectMessage).role !== 'user' || (messages[messages.length - 1] as ArchitectMessage).role !== 'user') {
    throw new ArchitectRequestError('The conversation must start and end with a user message.', 400);
  }
  const totals = { imageBytes: 0, images: 0, textChars: 0 };
  for (const m of messages as ArchitectMessage[]) measure(m.content as string | ArchitectContentBlock[], totals);
  if (totals.images > max.maxImages) throw new ArchitectRequestError(`Too many images (${totals.images}, limit ${max.maxImages}). Start a new conversation.`, 413);
  if (totals.imageBytes > max.maxImageBytes) {
    throw new ArchitectRequestError(`Images are too large (${(totals.imageBytes / 1048576).toFixed(1)} MB, limit ${(max.maxImageBytes / 1048576).toFixed(1)} MB).`, 413);
  }
  if (totals.textChars > max.maxTextChars) throw new ArchitectRequestError('The conversation is too long. Start a new one.', 413);
  return { messages: messages as ArchitectMessage[] };
}

export interface RunArchitectTurnOptions {
  /** Host-specific guidance appended to the agent's system prompt (keep it stable: it is cached). */
  extraInstructions?: string;
  /** Abort the turn (e.g. when the client disconnects). */
  signal?: AbortSignal;
  limits?: Partial<ArchitectLimits>;
  /** Called with unexpected errors (adapter bugs, network failures) before they become a generic event. */
  onError?: (err: unknown) => void;
  /** Token usage per completed turn, e.g. to log cost per tenant. Not part of the event stream. */
  onUsage?: (usage: ArchitectUsage) => void;
}

/**
 * Runs one assistant turn and yields its events, ending with exactly one `done` or `error` (none
 * when aborted). Framework-free: serialize each event as a JSON line (NDJSON) in any server.
 *
 * ```ts
 * reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson' });
 * for await (const event of runArchitectTurn(body, model, { signal })) reply.raw.write(`${JSON.stringify(event)}\n`);
 * reply.raw.end();
 * ```
 */
export async function* runArchitectTurn(
  request: unknown,
  model: ArchitectModel,
  options: RunArchitectTurnOptions = {},
): AsyncGenerator<ArchitectEvent> {
  let parsed: ArchitectRequest;
  try {
    parsed = parseArchitectRequest(request, options.limits);
  } catch (err) {
    yield { type: 'error', message: (err as Error).message, retryable: false };
    return;
  }
  const signal = options.signal ?? new AbortController().signal;
  const extra = options.extraInstructions?.trim();
  const input: ArchitectTurnInput = {
    system: extra ? [ARCHITECT_SYSTEM, extra] : [ARCHITECT_SYSTEM],
    tools: ARCHITECT_TOOL_DEFINITIONS,
    messages: parsed.messages,
  };
  try {
    for await (const event of model.streamTurn(input, { signal, onUsage: options.onUsage })) {
      if (signal.aborted) return;
      yield event;
      if (event.type === 'done' || event.type === 'error') return;
    }
  } catch (err) {
    if (signal.aborted) return;
    options.onError?.(err);
    yield { type: 'error', message: 'The assistant ran into a problem. Try again.', retryable: true };
    return;
  }
  if (!signal.aborted) yield { type: 'error', message: 'The assistant stopped before finishing its reply.', retryable: true };
}
