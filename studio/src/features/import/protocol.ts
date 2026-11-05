import type Anthropic from '@anthropic-ai/sdk';

/**
 * Wire protocol between the browser and the `/api/architect` endpoint (studio/server).
 * Request: `{ messages }` (the whole conversation, append-only). Response: newline-delimited JSON
 * events streaming one model turn; the browser runs the tool loop.
 */
export interface ArchitectRequest {
  messages: Anthropic.Beta.BetaMessageParam[];
}

export type ArchitectEvent =
  /** Visible answer text, streamed. */
  | { type: 'text'; text: string }
  /** Summarized reasoning, streamed (shown as a status line, not as an answer). */
  | { type: 'thinking'; text: string }
  /** A tool input is being generated; `chars` is its size so far. */
  | { type: 'tool_progress'; chars: number }
  /** The turn finished: the complete assistant content to append to the conversation unchanged. */
  | { type: 'done'; content: Anthropic.Beta.BetaContentBlock[]; stopReason: string | null }
  | { type: 'error'; message: string; retryable: boolean };

export const ARCHITECT_ENDPOINT = '/api/architect';
