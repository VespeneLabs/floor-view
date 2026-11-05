import { FloorplanEditor } from '@vespenelabs/floorview';
import { useEffect, useRef } from 'react';

import { Panel } from '@/components/Panel';
import { useStudio } from '@/features/studio/studio-context';

/** Mounts the library's `FloorplanEditor` and hands the instance to the studio context. */
export function EditorPanel() {
  const { initialPlan, setEditor } = useStudio();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const editor = new FloorplanEditor(container.current, { plan: initialPlan });
    setEditor(editor);
    return () => {
      setEditor(null);
      editor.dispose();
    };
  }, [initialPlan, setEditor]);

  return (
    <Panel title="Editor (2D)">
      <div
        ref={container}
        className="relative min-h-0 flex-1"
        role="application"
        aria-label="Floor plan editor. Click to focus; use V, W, R, M, H to switch tools."
      />
    </Panel>
  );
}
