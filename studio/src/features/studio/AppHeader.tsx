import { createPlan, createSamplePlan, parsePlanJSON } from '@vespenelabs/floorview';
import { ChevronDown, Download, FilePlus2, FolderOpen, Moon, Sparkles, Sun } from 'lucide-react';
import { useId, useRef } from 'react';

import { useStudio } from './studio-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { navigate, useRoute, type Route } from '@/lib/route';
import { setTheme, useTheme } from '@/lib/theme';

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AppHeader() {
  const { editor, snapshot, announce } = useStudio();
  const theme = useTheme();
  const route = useRoute();
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const planName = snapshot?.plan.name ?? '';

  async function importFile(file: File) {
    try {
      editor?.setPlan(parsePlanJSON(await file.text()), { keepHistory: true });
      announce(`Imported ${file.name}`);
    } catch (err) {
      announce(`Import failed: ${(err as Error).message}`);
    }
  }

  function exportPlan() {
    if (!editor) return;
    const plan = editor.getPlan();
    const filename = `${plan.name.replace(/[^\w-]+/g, '_') || 'floorplan'}.json`;
    download(filename, JSON.stringify(plan, null, 2));
    announce(`Exported ${filename}`);
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-3 py-2.5 sm:px-4">
      <div className="flex items-center gap-2 font-semibold whitespace-nowrap">
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand text-white">
          <Sparkles className="size-4" />
        </span>
        Floorview <span className="font-normal text-muted-foreground max-sm:hidden">Studio</span>
      </div>

      <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 sm:max-w-80">
        <Label htmlFor={nameId} className="sr-only">
          Plan name
        </Label>
        <Input
          id={nameId}
          key={planName}
          defaultValue={planName}
          disabled={!editor}
          ref={(el) => {
            if (!el) return;
            const commit = () => editor?.setPlanName(el.value);
            el.addEventListener('change', commit);
            return () => el.removeEventListener('change', commit);
          }}
        />
      </div>

      <nav aria-label="Pages" className="flex items-center gap-1">
        {(
          [
            ['editor', 'Editor'],
            ['air-quality', 'Air quality'],
            ['import', 'AI import'],
          ] as [Route, string][]
        ).map(([target, label]) => (
          <Button
            key={target}
            variant={route === target ? 'secondary' : 'ghost'}
            aria-current={route === target ? 'page' : undefined}
            onClick={() => navigate(target)}
          >
            {label}
          </Button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={!editor} />}>
            File <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => editor?.setPlan(createPlan('New plan'), { keepHistory: true })}>
              <FilePlus2 /> New plan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.setPlan(createSamplePlan(), { keepHistory: true })}>
              <Sparkles /> Load sample
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInput.current?.click()}>
              <FolderOpen /> Import JSON…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportPlan}>
              <Download /> Export JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Import plan file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}
