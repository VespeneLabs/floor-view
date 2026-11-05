import type { IncomingMessage, ServerResponse } from 'node:http';

import Anthropic from '@anthropic-ai/sdk';

import type { ArchitectEvent, ArchitectRequest } from '../src/features/import/protocol.ts';
import { ARCHITECT_MODEL, ARCHITECT_SYSTEM, ARCHITECT_TOOLS } from './architect-agent.ts';
import { mockTurn } from './architect-mock.ts';

/** Scans are sent as base64 images inside the conversation; allow a few of them plus history. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

type Next = (err?: unknown) => void;

export interface ArchitectOptions {
  /** Serve scripted replies instead of calling Claude (for demos and UI tests without credentials). */
  mock?: boolean;
  /** Explicit API key; otherwise the SDK resolves ANTHROPIC_API_KEY / an `ant auth login` profile. */
  apiKey?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseRequest(raw: string): ArchitectRequest | null {
  try {
    const body = JSON.parse(raw) as Partial<ArchitectRequest>;
    const ok =
      Array.isArray(body.messages) &&
      body.messages.length > 0 &&
      body.messages.every((m) => (m.role === 'user' || m.role === 'assistant') && m.content !== undefined);
    return ok ? (body as ArchitectRequest) : null;
  } catch {
    return null;
  }
}

/** A user-facing message for API failures (the SDK's typed errors, most specific first). */
function describeError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { message: 'The server has no valid Anthropic credentials. Set ANTHROPIC_API_KEY and restart the dev server.', retryable: false };
  }
  if (err instanceof Anthropic.RateLimitError) return { message: 'The assistant is busy (rate limited). Try again in a moment.', retryable: true };
  if (err instanceof Anthropic.BadRequestError) {
    // Show the API's own message (e.g. "Your credit balance is too low…"), not the raw JSON body.
    const apiMessage = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
    return { message: `The request was rejected: ${apiMessage ?? err.message}`, retryable: false };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return { message: `The assistant is unavailable (${status || 'network error'}). Try again.`, retryable: status === 0 || status >= 500 };
  }
  if (err instanceof Error && /api[_ ]?key|credential|auth/i.test(err.message)) {
    return { message: 'The server has no Anthropic credentials. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart the dev server.', retryable: false };
  }
  // With eager input streaming, a tool input the SDK cannot parse at all rejects finalMessage().
  return { message: "The assistant's reply could not be read. Try again.", retryable: true };
}

/**
 * Connect-style middleware for `POST /api/architect`: streams one model turn as NDJSON events.
 * Mounted by the Vite plugin in studio/vite.config.ts (dev and preview servers).
 */
export function architectMiddleware(options: ArchitectOptions = {}) {
  let client: Anthropic | null = null;

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    if (!req.url?.startsWith('/api/architect')) return next();
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }

    let request: ArchitectRequest | null;
    try {
      request = parseRequest(await readBody(req));
    } catch {
      res.writeHead(413).end('Request too large');
      return;
    }
    if (!request) {
      res.writeHead(400).end('Expected { messages: [...] }');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const send = (event: ArchitectEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    if (options.mock) {
      await mockTurn(request.messages, send, () => res.writableEnded || res.destroyed);
      res.end();
      return;
    }

    try {
      client ??= new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
      const stream = client.beta.messages.stream({
        model: ARCHITECT_MODEL,
        max_tokens: 64000,
        system: ARCHITECT_SYSTEM,
        tools: ARCHITECT_TOOLS,
        messages: request.messages,
        thinking: { type: 'adaptive', display: 'summarized' },
        // Reading a drawing and producing consistent geometry rewards careful work.
        output_config: { effort: 'high' },
        // Caches the conversation prefix (including the scan) across turns.
        cache_control: { type: 'ephemeral' },
        // If a safety classifier declines, re-run on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      // Browser went away (Stop button, closed tab): stop generating.
      res.on('close', () => {
        if (!res.writableFinished) stream.abort();
      });

      let toolChars = 0;
      stream.on('text', (text) => send({ type: 'text', text }));
      stream.on('thinking', (text) => send({ type: 'thinking', text }));
      stream.on('contentBlock', () => (toolChars = 0));
      stream.on('inputJson', (partial) => {
        const before = Math.floor(toolChars / 2000);
        toolChars += partial.length;
        if (Math.floor(toolChars / 2000) !== before) send({ type: 'tool_progress', chars: toolChars });
      });

      const message = await stream.finalMessage();
      send({ type: 'done', content: message.content, stopReason: message.stop_reason });
    } catch (err) {
      if (!(err instanceof Anthropic.APIUserAbortError)) {
        send({ type: 'error', ...describeError(err) });
        if (!(err instanceof Anthropic.APIError)) console.error('[architect]', err);
      }
    }
    res.end();
  };
}
