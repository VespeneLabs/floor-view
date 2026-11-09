import { Emitter } from '../core/emitter';
import type { ModelAsset } from '../model/assets';
import type { FloorPlan, Underlay } from '../model/types';
import { convertProposal } from './conversion';
import {
  ARCHITECT_TOOLS,
  isToolUse,
  type ArchitectAsset,
  type ArchitectContentBlock,
  type ArchitectMessage,
  type ArchitectStopReason,
  type ArchitectToolResultBlock,
  type ArchitectToolUseBlock,
} from './protocol';
import { renderProposalOverlay, type Scan } from './scan';
import { ArchitectTransportError, type ArchitectTransport } from './transport';

/**
 * Headless driver for the floor plan assistant: sends the conversation through a transport,
 * streams one turn, runs the tools (questions wait for the user, plan proposals are validated,
 * converted and previewed, and a picture of the proposal goes back to the model) and loops until
 * the assistant waits for the user. Framework-free; subscribe to `change` and render `getState()`.
 *
 * The conversation is append-only: assistant content is stored exactly as returned (thinking
 * blocks included) and earlier turns are never edited.
 */

export interface ArchitectQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface ArchitectProposal {
  /** 1, 2, 3… per accepted proposal in this conversation. */
  version: number;
  plan: FloorPlan;
  /** The scan placed under the plan, in plan meters (`url` is the scan's data URL). */
  underlay: Underlay;
  assumptions: string[];
  warnings: string[];
}

export type ArchitectChatItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'questions'; id: number; questions: ArchitectQuestion[]; answers: Record<string, string> | null }
  | { kind: 'proposal'; id: number; proposal: ArchitectProposal }
  | { kind: 'notice'; id: number; tone: 'info' | 'error'; text: string };

/** `working`: a turn is streaming. `answering`: questions are open. `idle`: waiting for the user. */
export type ArchitectStatus = 'idle' | 'working' | 'answering';

export interface ArchitectActivity {
  /** The tail of the summarized reasoning, for a status line. */
  thinking: string;
  /** Size of the tool input being generated, or null. */
  progress: number | null;
}

/** Immutable snapshot; a new object after every change (usable with `useSyncExternalStore`). */
export interface ArchitectState {
  items: readonly ArchitectChatItem[];
  status: ArchitectStatus;
  activity: ArchitectActivity | null;
  error: { message: string; retryable: boolean } | null;
  /** The latest valid proposal. */
  proposal: ArchitectProposal | null;
}

export interface ArchitectControllerEvents {
  change: ArchitectState;
  /** A new valid proposal (also reflected in `state.proposal`). */
  proposal: ArchitectProposal;
}

/** `assets` are the models offered to the assistant (to draw model markers as footprints). */
export type PreviewRenderer = (
  scan: Scan,
  plan: FloorPlan,
  metersPerPixel: number,
  assets: readonly ModelAsset[],
) => Promise<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }>;

export interface ArchitectControllerOptions {
  transport: ArchitectTransport;
  /** Tool rounds the assistant may run on its own before handing back to the user. Default 6. */
  maxAutoSteps?: number;
  /** Draws a proposal over the scan for the model to check itself. Default: canvas overlay. */
  renderPreview?: PreviewRenderer;
  /**
   * 3D models the assistant may place as markers (`model`, `rotation`, `scale`). Assets with
   * `ai: false` are left out. Sent with every request; the server puts them into a cached prompt
   * block, so keep the list the same for a conversation. Default: none.
   */
  assets?: readonly ModelAsset[];
}

/** What the wizard asked before starting; turned into the first message by `architectBrief`. */
export interface FacilityBrief {
  buildingType: string;
  floors: string;
  knownMeasurement: string;
  include: string[];
  notes: string;
}

/** The default first message text: the scan's size plus what the user told the wizard. */
export function architectBrief(scan: Scan, brief: FacilityBrief): string {
  const lines = [
    `I've uploaded a drawing of our facility ("${scan.fileName}"). Image size: ${scan.width} × ${scan.height} px.`,
    '',
    'About the facility:',
    `- Type: ${brief.buildingType}`,
    `- Floors: ${brief.floors}`,
    `- Known measurement: ${brief.knownMeasurement.trim() || 'none given'}`,
    `- Please include: ${brief.include.join(', ') || 'walls and rooms'}`,
  ];
  if (brief.notes.trim()) lines.push(`- Notes: ${brief.notes.trim()}`);
  lines.push('', 'Please read the drawing and build an initial floor plan for me.');
  return lines.join('\n');
}

