import { DEFAULT_ARCHITECT_ENDPOINT, type ArchitectEvent, type ArchitectRequest } from './protocol';

/**
 * Sends one request and yields the turn's events. The host decides where and how (URL, headers,
 * cookies, or something other than HTTP entirely). Throw `ArchitectTransportError` for failures
 * the user should see; the controller turns other errors into a retryable connection error.
 */
export type ArchitectTransport = (request: ArchitectRequest, signal: AbortSignal) => AsyncIterable<ArchitectEvent>;

export class ArchitectTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ArchitectTransportError';
  }
}

type MaybePromise<T> = T | Promise<T>;

export interface FetchTransportOptions {
  /** Endpoint URL. Default `/api/architect`. */
  url?: string;
  /** Extra request headers, or a function returning them per request (e.g. a CSRF token). */
  headers?: HeadersInit | (() => MaybePromise<HeadersInit>);
  /** `fetch` credentials mode, e.g. `'include'` for a cross-origin session cookie. Default `'same-origin'`. */
  credentials?: RequestCredentials;
  /** Custom `fetch` (tests, instrumentation). */
  fetch?: typeof fetch;
}

/** POSTs `{ messages }` as JSON and reads the NDJSON event stream. */
export function createFetchTransport(options: FetchTransportOptions = {}): ArchitectTransport {
  const url = options.url ?? DEFAULT_ARCHITECT_ENDPOINT;
  return async function* fetchTransport(request, signal) {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const extra = typeof options.headers === 'function' ? await options.headers() : options.headers;
    const headers = new Headers(extra);
    headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        credentials: options.credentials ?? 'same-origin',
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      throw new ArchitectTransportError(`Could not reach the assistant (${(err as Error).message}).`, true);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new ArchitectTransportError(
        `The assistant endpoint answered ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status >= 500 || response.status === 429,
        response.status,
      );
    }
    if (!response.body) throw new ArchitectTransportError('The assistant endpoint sent an empty response.', true);
    yield* readNdjson(response.body);
  };
}

/** Parses a stream of newline-delimited JSON events. */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<ArchitectEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ArchitectEvent;
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as ArchitectEvent;
  } finally {
    reader.releaseLock();
  }
}
