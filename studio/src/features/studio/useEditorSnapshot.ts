import { useCallback, useSyncExternalStore } from 'react';

import type { EditorTool, EntityRef, FloorPlan, FloorplanEditor, MarkerTemplate } from '@vespenelabs/floorview';

/** Everything the UI reads from the editor, as one immutable value. */
export interface EditorSnapshot {
  plan: FloorPlan;
  selection: EntityRef | null;
  tool: EditorTool;
  levelId: string;
  canUndo: boolean;
  canRedo: boolean;
  /** What the marker tool places (e.g. a 3D model picked in the asset library), or null. */
  markerTemplate: MarkerTemplate | null;
}

const EVENTS = ['change', 'selectionchange', 'toolchange', 'levelchange', 'historychange', 'templatechange'] as const;

// One cached snapshot per editor, dropped on every editor event. `useSyncExternalStore` needs
// `getSnapshot` to return the same object until something actually changed.
const cache = new WeakMap<FloorplanEditor, EditorSnapshot>();

function snapshotOf(editor: FloorplanEditor): EditorSnapshot {
  let snapshot = cache.get(editor);
  if (!snapshot) {
    snapshot = {
      plan: editor.getPlan(),
      selection: editor.getSelection(),
      tool: editor.getTool(),
      levelId: editor.getActiveLevel().id,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
      markerTemplate: editor.getMarkerTemplate(),
    };
    cache.set(editor, snapshot);
  }
  return snapshot;
}

/** Subscribes to a `FloorplanEditor` and returns its current state (null while there is no editor). */
export function useEditorSnapshot(editor: FloorplanEditor | null): EditorSnapshot | null {
  // Stable per editor, so React doesn't resubscribe on every render.
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => undefined;
      const offs = EVENTS.map((type) =>
        editor.on(type, () => {
          cache.delete(editor);
          notify();
        }),
      );
      return () => offs.forEach((off) => off());
    },
    [editor],
  );
  return useSyncExternalStore(subscribe, () => (editor ? snapshotOf(editor) : null));
}
