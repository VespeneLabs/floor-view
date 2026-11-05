import { useEffect, useState, type ReactNode } from 'react';

import { loadStoredPlan, storePlan } from './plan-storage';
import { StudioContext, type ViewSettings } from './studio-context';
import { useEditorSnapshot } from './useEditorSnapshot';
import { createSamplePlan, type FloorplanEditor, type FloorplanViewer, type Underlay } from '@vespenelabs/floorview';

export function StudioProvider({ children }: { children: ReactNode }) {
  const [initialPlan] = useState(() => loadStoredPlan() ?? createSamplePlan());
  const [editor, setEditor] = useState<FloorplanEditor | null>(null);
  const [viewer, setViewer] = useState<FloorplanViewer | null>(null);
  const [view, setView] = useState<ViewSettings>({
    mode: '3d',
    allLevels: false,
    labels: true,
    occupancy: false,
    sensors: false,
  });
  const [message, setMessage] = useState('');
  const [underlay, setUnderlay] = useState<Underlay | null>(null);
  const [underlayVisible, setUnderlayVisible] = useState(true);
  const snapshot = useEditorSnapshot(editor);

  const plan = snapshot?.plan;
  useEffect(() => {
    if (plan) storePlan(plan);
  }, [plan]);

  const shownUnderlay = underlayVisible ? underlay : null;
  useEffect(() => {
    editor?.setUnderlay(shownUnderlay);
  }, [editor, shownUnderlay]);
  useEffect(() => {
    viewer?.setUnderlay(shownUnderlay);
  }, [viewer, shownUnderlay]);

  return (
    <StudioContext
      value={{
        initialPlan,
        editor,
        viewer,
        setEditor,
        setViewer,
        snapshot,
        view,
        updateView: (patch) => setView((v) => ({ ...v, ...patch })),
        underlay,
        setUnderlay,
        underlayVisible,
        setUnderlayVisible,
        message,
        announce: setMessage,
      }}
    >
      {children}
    </StudioContext>
  );
}
