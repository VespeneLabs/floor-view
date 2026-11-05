import { FloorplanViewer, type ViewMode } from '@vespenelabs/floorview';
import { useEffect, useId, useRef, useState } from 'react';

import type { Proposal } from './useArchitect';
import type { Scan } from './scan';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useViewerTheme } from '@/features/viewer/useViewerTheme';

/** The scan alone until the first proposal arrives, then the proposal over the scan (2D or 3D). */
export function PlanPreview({ scan, proposal }: { scan: Scan; proposal: Proposal | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<FloorplanViewer | null>(null);
  const [mode, setMode] = useState<ViewMode>('2d');
  const [opacity, setOpacity] = useState(0.6);
  const opacityId = useId();
  useViewerTheme(viewer);

  const hasProposal = proposal !== null;
  // Create the viewer once the first proposal exists; later proposals update it below.
  useEffect(() => {
    if (!container.current || !hasProposal) return;
    const instance = new FloorplanViewer(container.current, { mode: '2d', level: 'all' });
    setViewer(instance);
    return () => {
      setViewer(null);
      instance.dispose();
    };
  }, [hasProposal]);

  useEffect(() => {
    if (!viewer || !proposal) return;
    viewer.setPlan(proposal.plan, { fit: proposal.version === 1 });
    // See-through floors, so the draft can be checked against the drawing underneath.
    viewer.setLayer({ id: 'see-through', type: 'rooms', color: (room) => room.color ?? '#dbe3ec', opacity: 0.55 });
  }, [viewer, proposal]);

  useEffect(() => {
    if (!viewer || !proposal) return;
    viewer.setUnderlay({ ...proposal.underlay, opacity });
  }, [viewer, proposal, opacity]);

  useEffect(() => {
    viewer?.setMode(mode);
  }, [viewer, mode]);

  if (!proposal) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-(--canvas) p-4">
        <img src={scan.dataUrl} alt={`Uploaded drawing ${scan.fileName}`} className="max-h-full max-w-full object-contain shadow-sm" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <span className="text-sm font-medium">Draft v{proposal.version}</span>
        <ToggleGroup
          aria-label="Preview mode"
          variant="outline"
          size="sm"
          spacing={0}
          value={[mode]}
          onValueChange={([value]) => value && setMode(value as ViewMode)}
        >
          <ToggleGroupItem value="2d">2D</ToggleGroupItem>
          <ToggleGroupItem value="3d">3D</ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={opacityId} className="text-xs text-muted-foreground">
            Scan
          </Label>
          <input
            id={opacityId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-28 accent-brand"
          />
        </div>
      </div>
      <div ref={container} className="relative min-h-0 flex-1" />
    </div>
  );
}
