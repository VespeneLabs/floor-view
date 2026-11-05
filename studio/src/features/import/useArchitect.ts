import type Anthropic from '@anthropic-ai/sdk';
import type { FloorPlan, Underlay } from '@vespenelabs/floorview';
import { useRef, useState } from 'react';

import { convertProposal } from './plan-conversion';
import { ARCHITECT_ENDPOINT, type ArchitectEvent } from './protocol';
import { renderOverlay, type Scan } from './scan';

/**
 * Runs the floor plan assistant from the browser: sends the conversation to /api/architect,
 * streams one turn, executes the tools (questions are shown to the user, plan proposals are
 * validated and previewed) and loops until the assistant waits for the user.
 *
 * The conversation is append-only: assistant content is stored exactly as returned (thinking
 * blocks included) and earlier turns are never edited.
 */

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface Question {
  id: string;
  question: string;
  options: string[];
}

export interface Proposal {
  version: number;
  plan: FloorPlan;
  underlay: Underlay;
  assumptions: string[];
  warnings: string[];
}

export type ChatItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'questions'; id: number; questions: Question[]; answers: Record<string, string> | null }
  | { kind: 'proposal'; id: number; proposal: Proposal }
  | { kind: 'notice'; id: number; tone: 'info' | 'error'; text: string };

export type Status = 'idle' | 'working' | 'answering';

export interface FacilityDetails {
  buildingType: string;
  floors: string;
  knownMeasurement: string;
  include: string[];
  notes: string;
}

/** Tool rounds the assistant may run on its own before handing back to the user. */
const MAX_AUTO_STEPS = 6;

let nextId = 1;

function firstMessage(scan: Scan, details: FacilityDetails): MessageParam {
  const lines = [
    `I've uploaded a drawing of our facility ("${scan.fileName}"). Image size: ${scan.width} × ${scan.height} px.`,
    '',
    'About the facility:',
    `- Type: ${details.buildingType}`,
    `- Floors: ${details.floors}`,
    `- Known measurement: ${details.knownMeasurement.trim() || 'none given'}`,
    `- Please include: ${details.include.join(', ') || 'walls and rooms'}`,
  ];
  if (details.notes.trim()) lines.push(`- Notes: ${details.notes.trim()}`);
  lines.push('', 'Please read the drawing and build an initial floor plan for me.');
  return {
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: scan.mediaType, data: scan.base64 } },
      { type: 'text', text: lines.join('\n') },
    ],
  };
}

function parseQuestions(input: unknown): Question[] | null {
  const raw = (input as { questions?: unknown })?.questions;
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

async function* readEvents(response: Response): AsyncGenerator<ArchitectEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as ArchitectEvent;
    }
  }
}

