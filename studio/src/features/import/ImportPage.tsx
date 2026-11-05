import { FileImage, Upload } from 'lucide-react';
import { cn } from 'cn';
import { useId, useState } from 'react';

import { ChatPanel } from './ChatPanel';
import { PlanPreview } from './PlanPreview';
import { ACCEPTED_TYPES, prepareScan, type Scan } from './scan';
import { useArchitect, type FacilityDetails, type Proposal } from './useArchitect';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStudio } from '@/features/studio/studio-context';
import { navigate } from '@/lib/route';

type Step = 'upload' | 'details' | 'assistant';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload drawing' },
  { id: 'details', label: 'About the facility' },
  { id: 'assistant', label: 'Build with the assistant' },
];

const BUILDING_TYPES = ['Factory', 'Warehouse / logistics', 'Mixed production and offices', 'Office building', 'Other'];
const FLOORS = ['1 floor', '1 floor with mezzanine', '2 floors', '3 or more floors'];
const INCLUDE = ['Rooms and areas', 'Machines and equipment', 'Exits and doors', 'Loading docks', 'Fire safety equipment'];

function Stepper({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Import steps">
      {STEPS.map((s, i) => (
        <li key={s.id} aria-current={i === index ? 'step' : undefined} className={cn('flex items-center gap-2', i > index && 'text-muted-foreground')}>
          <span className={cn('grid size-6 place-items-center rounded-full border text-xs', i <= index && 'border-brand bg-brand text-white')}>{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({ onScan }: { onScan: (scan: Scan) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  async function accept(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onScan(await prepareScan(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid place-items-center p-4">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files[0]);
        }}
        className={cn(
          'grid w-full max-w-xl cursor-pointer place-items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring',
          dragging && 'border-brand bg-brand/5',
        )}
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden />
        <span className="text-base font-medium">{busy ? 'Preparing the image…' : 'Drop your floor plan drawing here, or click to choose'}</span>
        <span className="text-sm text-muted-foreground">
          A scan, photo or sketch works (PNG, JPG or WebP). The assistant reads it and builds a first plan with you - you can refine everything afterwards.
        </span>
        <input id={inputId} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" disabled={busy} onChange={(e) => void accept(e.target.files?.[0])} />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailsStep({ scan, onBack, onStart }: { scan: Scan; onBack: () => void; onStart: (details: FacilityDetails) => void }) {
  const [details, setDetails] = useState<FacilityDetails>({
    buildingType: 'Factory',
    floors: '1 floor',
    knownMeasurement: '',
    include: ['Rooms and areas', 'Exits and doors', 'Loading docks'],
    notes: '',
  });
  const ids = { type: useId(), floors: useId(), measure: useId(), notes: useId() };
  const update = (patch: Partial<FacilityDetails>) => setDetails((d) => ({ ...d, ...patch }));

  return (
    <form
      className="mx-auto grid w-full max-w-4xl gap-6 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(details);
      }}
    >
      <figure className="grid content-start gap-2">
        <img src={scan.dataUrl} alt={`Uploaded drawing ${scan.fileName}`} className="max-h-96 w-full rounded-md border bg-white object-contain" />
        <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileImage className="size-3.5" aria-hidden /> {scan.fileName} · {scan.width} × {scan.height} px
        </figcaption>
      </figure>

      <div className="grid content-start gap-4">
        <p className="text-sm text-muted-foreground">A few details help the assistant read the drawing. Skip anything you don't know.</p>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.type}>What kind of building is it?</Label>
          <Select items={BUILDING_TYPES.map((t) => ({ value: t, label: t }))} value={details.buildingType} onValueChange={(v) => v && update({ buildingType: v })}>
            <SelectTrigger id={ids.type} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.floors}>How many floors does the drawing cover?</Label>
          <Select items={FLOORS.map((f) => ({ value: f, label: f }))} value={details.floors} onValueChange={(v) => v && update({ floors: v })}>
            <SelectTrigger id={ids.floors} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FLOORS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.measure}>One measurement you know (optional)</Label>
          <Input
            id={ids.measure}
            placeholder="e.g. the building is 120 m long"
            value={details.knownMeasurement}
            onChange={(e) => update({ knownMeasurement: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Gives the plan the right size if the drawing has no dimensions or scale bar.</p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">What should the plan include?</legend>
          {INCLUDE.map((option) => {
            const id = `${ids.notes}-${option}`;
            return (
              <div key={option} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={details.include.includes(option)}
                  onCheckedChange={(on) => update({ include: on ? [...details.include, option] : details.include.filter((o) => o !== option) })}
                />
                <Label htmlFor={id} className="font-normal">
                  {option}
                </Label>
              </div>
            );
          })}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.notes}>Anything else? (optional)</Label>
          <textarea
            id={ids.notes}
            rows={3}
            value={details.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="e.g. the hand-written notes are in German; ignore the parking lot"
            className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            Choose another drawing
          </Button>
          <Button type="submit">Start building</Button>
        </div>
      </div>
    </form>
  );
}

/** AI-assisted import: upload a scanned drawing, answer a few questions, iterate on a draft with the assistant. */
export function ImportPage() {
  const { editor, setUnderlay, setUnderlayVisible, announce } = useStudio();
  const [step, setStep] = useState<Step>('upload');
  const [scan, setScan] = useState<Scan | null>(null);
  const architect = useArchitect(scan);

  function apply(proposal: Proposal) {
    if (!editor) return;
    editor.setPlan(proposal.plan, { keepHistory: true });
    setUnderlay({ ...proposal.underlay, opacity: 0.45 });
    setUnderlayVisible(true);
    announce(`Loaded draft v${proposal.version} into the editor (undo restores your previous plan)`);
    navigate('editor');
  }

  return (
    <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-y-auto p-2">
      <div className="rounded-xl border bg-card px-4 py-3">
        <Stepper step={step} />
      </div>
      {step === 'upload' && (
        <Panel title="Import a floor plan drawing">
          <UploadStep
            onScan={(s) => {
              setScan(s);
              setStep('details');
            }}
          />
        </Panel>
      )}
      {step === 'details' && scan && (
        <Panel title="About the facility" className="overflow-y-auto">
          <DetailsStep
            scan={scan}
            onBack={() => setStep('upload')}
            onStart={(details) => {
              setStep('assistant');
              architect.start(details);
            }}
          />
        </Panel>
      )}
      {step === 'assistant' && scan && (
        <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <Panel title="Preview">
            <PlanPreview scan={scan} proposal={architect.proposal} />
          </Panel>
          <Panel title="Floor plan assistant" className="min-h-[28rem] lg:min-h-0">
            <ChatPanel architect={architect} onApply={apply} />
          </Panel>
        </div>
      )}
    </main>
  );
}
