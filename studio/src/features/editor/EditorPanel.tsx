import { FloorplanEditor } from '@vespenelabs/floorview';
import { useEffect, useRef } from 'react';

import { Panel } from '@/components/Panel';
import { useStudio } from '@/features/studio/studio-context';
import { assetTemplate, draggedAsset, endAssetDrag } from '@/features/assets/asset-drag';
import { ASSETS } from '@/lib/assets';

/** Mounts the library's `FloorplanEditor` and hands the instance to the studio context. */
export function EditorPanel() {
  const { initialPlan, editor, setEditor, announce } = useStudio();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const editor = new FloorplanEditor(container.current, { plan: initialPlan, assets: ASSETS });
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
        aria-label="Floor plan editor. Click to focus; use V, W, R, M, H to switch tools and Q, E to rotate."
        onDragOver={(e) => {
          if (!draggedAsset(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          const asset = draggedAsset(e);
          const at = asset && editor?.clientToPlan(e.clientX, e.clientY, { snap: true });
          endAssetDrag();
          if (!asset || !at || !editor) return;
          e.preventDefault();
          if (editor.addMarker(at.levelId, assetTemplate(asset), at.position)) announce(`Added ${asset.name}`);
        }}
      />
    </Panel>
  );
}
