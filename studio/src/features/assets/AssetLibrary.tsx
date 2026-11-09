import { findEntity, type Marker, type ModelAsset } from '@vespenelabs/floorview';
import { GAS_CATEGORY } from '@vespenelabs/floorview/gas';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStudio } from '@/features/studio/studio-context';
import { ASSETS } from '@/lib/assets';

import { assetTemplate, endAssetDrag, startAssetDrag } from './asset-drag';

const ALL = 'all';
const CATEGORIES = [ALL, ...new Set(ASSETS.map((a) => a.category ?? 'Other'))];
const CATEGORY_ITEMS = CATEGORIES.map((c) => ({ value: c, label: c === ALL ? 'All kits' : c }));

/**
 * Pick a 3D model to place: sets the editor's marker template and switches to the marker tool.
 * The editor previews the footprint under the cursor (Q/E rotate, Esc stops).
 */
export function AssetLibrary() {
  const { editor, snapshot, announce } = useStudio();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(GAS_CATEGORY);
  const searchId = useId();
  const categoryId = useId();
  const list = useRef<HTMLUListElement>(null);

  // The model of the selected marker (selected in the 2D editor or the 3D view).
  const selection = snapshot?.selection;
  const selectedModel =
    selection?.kind === 'marker' && snapshot ? (findEntity(snapshot.plan, selection) as Marker | undefined)?.model : undefined;
  const selectedAsset = selectedModel ? ASSETS.find((a) => a.id === selectedModel) : undefined;

  // Selecting a model switches to its kit (and clears a search that would hide it). Adjusted
  // while rendering, so the list never shows the old kit for a frame.
  const [shownSelection, setShownSelection] = useState<string | undefined>(undefined);
  if (selectedAsset?.id !== shownSelection) {
    setShownSelection(selectedAsset?.id);
    if (selectedAsset) {
      setCategory(selectedAsset.category ?? ALL);
      const words = query.trim().toLowerCase();
      if (words && !selectedAsset.name.toLowerCase().includes(words) && !selectedAsset.id.includes(words)) setQuery('');
    }
  }

  // …and scrolls its tile into view.
  useEffect(() => {
    if (!selectedAsset) return;
    const tile = list.current?.querySelector(`[data-asset-id="${CSS.escape(selectedAsset.id)}"]`);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tile?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }, [selectedAsset]);

  const placing = snapshot?.tool === 'marker' ? (snapshot.markerTemplate?.model ?? null) : null;
  const q = query.trim().toLowerCase();
  const items = ASSETS.filter(
    (a) => (category === ALL || a.category === category) && (!q || a.name.toLowerCase().includes(q) || a.id.includes(q)),
  );

  function stop() {
    editor?.setMarkerTemplate(null);
    editor?.setTool('select');
    announce('Stopped placing');
  }

  function place(asset: ModelAsset) {
    if (!editor) return;
    if (placing === asset.id) return stop();
    editor.setMarkerTemplate(assetTemplate(asset));
    editor.setTool('marker');
    announce(`Placing ${asset.name}: click the 2D plan to place it (or drag it onto the 3D view), Q / E to rotate, Esc to stop.`);
  }

  return (
    <Panel
      title="Assets"
      className="max-lg:h-112"
      actions={
        placing && (
          <Button variant="ghost" size="sm" onClick={stop}>
            <X data-icon="inline-start" /> Stop placing
          </Button>
        )
      }
    >
      <div className="grid gap-2 border-b p-2">
        <Label htmlFor={searchId} className="sr-only">
          Search assets
        </Label>
        <Input id={searchId} type="search" placeholder="Search models…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex items-center gap-2">
          <Label htmlFor={categoryId} className="text-xs text-muted-foreground">
            Kit
          </Label>
          <Select items={CATEGORY_ITEMS} value={category} onValueChange={(v) => v && setCategory(v)}>
            <SelectTrigger id={categoryId} size="sm" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ITEMS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
        </div>
      </div>
      <ul ref={list} aria-label="3D models" className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto p-2">
        {items.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              aria-pressed={placing === asset.id}
              aria-current={selectedAsset?.id === asset.id ? 'true' : undefined}
              data-asset-id={asset.id}
              disabled={!editor}
              title={`${asset.name} · ${asset.size.width} × ${asset.size.depth} × ${asset.size.height} m`}
              onClick={() => place(asset)}
              draggable={!!editor}
              onDragStart={(e) => startAssetDrag(e, asset)}
              onDragEnd={endAssetDrag}
              className="grid w-full justify-items-center gap-1 rounded-md border border-transparent p-1 text-center text-[11px] leading-tight text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-pressed:border-brand aria-pressed:bg-brand/10 aria-pressed:text-foreground aria-[current=true]:border-brand/70 aria-[current=true]:text-foreground"
            >
              <img
                draggable={false}
                src={asset.preview}
                alt=""
                loading="lazy"
                width={48}
                height={48}
                // Decolorized like the models in the viewer.
                className="size-12 rounded-md bg-muted object-contain p-0.5 grayscale"
              />
              <span className="line-clamp-2 break-all">{asset.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
