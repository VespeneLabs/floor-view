import type { EditorTool } from '@vespenelabs/floorview';

import { useStudio } from './studio-context';
import { useRoute } from '@/lib/route';

const HINTS: Record<EditorTool, string> = {
  select: 'Click to select · drag to move · drag handles to reshape · drag empty space to pan · Del deletes · scroll zooms',
  wall: 'Click to start, click each corner · click the same point twice, right-click or Esc to stop · Shift: 45° · Alt: no snap',
  room: 'Click the corners · click the first corner, Enter or right-click to close · Esc cancels · Shift: 45° · Alt: no snap',
  marker: 'Click to place a marker · Alt: no snap',
  pan: 'Drag to pan · scroll to zoom',
};

export function StatusBar() {
  const { snapshot, message } = useStudio();
  const route = useRoute();
  const hint =
    route === 'air-quality'
      ? 'Simulated sensors · hover rooms or sensors for readings · drag the timeline or play a day'
      : route === 'import'
        ? 'Upload a scan or sketch · the assistant asks what it needs and drafts a plan · “Use this plan” opens it in the editor'
        : snapshot
        ? HINTS[snapshot.tool]
        : 'Loading…';
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-background px-3 py-1.5 text-xs text-muted-foreground sm:px-4">
      <p className="min-w-0 flex-1">{hint}</p>
      <p role="status" aria-live="polite" className="font-mono">
        {message}
      </p>
    </footer>
  );
}
