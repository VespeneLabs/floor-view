import type Anthropic from '@anthropic-ai/sdk';

import type { ArchitectContentBlock, ArchitectEvent } from '../protocol';
import type { ArchitectModel } from './run';

type AnthropicModule = typeof import('@anthropic-ai/sdk');

export interface AnthropicArchitectModelOptions {
  /** An existing client (its credentials, base URL, retries…). Otherwise one is created lazily. */
  client?: Anthropic;
  /** API key for the lazily created client; without it the SDK resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  apiKey?: string;
  /** Default `claude-opus-5-5`. */
  model?: string;
  /** Default 64000 (the turn streams, so a large cap is safe). */
  maxTokens?: number;
  /** Default `high`: reading a drawing and producing consistent geometry rewards careful work. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Re-run a declined request on Anthropic's recommended fallback model. Default true (Claude API only). */
  fallbacks?: boolean;
  /** Called with errors that are not API errors (bugs, unreadable replies), e.g. to log them. */
  onError?: (err: unknown) => void;
}

export const DEFAULT_ANTHROPIC_ARCHITECT_MODEL = 'claude-opus-5-5';

let sdkModule: Promise<AnthropicModule> | null = null;
/** `@anthropic-ai/sdk` is an optional peer dependency: loaded on first use only. */
function loadSdk(): Promise<AnthropicModule> {
  sdkModule ??= import('@anthropic-ai/sdk').catch((err: unknown) => {
    sdkModule = null;
    throw new Error(`createAnthropicArchitectModel needs the "@anthropic-ai/sdk" package (${(err as Error).message}).`);
  });
  return sdkModule;
}

/** A user-facing message for API failures (the SDK's typed errors, most specific first). */
function describeError(sdk: typeof Anthropic, err: unknown): { message: string; retryable: boolean } {
  if (err instanceof sdk.AuthenticationError || err instanceof sdk.PermissionDeniedError) {
    return { message: 'The server has no valid Anthropic credentials. Check its API key configuration.', retryable: false };
  }
  if (err instanceof sdk.RateLimitError) return { message: 'The assistant is busy (rate limited). Try again in a moment.', retryable: true };
  if (err instanceof sdk.BadRequestError) {
    // Show the API's own message (e.g. "Your credit balance is too low…"), not the raw JSON body.
    const apiMessage = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
    return { message: `The request was rejected: ${apiMessage ?? err.message}`, retryable: false };
  }
  if (err instanceof sdk.APIError) {
    const status = err.status ?? 0;
    return { message: `The assistant is unavailable (${status || 'network error'}). Try again.`, retryable: status === 0 || status >= 500 };
  }
  if (err instanceof Error && /api[_ ]?key|credential|auth/i.test(err.message)) {
    return { message: 'The server has no Anthropic credentials. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart it.', retryable: false };
  }
  // With eager input streaming, a tool input the SDK cannot parse at all rejects finalMessage().
  return { message: "The assistant's reply could not be read. Try again.", retryable: true };
}

/**
 * The architect on Claude via `@anthropic-ai/sdk` (an optional peer dependency, loaded lazily).
 * Streams with adaptive thinking (summarized), caches the conversation prefix across turns and,
 * by default, falls back to Anthropic's recommended model when a safety classifier declines.
 */
export function createAnthropicArchitectModel(options: AnthropicArchitectModelOptions = {}): ArchitectModel {
  let client: Anthropic | undefined = options.client;
  return {
    async *streamTurn(input, { signal, onUsage }): AsyncGenerator<ArchitectEvent> {
      const sdk = (await loadSdk()).default;
      client ??= new sdk(options.apiKey ? { apiKey: options.apiKey } : {});
      const fallbacks = options.fallbacks ?? true;
      try {
        const stream = client.beta.messages.stream(
          {
            model: options.model ?? DEFAULT_ANTHROPIC_ARCHITECT_MODEL,
            max_tokens: options.maxTokens ?? 64000,
            system: input.system.map((text) => ({ type: 'text' as const, text })),
            tools: input.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.input_schema as Anthropic.Beta.BetaTool.InputSchema,
              ...(tool.streamInput ? { eager_input_streaming: true } : {}),
            })),
            // The wire messages are Anthropic-shaped by design (see protocol.ts).
            messages: input.messages as Anthropic.Beta.BetaMessageParam[],
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: options.effort ?? 'high' },
            // Caches the prefix (system, tools, the scan and earlier turns) across turns.
            cache_control: { type: 'ephemeral' },
            ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          },
          { signal },
        );

        let toolChars = 0;
        for await (const event of stream) {
          if (event.type === 'content_block_start') toolChars = 0;
          else if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta') yield { type: 'text', text: delta.text };
            else if (delta.type === 'thinking_delta') yield { type: 'thinking', text: delta.thinking };
            else if (delta.type === 'input_json_delta') {
              const before = Math.floor(toolChars / 2000);
              toolChars += delta.partial_json.length;
              if (Math.floor(toolChars / 2000) !== before) yield { type: 'tool_progress', chars: toolChars };
            }
          }
        }
        const message = await stream.finalMessage();
        onUsage?.({
          model: message.model,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        });
        yield { type: 'done', content: message.content as unknown as ArchitectContentBlock[], stopReason: message.stop_reason };
      } catch (err) {
        if (err instanceof sdk.APIUserAbortError || signal.aborted) return;
        if (!(err instanceof sdk.APIError)) options.onError?.(err);
        yield { type: 'error', ...describeError(sdk, err) };
      }
    },
  };
}