function parseQuestions(input: unknown): ArchitectQuestion[] | null {
  const raw = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = raw
    .filter((q): q is { id?: unknown; question?: unknown; options?: unknown } => typeof q === 'object' && q !== null)
    .map((q, i) => ({
      id: typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`,
      question: typeof q.question === 'string' ? q.question : '',
      options: Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string').slice(0, 6) : [],
    }))
    .filter((q) => q.question);
  return questions.length ? questions.slice(0, 4) : null;
}

export class ArchitectController extends Emitter<ArchitectControllerEvents> {
  private state: ArchitectState = { items: [], status: 'idle', activity: null, error: null, proposal: null };
  private readonly messages: ArchitectMessage[] = [];
  private scan: Scan | null = null;
  /** Results of tools that ran in the same turn as an ask_user; sent together with the answers. */
  private pending: { askId: string; results: ArchitectToolResultBlock[] } | null = null;
  private abort: AbortController | null = null;
  private version = 0;
  private nextId = 1;
  private readonly transport: ArchitectTransport;
  private readonly maxAutoSteps: number;
  private readonly renderPreview: PreviewRenderer;
  private assets: readonly ModelAsset[] = [];
  private wireAssets: ArchitectAsset[] = [];

  constructor(options: ArchitectControllerOptions) {
    super();
    this.transport = options.transport;
    this.maxAutoSteps = options.maxAutoSteps ?? 6;
    this.renderPreview = options.renderPreview ?? renderProposalOverlay;
    this.setAssets(options.assets ?? []);
  }

  /**
   * Replaces the 3D models the assistant may place (see `ArchitectControllerOptions.assets`).
   * Only before `start()`: a conversation keeps its catalog. Returns false when ignored.
   */
  setAssets(assets: readonly ModelAsset[]): boolean {
    if (this.messages.length) return false;
    this.assets = assets.filter((a) => a.ai !== false);
    this.wireAssets = this.assets.map(({ id, name, category, size, description }) => ({
      id,
      name,
      ...(category ? { category } : {}),
      size: { width: size.width, depth: size.depth, height: size.height },
      ...(description ? { description } : {}),
    }));
    return true;
  }

  getState(): ArchitectState {
    return this.state;
  }

  /** A copy of the conversation so far (e.g. to store it). */
  getMessages(): ArchitectMessage[] {
    return structuredClone(this.messages);
  }

  /**
   * Starts the conversation with the scan and a first message (see `architectBrief`).
   * `displayText` is what the chat shows for it (default: the text itself). Ignored once started.
   */
  start(scan: Scan, text: string, displayText = text): void {
    if (this.messages.length) return;
    this.scan = scan;
    this.messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: scan.mediaType, data: scan.base64 } },
        { type: 'text', text },
      ],
    });
    this.push({ kind: 'user', id: this.nextId++, text: displayText });
    void this.run();
  }

  /** Answers the open questions (keyed by question id). */
  answer(answers: Record<string, string>): void {
    const open = this.pending;
    if (!open) return;
    this.pending = null;
    this.closeQuestions(answers);
    const text = Object.entries(answers)
      .map(([id, value]) => `${id}: ${value || '(no answer)'}`)
      .join('\n');
    this.messages.push({ role: 'user', content: [...open.results, { type: 'tool_result', tool_use_id: open.askId, content: text }] });
    void this.run();
  }

  /** Sends a chat message. While questions are open, it answers them in free text. */
  send(text: string): void {
    const value = text.trim();
    if (!value || !this.messages.length || this.state.status === 'working') return;
    this.push({ kind: 'user', id: this.nextId++, text: value });
    const open = this.pending;
    if (open) {
      this.pending = null;
      this.closeQuestions({ reply: value });
      this.messages.push({ role: 'user', content: [...open.results, { type: 'tool_result', tool_use_id: open.askId, content: value }] });
    } else {
      this.messages.push({ role: 'user', content: [{ type: 'text', text: value }] });
    }
    void this.run();
  }

  /** Aborts the streaming turn. */
  stop(): void {
    this.abort?.abort();
  }

  /** Re-sends the conversation after a failed or stopped turn. */
  retry(): void {
    if (this.state.status !== 'working' && this.messages.length && !this.pending) void this.run();
  }

  /** Stops any turn and removes listeners. */
  dispose(): void {
    this.stop();
    this.clear();
  }

  private set(patch: Partial<ArchitectState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  private push(item: ArchitectChatItem): void {
    this.set({ items: [...this.state.items, item] });
  }

  private notice(tone: 'info' | 'error', text: string): void {
    this.push({ kind: 'notice', id: this.nextId++, tone, text });
  }

  private closeQuestions(answers: Record<string, string>): void {
    this.set({ items: this.state.items.map((i) => (i.kind === 'questions' && i.answers === null ? { ...i, answers } : i)) });
  }

  /** Streams one turn. Returns the assistant content, or null when it failed or was stopped. */
  private async streamTurn(signal: AbortSignal): Promise<{ content: ArchitectContentBlock[]; stopReason: ArchitectStopReason } | null> {
    const textId = this.nextId++;
    let text = '';
    try {
      const request = this.wireAssets.length ? { messages: this.messages, assets: this.wireAssets } : { messages: this.messages };
      for await (const event of this.transport(request, signal)) {
        switch (event.type) {
          case 'text': {
            text += event.text;
            const item: ArchitectChatItem = { kind: 'assistant', id: textId, text };
            const at = this.state.items.findIndex((i) => i.id === textId);
            this.set({ items: at < 0 ? [...this.state.items, item] : this.state.items.map((i, n) => (n === at ? item : i)) });
            break;
          }
          case 'thinking':
            this.set({ activity: { thinking: `${this.state.activity?.thinking ?? ''}${event.text}`.slice(-220), progress: this.state.activity?.progress ?? null } });
            break;
          case 'tool_progress':
            this.set({ activity: { thinking: this.state.activity?.thinking ?? '', progress: event.chars } });
            break;
          case 'error':
            this.set({ error: { message: event.message, retryable: event.retryable } });
            return null;
          case 'done':
            return { content: event.content, stopReason: event.stopReason };
        }
      }
    } catch (err) {
      if (signal.aborted) return null;
      this.set({
        error:
          err instanceof ArchitectTransportError
            ? { message: err.message, retryable: err.retryable }
            : { message: `The connection to the assistant broke (${(err as Error).message}).`, retryable: true },
      });
      return null;
    }
    if (!signal.aborted) this.set({ error: { message: 'The assistant stopped before finishing its reply.', retryable: true } });
    return null;
  }

  private async runTool(block: ArchitectToolUseBlock, truncated: boolean): Promise<ArchitectToolResultBlock | 'ask'> {
    const fail = (content: string): ArchitectToolResultBlock => ({ type: 'tool_result', tool_use_id: block.id, is_error: true, content });
    if (truncated) {
      return fail('Your tool call was cut off because the reply got too long. Send it again more compactly (for example merge tiny rooms or leave out minor markers).');
    }

    if (block.name === ARCHITECT_TOOLS.askUser) {
      const questions = parseQuestions(block.input);
      if (!questions) return fail('ask_user needs a non-empty "questions" array of { id, question, options? }.');
      this.push({ kind: 'questions', id: this.nextId++, questions, answers: null });
      return 'ask';
    }

    if (block.name === ARCHITECT_TOOLS.proposeFloorPlan && this.scan) {
      const scan = this.scan;
      const result = convertProposal(block.input, scan, { assets: this.assets });
      if (!result.ok) {
        return fail(`The plan could not be shown. Fix these problems and propose again:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
      }
      const proposal: ArchitectProposal = {
        version: ++this.version,
        plan: result.plan,
        underlay: { ...result.underlay, url: scan.dataUrl },
        assumptions: result.assumptions,
        warnings: result.warnings,
      };
      this.set({ proposal, items: [...this.state.items, { kind: 'proposal', id: this.nextId++, proposal }] });
      this.emit('proposal', proposal);
      const content: ArchitectContentBlock[] = [{ type: 'text', text: result.summary }];
      try {
        const preview = await this.renderPreview(scan, result.plan, result.underlay.width / scan.width, this.assets);
        content.push({ type: 'image', source: { type: 'base64', media_type: preview.mediaType, data: preview.base64 } });
      } catch {
        content.push({ type: 'text', text: '(The preview image could not be rendered this time.)' });
      }
      return { type: 'tool_result', tool_use_id: block.id, content };
    }
    return fail(`Unknown tool "${block.name}".`);
  }

  private async run(): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    this.set({ status: 'working', error: null });
    try {
      for (let step = 0; step < this.maxAutoSteps; step++) {
        this.set({ activity: { thinking: '', progress: null } });
        const turn = await this.streamTurn(controller.signal);
        if (!turn) return;
        this.messages.push({ role: 'assistant', content: turn.content });

        if (turn.stopReason === 'refusal') {
          this.notice('error', 'The assistant declined to continue with this request. Try rephrasing, or start over with a different image.');
          return;
        }
        const toolUses = turn.content.filter(isToolUse);
        if (toolUses.length === 0) return; // the assistant is waiting for the user

        const results: ArchitectToolResultBlock[] = [];
        let askId: string | null = null;
        for (const block of toolUses) {
          const result = await this.runTool(block, turn.stopReason === 'max_tokens');
          if (result === 'ask') askId = block.id;
          else results.push(result);
        }
        if (askId) {
          this.pending = { askId, results };
          this.set({ status: 'answering' });
          return;
        }
        this.messages.push({ role: 'user', content: results });
      }
      this.notice('info', 'The assistant paused. Send a message to let it continue.');
    } finally {
      this.abort = null;
      this.set({ activity: null, status: this.state.status === 'working' ? 'idle' : this.state.status });
    }
  }
}
