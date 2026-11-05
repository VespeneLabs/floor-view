# Floorview Studio

`studio/` is the demo app: a React 19 single-page app that embeds the library's `FloorplanEditor` and `FloorplanViewer`, built with Tailwind CSS 4 and shadcn/ui (`base-nova` style, Base UI primitives).

```bash
npm run dev            # http://localhost:5173
npm run build:studio   # → dist-studio/
```

## Stack and dependencies

The dependency list is kept minimal on purpose:

| Package | Why |
| --- | --- |
| `react`, `react-dom`, `@vitejs/plugin-react` | UI |
| `tailwindcss`, `@tailwindcss/vite` | Styling (configured in CSS, no config file) |
| `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react` | What the generated shadcn/ui components import |
| `@anthropic-ai/sdk` | Calls Claude for the AI import assistant (server side only) |

Not installed: a state library (React context plus `useSyncExternalStore` is enough), a toast library (messages go to the status bar), the `shadcn` package (its few needed Tailwind variants are inlined) and `tw-animate-css` (popups don't animate).

## Structure

```
studio/
  index.html                  inline script applies the theme before first paint
  vite.config.ts              aliases (@ → studio/src, the package and its subpaths → ../src); mounts /api/architect
  components.json             shadcn CLI config
  src/
    main.tsx, App.tsx         entry and layout
    styles/index.css          Tailwind, tokens (light/dark), shadcn variants, --vl-* theme mapping
    lib/theme.ts              light/dark theme store (useTheme / setTheme)
    lib/route.ts              hash-based page routing (useRoute / navigate)
    components/Panel.tsx      titled card used by editor, viewer and inspector
    components/VespeneLabsMark.tsx  decolorized Vespene Labs logo pinned to the bottom of the right-hand panels (mask from assets/vespenelabs-logo-mask.png)
    components/ui/            shadcn/ui components (generated, adapted in place)
    features/
      studio/                 StudioProvider + useStudio, useEditorSnapshot, plan autosave, header, status bar
      editor/                 EditorPanel (mounts FloorplanEditor), EditorToolbar
      viewer/                 ViewerPanel (mounts FloorplanViewer), simulated data layers
      inspector/              properties of the selection or the active level
      air-quality/            air quality page: metrics, sensor simulation, legend and badges
      import/                 AI import wizard: upload, details, chat (useArchitect wraps the library's ArchitectController), preview
```

## Pages

Pages are chosen by URL hash (`src/lib/route.ts`, no router package). The editor page stays mounted while hidden, because the editor instance owns the plan and its undo history.

- **Editor** (`#/`): the 2D editor, a live 3D viewer with demo layers, and the property inspector.
- **Air quality** (`#/air-quality`, `features/air-quality/`): monitoring for the current plan, with one simulated sensor per room.
  - **Metrics:** CO₂, temperature, humidity and PM2.5. Each has color stops and labelled bands (Good/Moderate/Poor, or Cold/Comfortable/Warm…) in `metrics.ts`.
  - **Map:** a heatmap layer plus neutral room floors with value tooltips, and sensor spheres whose tooltips show all four metrics.
  - **Controls:** a time-of-day slider with day playback. The sidebar has a legend, a good/moderate/poor summary and the rooms sorted worst-first.
  - **Data:** `simulation.ts` models an office day (people drive CO₂, humidity and temperature; the kitchen spikes PM2.5 at lunch; the server room runs hot). It is deterministic, so scrubbing the timeline is reproducible. Replace it with real sensor data behind the same shapes.

### AI import (`#/import`, `features/import/`)

Turns a scanned drawing, blueprint or sketch into a first plan with a Claude agent that acts as a floor plan specialist and senior industrial architect.

1. **Upload:** PNG/JPG/WebP (export PDFs as an image). `prepareScan` (library) fits the image within the model's vision limits (2576 px long edge, 3.75 MP), so the agent's pixel coordinates map 1:1 to the image we keep.
2. **About the facility:** building type, floors, one known measurement and what to include, so the agent asks fewer questions.
3. **Assistant:** a chat with a live preview (2D/3D, adjustable scan opacity). The agent asks multiple-choice questions when something essential is unclear (`ask_user`) and drafts complete plans (`propose_floor_plan`, in image pixels plus a scale). Each draft is validated and converted in the browser (`convertProposal`); problems go back to the agent as error results. Valid drafts are previewed, and the agent receives an image of its plan drawn over the scan so it can check alignment itself. **Use this plan** loads the draft into the editor (undoable) with the scan as a toggleable underlay for tracing corrections.

**Library.** The assistant lives in the library ([AI architect](architect.md)): `@vespenelabs/floorview/architect` (controller, transport, scan prep, conversion) and `@vespenelabs/floorview/architect/server` (agent definition, `runArchitectTurn`, middleware, Anthropic and mock models). Studio's `useArchitect` hook binds the controller to React, and a Vite plugin in `studio/vite.config.ts` mounts `createArchitectMiddleware` at `POST /api/architect` on the dev and preview servers. The API key never reaches the browser. The browser runs the tool loop and keeps the conversation append-only (assistant turns are stored exactly as returned).

API settings: adaptive thinking with summarized display (shown as a status line), effort `high`, streaming with eager tool-input streaming (the plan input is validated client-side), automatic prompt caching (the scan is resent every turn), and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), which re-runs a request declined by a safety classifier on Anthropic's recommended fallback model.

**Credentials.** Copy `studio/.env.example` to `studio/.env.local` (git-ignored) and set `ANTHROPIC_API_KEY`, or set it in the environment, or log in with `ant auth login`, then run `npm run dev`. Without credentials, `npm run dev:mock` serves a scripted assistant: it asks questions and proposes a generic factory, but it doesn't read the drawing. Useful for demos and UI work.

**Production note.** A static build (`build:studio`) has no `/api/architect`. Host `createArchitectMiddleware()` or `runArchitectTurn()` behind your own auth and rate limits, because every request spends API credit.

## How it uses the library

- The **editor owns the plan**. `useEditorSnapshot` subscribes to editor events with `useSyncExternalStore` and exposes `{ plan, selection, tool, levelId, canUndo, canRedo }`. UI actions call editor methods, and the resulting events re-render the UI.
- The **viewer follows the snapshot**: effects call `viewer.setPlan`, `setLevel`, `setMode`, `setShowLabels`, `setLayer` and `setBackground` (on theme change). A viewer click selects the entity in the editor.
- The **theme** reaches the library through CSS variables. `.vl-studio .vl-editor` maps `--vl-*` to app tokens, so the editor and viewer switch between light and dark with the rest of the UI.
- The plan is autosaved to `localStorage` (`vespenelabs.plan`) and validated with `parsePlanJSON` on load. File → Import/Export reads and writes plan JSON.

Coding conventions for Studio are in `.claude/rules/react.md` and `.claude/rules/styling.md`.
