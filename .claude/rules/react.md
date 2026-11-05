---
paths:
  - "studio/**"
---

# Floorview Studio: React

Adapted from gas-view's `react.md`. The router, server data and WebSocket sections are dropped because Studio has no server and no routes.

## React 19

- Use function components and hooks only.
- There is no React Compiler. Don't add `React.memo`, `useMemo` or `useCallback` by default. Use them only when a stable reference matters, such as the `subscribe` function given to `useSyncExternalStore` or an effect dependency, or when profiling shows a problem.
- Use `useId()` for ids linked by accessibility attributes (`htmlFor`, `aria-describedby`).
- Use `useTransition` for non-urgent heavy updates so pointer interaction in the editor and viewer stays responsive.
- Organize code by feature (`src/features/<area>`: `editor`, `viewer`, `inspector`, `studio`). Shared UI goes in `src/components`, shadcn/ui primitives in `src/components/ui`, and framework-free helpers in `src/lib`.
- Accessibility: every interactive element is reachable by keyboard and has an accessible name. Icon-only buttons get `aria-label` plus a tooltip. Status messages go through `announce()`, which feeds the `role="status"` region in the status bar.

## The library is the source of truth

- `FloorplanEditor` and `FloorplanViewer` (from `@vespenelabs/floorview`, aliased to `../src`) own the plan, selection, tool, level and history. Don't copy that state into React state. Read it through `useEditorSnapshot` (a `useSyncExternalStore` over editor events) via `useStudio().snapshot`.
- Change the plan only by calling editor methods (`editor.updateEntity`, `editor.setTool`, `editor.undo` …). The resulting `change` event flows back through the snapshot to the viewer and the UI. Never mutate `snapshot.plan`; it is a copy.
- Create library instances in a `useEffect` on a container ref, register them with `setEditor`/`setViewer`, and `dispose()` them in the cleanup. StrictMode mounts twice, so cleanup must be complete.
- Push settings into the viewer from effects keyed on the setting (`viewer.setMode(view.mode)`). Subscribe to library events in effects and return the unsubscribe function from `on()`.
- Form inputs that edit the plan commit on the native `change` event (blur/Enter, see `CommitInput`), not per keystroke, so each edit is a single undo step.

## State

- Use no state library. App-wide UI state (view settings, status message, instances) lives in `StudioProvider` / `useStudio()`. Small cross-cutting browser state with its own lifecycle, such as the theme, uses a module-level store with `useSyncExternalStore` (see `src/lib/theme.ts`).
- Persist only the plan (autosave) and UI preferences (theme) to `localStorage`, always inside `try/catch`, and validate stored plans with `parsePlanJSON` on load.
- Simulated live data (occupancy, sensors) is generated in `features/viewer/simulated-layers.ts`. Replace it with a real data source behind the same `RoomLayer`/`PointLayer` shapes.

## Dependencies

- Keep the dependency list minimal. Add a package only when the browser, React or existing code can't reasonably do the job, and say why in the PR or commit.
