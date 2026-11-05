import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ArchitectEvent } from '../protocol';
import {
  ArchitectRequestError,
  parseArchitectRequest,
  runArchitectTurn,
  type ArchitectLimits,
  type ArchitectModel,
  type RunArchitectTurnOptions,
} from './run';

export interface ArchitectMiddlewareOptions {
  model: ArchitectModel;
  /** Path prefix to serve. Default `/api/architect`. */
  path?: string;
  /** Host guidance appended to the system prompt (see `runArchitectTurn`). */
  extraInstructions?: string;
  limits?: Partial<ArchitectLimits>;
  /** Raw body limit in bytes, checked while reading. Default 25 MB. */
  maxBodyBytes?: number;
  onError?: (err: unknown) => void;
  /** Token usage per completed turn (see `runArchitectTurn`). */
  onUsage?: RunArchitectTurnOptions['onUsage'];
}

type Next = (err?: unknown) => void;

/**
 * Reads the body up to `maxBytes`. Oversized bodies are rejected from `content-length` without
 * reading, or drained (not buffered) so the client still receives the 413 instead of a reset.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const tooLarge = () => new ArchitectRequestError(`Request too large (limit ${(maxBytes / 1048576).toFixed(1)} MB)`, 413);
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    req.on('end', () => (size > maxBytes ? reject(tooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

/**
 * Connect-style middleware (Node `http`, Express, Vite's dev server) for `POST <path>`: validates
 * the request and streams one turn as NDJSON. A thin wrapper over `runArchitectTurn`; frameworks
 * with their own request handling (Fastify, Hono…) can call that directly.
 */
export function createArchitectMiddleware(options: ArchitectMiddlewareOptions) {
  const path = options.path ?? '/api/architect';
  const maxBodyBytes = options.maxBodyBytes ?? 25 * 1024 * 1024;

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const url = req.url?.split('?')[0];
    if (url !== path) return next();
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, maxBodyBytes));
      parseArchitectRequest(body, options.limits);
    } catch (err) {
      const status = err instanceof ArchitectRequestError ? err.status : 400;
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(err instanceof ArchitectRequestError ? err.message : 'Invalid JSON');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    // Browser went away (Stop button, closed tab): stop generating.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    const send = (event: ArchitectEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    for await (const event of runArchitectTurn(body, options.model, {
      extraInstructions: options.extraInstructions,
      limits: options.limits,
      signal: abort.signal,
      onError: options.onError,
      onUsage: options.onUsage,
    })) {
      send(event);
    }
    res.end();
  };
}
