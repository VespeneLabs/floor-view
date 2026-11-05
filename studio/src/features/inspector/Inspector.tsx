import {
  distance,
  findEntity,
  getLevel,
  polygonArea,
  type EntityRef,
  type Marker,
  type Room,
  type Wall,
} from '@vespenelabs/floorview';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { Panel } from '@/components/Panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VespeneLabsMark } from '@/components/VespeneLabsMark';
import { useStudio } from '@/features/studio/studio-context';

/**
 * An input that commits on the native `change` event (blur, Enter, closing a color picker),
 * not on every keystroke, so each edit is a single undo step. It resets when `value` changes.
 */
function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string | number;
  onCommit: (value: string) => void;
}) {
  return (
    <Input
      key={String(value)}
      defaultValue={value}
      ref={(el) => {
        if (!el) return;
        const commit = () => onCommit(el.value);
        el.addEventListener('change', commit);
        return () => el.removeEventListener('change', commit);
      }}
      {...props}
    />
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <output className="text-sm break-all tabular-nums">{value}</output>
    </div>
  );
}

const positive = (v: string) => Number(v) > 0;

export function Inspector() {
  const { editor, snapshot } = useStudio();
  if (!editor || !snapshot) return (
      <Panel title="Properties">
        <VespeneLabsMark />
      </Panel>
    );

  const { plan, selection, levelId } = snapshot;
  const level = getLevel(plan, levelId);
  const entity = selection ? findEntity(plan, selection) : undefined;
  const update = (ref: EntityRef, patch: Partial<Wall & Room & Marker>) => editor.updateEntity(ref, patch);

  let title = 'Level';
  let body: ReactNode = null;

  if (selection && entity) {
    if (selection.kind === 'wall') {
      const wall = entity as Wall;
      title = 'Wall';
      body = (
        <>
          <ReadOnly label="Length" value={`${distance(wall.start, wall.end).toFixed(2)} m`} />
          <Field label="Thickness (m)">
            {(id) => (
              <CommitInput
                id={id}
                type="number"
                step={0.01}
                min={0.01}
                value={wall.thickness}
                onCommit={(v) => positive(v) && update(selection, { thickness: Number(v) })}
              />
            )}
          </Field>
          <Field label="Height (m)">
            {(id) => (
              <CommitInput
                id={id}
                type="number"
                step={0.1}
                min={0.1}
                value={wall.height ?? ''}
                placeholder={`Level default (${level?.height ?? 3})`}
                onCommit={(v) => update(selection, { height: positive(v) ? Number(v) : undefined })}
              />
            )}
          </Field>
        </>
      );
    } else if (selection.kind === 'room') {
      const room = entity as Room;
      title = 'Room';
      body = (
        <>
          <Field label="Name">{(id) => <CommitInput id={id} value={room.name} onCommit={(v) => update(selection, { name: v })} />}</Field>
          <Field label="Color">
            {(id) => (
              <CommitInput
                id={id}
                type="color"
                className="p-1"
                value={room.color ?? '#dbe3ec'}
                onCommit={(v) => update(selection, { color: v })}
              />
            )}
          </Field>
          <Field label="Capacity (people)">
            {(id) => (
              <CommitInput
                id={id}
                type="number"
                step={1}
                min={0}
                value={Number(room.data?.capacity ?? 0)}
                onCommit={(v) => update(selection, { data: { ...room.data, capacity: Math.max(0, Number(v)) } })}
              />
            )}
          </Field>
          <ReadOnly label="Area" value={`${polygonArea(room.points).toFixed(2)} m²`} />
        </>
      );
    } else {
      const marker = entity as Marker;
      title = 'Marker';
      body = (
        <>
          <Field label="Name">{(id) => <CommitInput id={id} value={marker.name} onCommit={(v) => update(selection, { name: v })} />}</Field>
          <Field label="Kind">
            {(id) => (
              <CommitInput
                id={id}
                value={marker.kind ?? ''}
                placeholder="desk, exit, sensor…"
                onCommit={(v) => update(selection, { kind: v || undefined })}
              />
            )}
          </Field>
          <Field label="Color">
            {(id) => (
              <CommitInput
                id={id}
                type="color"
                className="p-1"
                value={marker.color ?? '#7c3aed'}
                onCommit={(v) => update(selection, { color: v })}
              />
            )}
          </Field>
        </>
      );
    }
    body = (
      <>
        {body}
        <ReadOnly label="ID" value={entity.id} />
      </>
    );
  } else if (level) {
    body = (
      <>
        <Field label="Name">{(id) => <CommitInput id={id} value={level.name} onCommit={(v) => editor.updateLevel(level.id, { name: v })} />}</Field>
        <Field label="Elevation (m)">
          {(id) => (
            <CommitInput
              id={id}
              type="number"
              step={0.1}
              value={level.elevation}
              onCommit={(v) => editor.updateLevel(level.id, { elevation: Number(v) })}
            />
          )}
        </Field>
        <Field label="Wall height (m)">
          {(id) => (
            <CommitInput
              id={id}
              type="number"
              step={0.1}
              min={0.1}
              value={level.height}
              onCommit={(v) => positive(v) && editor.updateLevel(level.id, { height: Number(v) })}
            />
          )}
        </Field>
        <ReadOnly
          label="Contents"
          value={`${level.walls.length} walls · ${level.rooms.length} rooms · ${level.markers.length} markers`}
        />
      </>
    );
  }

  return (
    <Panel title={title}>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-3">{body}</div>
      <VespeneLabsMark />
    </Panel>
  );
}
