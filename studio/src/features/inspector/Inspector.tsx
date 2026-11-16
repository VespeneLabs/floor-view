import {
  distance,
  findEntity,
  getLevel,
  pipelineLength,
  polygonArea,
  type EntityRef,
  type Marker,
  type Pipeline,
  type Room,
  type Wall,
} from '@vespenelabs/floorview';
import { gasMedium } from '@vespenelabs/floorview/gas';
import { Route } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { CommitInput } from '@/components/CommitInput';
import { MediumSelect } from '@/components/MediumSelect';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { VespeneLabsMark } from '@/components/VespeneLabsMark';
import { useStudio } from '@/features/studio/studio-context';
import { ASSETS } from '@/lib/assets';

import { PipePointsTable } from './PipePointsTable';

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
  const { editor, snapshot, announce } = useStudio();
  if (!editor || !snapshot) return (
      <Panel title="Properties">
        <VespeneLabsMark />
      </Panel>
    );

  const { plan, selection, levelId } = snapshot;
  const level = getLevel(plan, levelId);
  const entity = selection ? findEntity(plan, selection) : undefined;
  const update = (ref: EntityRef, patch: Partial<Wall & Room & Marker> | Partial<Pipeline>) => editor.updateEntity(ref, patch);
  const markerName = (id: string | undefined) => (id ? (level?.markers.find((m) => m.id === id)?.name ?? id) : 'Not connected');

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
    } else if (selection.kind === 'pipeline') {
      const pipe = entity as Pipeline;
      const heights = pipe.points.map((p) => p.z);
      title = 'Pipeline';
      body = (
        <>
          <Field label="Name">{(id) => <CommitInput id={id} value={pipe.name} onCommit={(v) => update(selection, { name: v })} />}</Field>
          <Field label="Medium">
            {(id) => (
              <MediumSelect
                id={id}
                className="w-full"
                value={pipe.medium}
                // A preset also brings its identification color (the diameter stays), and renames
                // a pipeline still called after its old medium ("Nitrogen 1" → "Hydrogen 1").
                onChange={(medium, value) => {
                  const auto = pipe.name.match(/^(.*) (\d+)$/);
                  const rename = medium && auto && auto[1] === gasMedium(pipe.medium)?.name ? { name: `${medium.name} ${auto[2]}` } : {};
                  update(selection, medium ? { medium: medium.id, color: medium.color, ...rename } : { medium: value });
                }}
              />
            )}
          </Field>
          <Field label="Diameter (mm)">
            {(id) => (
              <CommitInput
                id={id}
                type="number"
                step={5}
                min={1}
                value={Math.round(pipe.diameter * 10000) / 10}
                onCommit={(v) => positive(v) && update(selection, { diameter: Number(v) / 1000 })}
              />
            )}
          </Field>
          <Field label="Color">
            {(id) => (
              <div className="flex items-center gap-2">
                <CommitInput
                  id={id}
                  type="color"
                  className="p-1"
                  value={pipe.color ?? '#ca8a04'}
                  onCommit={(v) => update(selection, { color: v })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pipe.color}
                  aria-label="Use the default pipe color"
                  onClick={() => update(selection, { color: undefined })}
                >
                  Default
                </Button>
              </div>
            )}
          </Field>
          <ReadOnly label="Length (3D)" value={`${pipelineLength(pipe).toFixed(2)} m`} />
          <ReadOnly label="Height" value={`${Math.min(...heights).toFixed(2)}–${Math.max(...heights).toFixed(2)} m`} />
          <ReadOnly label="From" value={markerName(pipe.from)} />
          <ReadOnly label="To" value={markerName(pipe.to)} />
          <PipePointsTable pipe={pipe} onChange={(points) => update(selection, { points })} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => announce(editor.reroutePipeline(selection) ? `${pipe.name} routed again` : `${pipe.name} could not be routed`)}
          >
            <Route data-icon="inline-start" /> Route automatically
          </Button>
          <p className="text-xs text-muted-foreground">
            Drag a point to reshape, or a grip in the middle of a segment to slide it sideways. Alt-click the pipe to add a point; click a point and press
            Delete (or Alt-click it) to remove it.
          </p>
        </>
      );
    } else {
      const marker = entity as Marker;
      const asset = marker.model ? ASSETS.find((a) => a.id === marker.model) : undefined;
      title = marker.model ? '3D model' : 'Marker';
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
          <Field label={marker.model ? 'Accent color' : 'Color'}>
            {(id) => (
              <div className="flex items-center gap-2">
                <CommitInput
                  id={id}
                  type="color"
                  className="p-1"
                  value={marker.color ?? (marker.model ? '#14b8a6' : '#7c3aed')}
                  onCommit={(v) => update(selection, { color: v })}
                />
                {marker.model && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!marker.color}
                    aria-label="Remove accent color"
                    onClick={() => update(selection, { color: undefined })}
                  >
                    None
                  </Button>
                )}
              </div>
            )}
          </Field>
          {marker.pipelineId && (
            <ReadOnly
              label="On pipeline"
              value={level?.pipelines.find((p) => p.id === marker.pipelineId)?.name ?? marker.pipelineId}
            />
          )}
          {marker.model && !marker.color && (
            <p className="-mt-2 text-xs text-muted-foreground">No accent: the model is drawn in white clay. An accent colors its accent parts (pipes, cylinders…), or the whole model if it has none.</p>
          )}
          {marker.model && (
            <>
              <ReadOnly label="Model" value={asset ? `${asset.name} (${asset.category})` : `${marker.model} (not in the library)`} />
              <Field label="Rotation (°, Q / E)">
                {(id) => (
                  <CommitInput
                    id={id}
                    type="number"
                    step={15}
                    value={marker.rotation ?? 0}
                    onCommit={(v) => Number.isFinite(Number(v)) && update(selection, { rotation: ((Number(v) % 360) + 360) % 360 })}
                  />
                )}
              </Field>
              <Field label="Scale">
                {(id) => (
                  <CommitInput
                    id={id}
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={marker.scale ?? 1}
                    onCommit={(v) => positive(v) && update(selection, { scale: Number(v) === 1 ? undefined : Number(v) })}
                  />
                )}
              </Field>
              <Field label="Height above floor (m, PgUp / PgDn)">
                {(id) => (
                  <CommitInput
                    id={id}
                    type="number"
                    step={0.05}
                    value={marker.elevation ?? 0}
                    onCommit={(v) => Number.isFinite(Number(v)) && update(selection, { elevation: Number(v) === 0 ? undefined : Number(v) })}
                  />
                )}
              </Field>
              {asset && (
                <ReadOnly
                  label="Size"
                  value={`${(asset.size.width * (marker.scale ?? 1)).toFixed(2)} × ${(asset.size.depth * (marker.scale ?? 1)).toFixed(2)} × ${(asset.size.height * (marker.scale ?? 1)).toFixed(2)} m`}
                />
              )}
            </>
          )}
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
