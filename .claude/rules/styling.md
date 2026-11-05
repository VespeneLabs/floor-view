---
paths:
  - "studio/**/*.tsx"
  - "studio/**/*.css"
  - "src/styles.css"
---

# Styling: Tailwind CSS 4 and shadcn/ui

Adapted from gas-view's `styling.md`.

- Tailwind 4 is configured CSS-first in `studio/src/styles/index.css`. Design tokens go in `:root` / `.dark` and are exposed to utilities through `@theme inline`. There is no `tailwind.config.js`.
- In custom CSS, read tokens as CSS variables (`var(--border)`). The `theme()` function is deprecated.
- Use shadcn/ui components (style `base-nova`, built on Base UI) from `src/components/ui` as the base, and adapt them in place rather than wrapping them in another layer. Add new ones with the shadcn CLI (`npx shadcn@4.23.0 add <name>`; see CLAUDE.md for how to run it in this repo). Base UI composes with the `render` prop (`<TooltipTrigger render={<Button />} />`), not Radix's `asChild`.
- The `shadcn` npm package is deliberately not installed. The `data-*` custom variants the components need are inlined at the top of `index.css`, and `tw-animate-css` is not installed, so `animate-in`/`fade-*` classes are no-ops and popups appear without animation.
- Reuse repeated UI patterns by extracting a React component, not with `@apply` classes. Use `@apply` only for base styles.
- Merge conditional classes with `cn()` from the `cn` package (`import { cn } from 'cn'`; the generated components import it the same way). Don't concatenate class strings.
- Use arbitrary values (`w-[123px]`) only for true one-offs. When a value repeats, add a token.
- Themes are light and dark. The `dark` class on `<html>` is set by `src/lib/theme.ts` (header toggle, stored per browser, default dark via `DEFAULT_THEME`) and, before first paint, by the inline script in `studio/index.html`. The entry CSS declares `@custom-variant dark (&:where(.dark, .dark *));`. Code that needs the theme in JS reads `useTheme()`; for example, the viewer copies `--canvas` into WebGL with `viewer.setBackground`. Use semantic tokens (`bg-background`, `text-muted-foreground`, `text-brand` …) rather than raw palette colors, so both themes keep working.
- The library's editor and viewer are styled by `src/styles.css` through `--vl-*` custom properties. Studio maps them to app tokens in the unlayered `.vl-studio .vl-editor, .vl-studio .vl-viewer` block of `index.css`. Theme the library there, never by editing library colors for the app's sake. Library CSS must stay framework-free (no Tailwind).
- Layouts are desktop-first but must work down to 360 px wide without horizontal scrolling. Panels stack below `lg:` and the toolbar wraps.
- Interactive elements need visible `hover:`, `focus-visible:` and `disabled:` states. The shadcn components provide these, so keep them when adapting.
- Never rely on color alone (for example occupancy colors). Pair color with a label or tooltip text.
