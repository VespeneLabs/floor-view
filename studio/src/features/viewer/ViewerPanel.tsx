import { FloorplanViewer, type ViewMode } from '@vespenelabs/floorview';
import { useEffect, useId, useRef, useState } from 'react';

import { occupancyLayer, sensorLayer } from './simulated-layers';
import { Panel } from '@/components/Panel';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useStudio, type ViewSettings } from '@/features/studio/studio-context';
import { useViewerTheme } from './useViewerTheme';

/** Simulated data refresh interval while a data layer is on. */
const TICK_MS = 3000;

function Toggle({ label, setting }: { label: string; setting: keyof Omit<ViewSettings, 'mode'> }) {
  const { view, updateView } = useStudio();
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox id={id} checked={view[setting]} onCheckedChange={(on) => updateView({ [setting]: on })} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

/** Mounts the library's `FloorplanViewer` and keeps it in sync with the editor and view settings. */
export function ViewerPanel() {
  const { initialPlan, viewer, setViewer, editor, snapshot, view, updateView, announce } = useStudio();
  const container = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useViewerTheme(viewer);

  useEffect(() => {
    if (!container.current) return;
    const instance = new FloorplanViewer(container.current, { plan: initialPlan, level: initialPlan.levels[0]?.id });
    setViewer(instance);
    return () => {
      setViewer(null);
      instance.dispose();
    };
  }, [initialPlan, setViewer]);

  const plan = snapshot?.plan;
  const levelId = snapshot?.levelId;

  // Edits keep the camera; a different plan (import, File → New, sample) is framed afresh.
  const shownPlanId = useRef<string | null>(null);
  useEffect(() => {
    if (!viewer || !plan) return;
    viewer.setPlan(plan, { fit: shownPlanId.current !== null && shownPlanId.current !== plan.id });
    shownPlanId.current = plan.id;
  }, [viewer, plan]);

  useEffect(() => {
    viewer?.setMode(view.mode);
  }, [viewer, view.mode]);

  useEffect(() => {
    if (viewer && levelId) viewer.setLevel(view.allLevels ? 'all' : levelId);
  }, [viewer, view.allLevels, levelId]);

  useEffect(() => {
    viewer?.setShowLabels(view.labels);
  }, [viewer, view.labels]);


  // Clicking an entity in the viewer selects it in the editor.
  useEffect(() => {
    if (!viewer || !editor) return;
    return viewer.on('click', ({ target, point }) => {
      if (target && target.kind !== 'point') {
        editor.setActiveLevel(target.levelId);
        editor.select({ kind: target.kind, id: target.id, levelId: target.levelId });
        announce(`Selected ${target.kind} ${target.id}`);
      } else if (point) {
        announce(`Clicked at ${point.x.toFixed(2)}, ${point.y.toFixed(2)} m`);
      }
    });
  }, [viewer, editor, announce]);

  // Simulated live data layers.
  const live = view.occupancy || view.sensors;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!viewer || !plan) return;
    if (view.occupancy) viewer.setLayer(occupancyLayer(tick));
    else viewer.removeLayer('occupancy');
    if (view.sensors) viewer.setLayer(sensorLayer(plan, tick));
    else viewer.removeLayer('sensors');
  }, [viewer, plan, view.occupancy, view.sensors, tick]);

  return (
    <Panel
      title="Viewer"
      actions={
        <>
          <ToggleGroup
            aria-label="View mode"
            variant="outline"
            size="sm"
            spacing={0}
            value={[view.mode]}
            onValueChange={([mode]) => mode && updateView({ mode: mode as ViewMode })}
          >
            <ToggleGroupItem value="3d">3D</ToggleGroupItem>
            <ToggleGroupItem value="2d">2D</ToggleGroupItem>
          </ToggleGroup>
          <Toggle label="All levels" setting="allLevels" />
          <Toggle label="Labels" setting="labels" />
          <Toggle label="Occupancy" setting="occupancy" />
          <Toggle label="Sensors" setting="sensors" />
        </>
      }
    >
      <div ref={container} className="relative min-h-0 flex-1" />
    </Panel>
  );
}