export function useArchitect(scan: Scan | null) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [activity, setActivity] = useState<{ thinking: string; progress: number | null } | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const messages = useRef<MessageParam[]>([]);
  /** Results of tools that ran in the same turn as an ask_user; sent together with the answers. */
  const pending = useRef<{ askId: string; results: ToolResult[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const version = useRef(0);

  const push = (item: ChatItem) => setItems((list) => [...list, item]);
  const notice = (tone: 'info' | 'error', text: string) => push({ kind: 'notice', id: nextId++, tone, text });

  /** Streams one turn. Returns the assistant content, or null when it failed or was stopped. */
  async function streamTurn(signal: AbortSignal): Promise<{ content: Anthropic.Beta.BetaContentBlock[]; stopReason: string | null } | null> {
    const textId = nextId++;
    let text = '';
    let response: Response;
    try {
      response = await fetch(ARCHITECT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: messages.current }),
        signal,
      });
    } catch (err) {
      if (!signal.aborted) setError({ message: `Could not reach the assistant (${(err as Error).message}).`, retryable: true });
      return null;
    }
    if (!response.ok) {
      setError({ message: `The assistant endpoint answered ${response.status}: ${await response.text()}`, retryable: response.status >= 500 });
      return null;
    }
    try {
      for await (const event of readEvents(response)) {
        switch (event.type) {
          case 'text':
            text += event.text;
            setItems((list) => {
              const at = list.findIndex((i) => i.id === textId);
              const item: ChatItem = { kind: 'assistant', id: textId, text };
              return at < 0 ? [...list, item] : list.map((i, n) => (n === at ? item : i));
            });
            break;
          case 'thinking':
            setActivity((a) => ({ thinking: `${a?.thinking ?? ''}${event.text}`.slice(-220), progress: a?.progress ?? null }));
            break;
          case 'tool_progress':
            setActivity((a) => ({ thinking: a?.thinking ?? '', progress: event.chars }));
            break;
          case 'error':
            setError({ message: event.message, retryable: event.retryable });
            return null;
          case 'done':
            return { content: event.content, stopReason: event.stopReason };
        }
      }
    } catch (err) {
      if (!signal.aborted) setError({ message: `The connection to the assistant broke (${(err as Error).message}).`, retryable: true });
      return null;
    }
    if (!signal.aborted) setError({ message: 'The assistant stopped before finishing its reply.', retryable: true });
    return null;
  }

  async function runTool(block: Anthropic.Beta.BetaToolUseBlock, truncated: boolean): Promise<ToolResult | 'ask'> {
    const fail = (content: string): ToolResult => ({ type: 'tool_result', tool_use_id: block.id, is_error: true, content });
    if (truncated) return fail('Your tool call was cut off because the reply got too long. Send it again more compactly (for example merge tiny rooms or leave out minor markers).');

    if (block.name === 'ask_user') {
      const questions = parseQuestions(block.input);
      if (!questions) return fail('ask_user needs a non-empty "questions" array of { id, question, options? }.');
      push({ kind: 'questions', id: nextId++, questions, answers: null });
      return 'ask';
    }

    if (block.name === 'propose_floor_plan' && scan) {
      const result = convertProposal(block.input, scan);
      if (!result.ok) {
        return fail(`The plan could not be shown. Fix these problems and propose again:\n${result.errors.map((e) => `- ${e}`).join('\n')}`);
      }
      const mpp = result.underlay.width / scan.width;
      const next: Proposal = {
        version: ++version.current,
        plan: result.plan,
        underlay: { ...result.underlay, url: scan.dataUrl },
        assumptions: result.assumptions,
        warnings: result.warnings,
      };
      setProposal(next);
      push({ kind: 'proposal', id: nextId++, proposal: next });
      const overlay = await renderOverlay(scan, result.plan, mpp);
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: [
          { type: 'text', text: result.summary },
          { type: 'image', source: { type: 'base64', media_type: overlay.mediaType, data: overlay.base64 } },
        ],
      };
    }
    return fail(`Unknown tool "${block.name}".`);
  }

  async function run(): Promise<void> {
    const controller = new AbortController();
    abort.current = controller;
    setStatus('working');
    setError(null);
    try {
      for (let step = 0; step < MAX_AUTO_STEPS; step++) {
        setActivity({ thinking: '', progress: null });
        const turn = await streamTurn(controller.signal);
        if (!turn) return;
        messages.current.push({ role: 'assistant', content: turn.content });

        if (turn.stopReason === 'refusal') {
          notice('error', 'The assistant declined to continue with this request. Try rephrasing, or start over with a different image.');
          return;
        }
        const toolUses = turn.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) return; // the assistant is waiting for the user

        const results: ToolResult[] = [];
        let askId: string | null = null;
        for (const block of toolUses) {
          const result = await runTool(block, turn.stopReason === 'max_tokens');
          if (result === 'ask') askId = block.id;
          else results.push(result);
        }
        if (askId) {
          pending.current = { askId, results };
          setStatus('answering');
          return;
        }
        messages.current.push({ role: 'user', content: results });
      }
      notice('info', 'The assistant paused. Send a message to let it continue.');
    } finally {
      setActivity(null);
      abort.current = null;
      setStatus((s) => (s === 'working' ? 'idle' : s));
    }
  }

  return {
    items,
    status,
    activity,
    error,
    proposal,
    /** Start the conversation with the scan and the wizard's answers. */
    start(details: FacilityDetails) {
      if (!scan || messages.current.length) return;
      messages.current.push(firstMessage(scan, details));
      push({ kind: 'user', id: nextId++, text: `Uploaded “${scan.fileName}” (${details.buildingType}, ${details.floors}).` });
      void run();
    },
    /** Answer the open questions (keyed by question id). */
    answer(answers: Record<string, string>) {
      const open = pending.current;
      if (!open) return;
      pending.current = null;
      setItems((list) => list.map((i) => (i.kind === 'questions' && i.answers === null ? { ...i, answers } : i)));
      const text = Object.entries(answers)
        .map(([id, value]) => `${id}: ${value || '(no answer)'}`)
        .join('\n');
      messages.current.push({ role: 'user', content: [...open.results, { type: 'tool_result', tool_use_id: open.askId, content: text }] });
      void run();
    },
    /** Send a chat message. While questions are open, it answers them in free text. */
    send(text: string) {
      const value = text.trim();
      if (!value || status === 'working') return;
      push({ kind: 'user', id: nextId++, text: value });
      const open = pending.current;
      if (open) {
        pending.current = null;
        setItems((list) => list.map((i) => (i.kind === 'questions' && i.answers === null ? { ...i, answers: { reply: value } } : i)));
        messages.current.push({ role: 'user', content: [...open.results, { type: 'tool_result', tool_use_id: open.askId, content: value }] });
      } else {
        messages.current.push({ role: 'user', content: [{ type: 'text', text: value }] });
      }
      void run();
    },
    stop() {
      abort.current?.abort();
    },
    retry() {
      if (status !== 'working') void run();
    },
  };
}
