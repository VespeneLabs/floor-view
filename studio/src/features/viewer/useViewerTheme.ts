import type { FloorplanViewer } from '@vespenelabs/floorview';
import { useEffect } from 'react';

import { useTheme } from '@/lib/theme';

/** Read a CSS custom property from `<html>` (e.g. `--canvas`), resolved for the current theme. */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * The scene background is WebGL, not CSS: copy the `--canvas` token into the viewer whenever
 * the theme changes. Returns the theme so callers can derive other theme-dependent colors.
 */
export function useViewerTheme(viewer: FloorplanViewer | null) {
  const theme = useTheme();
  useEffect(() => {
    const canvas = cssToken('--canvas');
    if (viewer && canvas) viewer.setBackground(canvas);
  }, [viewer, theme]);
  return theme;
}
