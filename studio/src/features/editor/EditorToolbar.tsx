import type { EditorTool } from '@vespenelabs/floorview';
import {
  BrickWall,
  Hand,
  ImageIcon,
  MapPin,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  SquareDashed,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStudio } from '@/features/studio/studio-context';

const TOOLS: { tool: EditorTool; label: string; shortcut: string; icon: LucideIcon }[] = [
  { tool: 'select', label: 'Select and move', shortcut: 'V', icon: MousePointer2 },
  { tool: 'wall', label: 'Draw walls', shortcut: 'W', icon: BrickWall },
  { tool: 'room', label: 'Draw rooms', shortcut: 'R', icon: SquareDashed },
  { tool: 'marker', label: 'Place markers', shortcut: 'M', icon: MapPin },
  { tool: 'pan', label: 'Pan', shortcut: 'H', icon: Hand },
];

const GRID_SIZES = [
  { value: '0.1', label: '10 cm' },
  { value: '0.25', label: '25 cm' },
  { value: '0.5', label: '50 cm' },
  { value: '1', label: '1 m' },
];

/** Icon button with a tooltip; the label doubles as the accessible name. */
function IconAction({
  label,
  shortcut,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
        <Icon />
      </Button>
    </Hint>
  );
}

function Hint({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        {shortcut && <kbd className="ml-2 font-sans text-xs opacity-70">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar() {
  const { editor, snapshot, underlay, underlayVisible, setUnderlayVisible } = useStudio();
  const snapId = useId();
  const gridId = useId();
  const levelId = useId();
  const levels = snapshot?.plan.levels ?? [];
  const disabled = !editor || !snapshot;

  return (
    <div
      role="toolbar"
      aria-label="Editor"
      className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b bg-background px-3 py-2 sm:px-4"
    >
      <ToggleGroup
        aria-label="Tool"
        value={snapshot ? [snapshot.tool] : []}
        onValueChange={([tool]) => tool && editor?.setTool(tool as EditorTool)}
        spacing={1}
        disabled={disabled}
      >
        {TOOLS.map(({ tool, label, shortcut, icon: Icon }) => (
          <Hint key={tool} label={label} shortcut={shortcut}>
            <ToggleGroupItem value={tool} aria-label={label} className="data-pressed:text-brand">
              <Icon />
            </ToggleGroupItem>
          </Hint>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <IconAction label="Undo" shortcut="⌘Z" icon={Undo2} onClick={() => editor?.undo()} disabled={!snapshot?.canUndo} />
      <IconAction label="Redo" shortcut="⇧⌘Z" icon={Redo2} onClick={() => editor?.redo()} disabled={!snapshot?.canRedo} />
      <IconAction
        label="Delete selection"
        shortcut="Del"
        icon={Trash2}
        onClick={() => editor?.deleteSelection()}
        disabled={!snapshot?.selection}
      />
      <IconAction
        label="Rotate left 15° (Shift: 90°)"
        shortcut="Q"
        icon={RotateCcw}
        onClick={() => editor?.rotateSelection(-15)}
        disabled={snapshot?.selection?.kind !== 'marker'}
      />
      <IconAction
        label="Rotate right 15° (Shift: 90°)"
        shortcut="E"
        icon={RotateCw}
        onClick={() => editor?.rotateSelection(15)}
        disabled={snapshot?.selection?.kind !== 'marker'}
      />
      <IconAction label="Fit to view" shortcut="F" icon={Maximize} onClick={() => editor?.fitView()} disabled={disabled} />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <div className="flex items-center gap-1.5">
        <Label htmlFor={levelId} className="text-muted-foreground">
          Level
        </Label>
        <Select
          items={levels.map((l) => ({ value: l.id, label: l.name || l.id }))}
          value={snapshot?.levelId ?? null}
          onValueChange={(id) => id && editor?.setActiveLevel(id)}
          disabled={disabled}
        >
          <SelectTrigger id={levelId} size="sm" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name || l.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconAction label="Add level" icon={Plus} onClick={() => editor?.addLevel()} disabled={disabled} />
        <IconAction
          label="Remove level"
          icon={Minus}
          onClick={() => snapshot && editor?.removeLevel(snapshot.levelId)}
          disabled={levels.length <= 1}
        />
      </div>

      {underlay && (
        <Hint label={underlayVisible ? 'Hide scanned drawing' : 'Show scanned drawing'}>
          <Button
            variant={underlayVisible ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={underlayVisible}
            onClick={() => setUnderlayVisible(!underlayVisible)}
          >
            <ImageIcon data-icon="inline-start" /> Scan
          </Button>
        </Hint>
      )}

      <Separator orientation="vertical" className="mx-1 h-6 max-sm:hidden" />

      <div className="flex items-center gap-2">
        <Switch id={snapId} defaultChecked onCheckedChange={(on) => editor?.setSnap(on)} disabled={disabled} />
        <Label htmlFor={snapId}>Snap</Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={gridId} className="text-muted-foreground">
          Grid
        </Label>
        <Select
          items={GRID_SIZES}
          defaultValue="0.25"
          onValueChange={(v) => v && editor?.setGrid(Number(v))}
          disabled={disabled}
        >
          <SelectTrigger id={gridId} size="sm" className="min-w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRID_SIZES.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
