import { useState } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { AssetLibrary } from '@/features/assets/AssetLibrary';
import { EditorPanel } from '@/features/editor/EditorPanel';
import { EditorToolbar } from '@/features/editor/EditorToolbar';
import { Inspector } from '@/features/inspector/Inspector';
import { AppHeader } from '@/features/studio/AppHeader';
import { StatusBar } from '@/features/studio/StatusBar';
import { StudioProvider } from '@/features/studio/StudioProvider';
import { ViewerPanel } from '@/features/viewer/ViewerPanel';
import { AirQualityView } from '@/features/air-quality/AirQualityView';
import { ImportPage } from '@/features/import/ImportPage';
import { useRoute } from '@/lib/route';

export function App() {
  const route = useRoute();
  // Keep the import wizard (and its conversation) alive once opened, while the user checks the editor.
  const [importOpened, setImportOpened] = useState(false);
  if (route === 'import' && !importOpened) setImportOpened(true);
  return (
    <StudioProvider>
      <TooltipProvider>
        {/* `vl-studio` scopes the theme mapping for the library's editor/viewer (styles/index.css). */}
        <div className="vl-studio grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-muted/40">
          <AppHeader />
          {/* The editor stays mounted (hidden) on other pages: it owns the plan and its undo history. */}
          <div hidden={route !== 'editor'} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <EditorToolbar />
            <main className="grid gap-2 overflow-y-auto p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_17rem] lg:overflow-hidden">
              <EditorPanel />
              <ViewerPanel />
              <div className="grid min-h-0 gap-2 lg:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]">
                <AssetLibrary />
                <Inspector />
              </div>
            </main>
          </div>
          {route === 'air-quality' && <AirQualityView />}
          {importOpened && (
            <div hidden={route !== 'import'} className="grid min-h-0">
              <ImportPage />
            </div>
          )}
          <StatusBar />
        </div>
      </TooltipProvider>
    </StudioProvider>
  );
}
