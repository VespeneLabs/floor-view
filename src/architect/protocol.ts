/**
 * Wire protocol between the browser (`ArchitectController`) and the architect endpoint
 * (`runArchitectTurn` / `createArchitectMiddleware`).
 *
 * Request: `{ messages, assets? }`, the whole conversation (append-only) plus the 3D models the
 * assistant may place (send the same list on every turn of a conversation). Response: newline-delimited JSON
 * (`application/x-ndjson`) events streaming one model turn; the browser runs the tool loop.
 *
 * Messages use the Anthropic Messages shape (role + content blocks). These are the library's own
 * structural types so the browser bundle does not depend on the SDK; a model adapter for another
 * provider translates at its boundary. Assistant content must be sent back exactly as received:
 * thinking blocks are replayed unchanged.
 */

/** A content block. Known shapes are typed below; any other block is passed through untouched. */
export interface ArchitectContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ArchitectTextBlock extends ArchitectContentBlock {
  type: 'text';
  text: string;
}

export interface ArchitectImageBlock extends ArchitectContentBlock {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string };
}

export interface ArchitectToolUseBlock extends ArchitectContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ArchitectToolResultBlock extends ArchitectContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ArchitectContentBlock[];
  is_error?: boolean;
}

export interface ArchitectMessage {
  role: 'user' | 'assistant';
  content: string | ArchitectContentBlock[];
}

/**
 * A 3D model the assistant may place as a marker: the parts of a `ModelAsset` it needs. The server
 * renders the list into its own cached prompt block (see `formatAssetCatalog`).
 */
export interface ArchitectAsset {
  /** `ModelAsset.id`, put into `marker.model`. */
  id: string;
  name: string;
  category?: string;
  /** Meters: `width` along image x and `depth` along image y at rotation 0, `height` up. */
  size: { width: number; depth: number; height: number };
  description?: string;
}

export interface ArchitectRequest {
  messages: ArchitectMessage[];
  /** Models the assistant may place. Omit (or send none) for plans without 3D models. */
  assets?: ArchitectAsset[];
}

/** Why a turn ended: `end_turn`, `tool_use`, `max_tokens`, `refusal`, … (provider-defined). */
export type ArchitectStopReason = string | null;

export type ArchitectEvent =
  /** Visible answer text, streamed. */
  | { type: 'text'; text: string }
  /** Summarized reasoning, streamed (show it as a status line, not as an answer). */
  | { type: 'thinking'; text: string }
  /** A tool input is being generated; `chars` is its size so far. */
  | { type: 'tool_progress'; chars: number }
  /** The turn finished: the complete assistant content, to append to the conversation unchanged. */
  | { type: 'done'; content: ArchitectContentBlock[]; stopReason: ArchitectStopReason }
  /** The turn failed. `message` is safe to show to the user. */
  | { type: 'error'; message: string; retryable: boolean };

/** Tool names the agent uses and the controller handles. */
export const ARCHITECT_TOOLS = {
  askUser: 'ask_user',
  proposeFloorPlan: 'propose_floor_plan',
} as const;

/** The endpoint Floorview Studio uses; hosts choose their own. */
export const DEFAULT_ARCHITECT_ENDPOINT = '/api/architect';

export const isToolUse = (block: ArchitectContentBlock): block is ArchitectToolUseBlock =>
  block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';
