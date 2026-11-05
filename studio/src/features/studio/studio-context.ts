import { createContext, useContext } from 'react';

import type { EditorSnapshot } from './useEditorSnapshot';
import type { FloorPlan, FloorplanEditor, FloorplanViewer, Underlay, ViewMode } from '@vespenelabs/floorview';

export interface ViewSettings {
  mode: ViewMode;
  /** Show every level stacked (3D) instead of only the level being edited. */
  allLevels: boolean;
  labels: boolean;
  occupancy: boolean;
  sensors: boolean;
}

export interface StudioValue {
  /** The plan the editor and viewer start from (stored plan or the sample). */
  initialPlan: FloorPlan;
  editor: FloorplanEditor | null;
  viewer: FloorplanViewer | null;
  setEditor: (editor: FloorplanEditor | null) => void;
  setViewer: (viewer: FloorplanViewer | null) => void;
  /** Editor state, re-read after every editor event; null until the editor mounts. */
  snapshot: EditorSnapshot | null;
  view: ViewSettings;
  updateView: (patch: Partial<ViewSettings>) => void;
  /** Reference drawing shown under the plan in the editor and viewer (e.g. an imported scan). */
  underlay: Underlay | null;
  setUnderlay: (underlay: Underlay | null) => void;
  underlayVisible: boolean;
  setUnderlayVisible: (visible: boolean) => void;
  /** Latest status message, announced to screen readers by the status bar. */
  message: string;
  announce: (message: string) => void;
}

export const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside <StudioProvider>');
  return value;
}
