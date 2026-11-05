import { polygonArea } from '@vespenelabs/floorview';
import { AlertTriangle, ArrowUp, Check, Loader2, RotateCcw, Sparkles, Square } from 'lucide-react';
import { cn } from 'cn';
import { useEffect, useId, useRef, useState } from 'react';

import type { ChatItem, Proposal, Question, useArchitect } from './useArchitect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Architect = ReturnType<typeof useArchitect>;

function QuestionsCard({ questions, onSubmit, disabled }: { questions: Question[]; onSubmit: (answers: Record<string, string>) => void; disabled: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const baseId = useId();
  const complete = questions.every((q) => answers[q.id]?.trim());
  return (
    <form
      className="grid gap-3 rounded-lg border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(answers);
      }}
    >
      {questions.map((q, i) => (
        <fieldset key={q.id} className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">{q.question}</legend>
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={answers[q.id] === option ? 'default' : 'outline'}
                  aria-pressed={answers[q.id] === option}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: option }))}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          <Input
            aria-label={`${q.question} (your own answer)`}
            id={`${baseId}-${i}`}
            placeholder={q.options.length ? 'Or type your own answer' : 'Your answer'}
            value={q.options.includes(answers[q.id] ?? '') ? '' : (answers[q.id] ?? '')}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          />
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onSubmit(Object.fromEntries(questions.map((q) => [q.id, answers[q.id] || 'Not sure - please assume'])))}>
          Not sure - you decide
        </Button>
        <Button type="submit" size="sm" disabled={disabled || !complete}>
          Send answers
        </Button>
      </div>
    </form>
  );
}

function ProposalCard({ proposal, onApply }: { proposal: Proposal; onApply: (p: Proposal) => void }) {
  const rooms = proposal.plan.levels.flatMap((l) => l.rooms);
  const area = rooms.reduce((sum, r) => sum + polygonArea(r.points), 0);
  return (
    <div className="grid gap-2 rounded-lg border border-brand/40 bg-brand/5 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4 text-brand" aria-hidden /> Draft v{proposal.version}: {proposal.plan.name}
      </div>
      <p className="text-muted-foreground">
        {proposal.plan.levels.length} level{proposal.plan.levels.length > 1 ? 's' : ''} · {rooms.length} rooms ·{' '}
        {Math.round(area).toLocaleString()} m² · {proposal.underlay.width.toFixed(0)} × {proposal.underlay.height.toFixed(0)} m drawing
      </p>
      {proposal.assumptions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Assumptions to check ({proposal.assumptions.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {proposal.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      <div>
        <Button size="sm" onClick={() => onApply(proposal)}>
          <Check data-icon="inline-start" /> Use this plan
        </Button>
      </div>
    </div>
  );
}

function Message({ item, architect, onApply }: { item: ChatItem; architect: Architect; onApply: (p: Proposal) => void }) {
  switch (item.kind) {
    case 'user':
      return <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{item.text}</div>;
    case 'assistant':
      return <div className="max-w-[95%] text-sm leading-relaxed whitespace-pre-wrap">{item.text}</div>;
    case 'proposal':
      return <ProposalCard proposal={item.proposal} onApply={onApply} />;
    case 'notice':
      return (
        <p className={cn('rounded-md px-3 py-2 text-sm', item.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
          {item.text}
        </p>
      );
    case 'questions':
      return item.answers ? (
        <div className="rounded-lg border p-3 text-sm text-muted-foreground">
          {item.questions.map((q) => (
            <p key={q.id}>
              {q.question} <span className="text-foreground">{item.answers?.[q.id] ?? item.answers?.reply ?? '-'}</span>
            </p>
          ))}
        </div>
      ) : (
        <QuestionsCard questions={item.questions} onSubmit={architect.answer} disabled={architect.status !== 'answering'} />
      );
  }
}

export function ChatPanel({ architect, onApply }: { architect: Architect; onApply: (p: Proposal) => void }) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const { items, status, activity, error } = architect;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [items, activity]);

  const working = status === 'working';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3" aria-live="polite">
        {items.map((item) => (
          <Message key={item.id} item={item} architect={architect} onApply={onApply} />
        ))}
        {working && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
            <span className="min-w-0">
              {activity?.progress ? `Drafting the plan… ${Math.round(activity.progress / 1000)} kB` : 'Thinking…'}
              {activity?.thinking && <span className="mt-0.5 line-clamp-2 block text-xs opacity-80">{activity.thinking.trim()}</span>}
            </span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex-1">{error.message}</span>
            {error.retryable && (
              <Button size="sm" variant="outline" onClick={architect.retry}>
                <RotateCcw data-icon="inline-start" /> Retry
              </Button>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          architect.send(draft);
          setDraft('');
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message to the assistant
        </label>
        <Input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={status === 'answering' ? 'Answer in your own words…' : 'Ask for changes, e.g. “the warehouse is 40 m long”'}
          disabled={working}
        />
        {working ? (
          <Button type="button" variant="outline" size="icon" aria-label="Stop" onClick={architect.stop}>
            <Square />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim()}>
            <ArrowUp />
          </Button>
        )}
      </form>
    </div>
  );
}
