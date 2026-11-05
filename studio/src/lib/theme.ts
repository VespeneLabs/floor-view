import { useSyncExternalStore } from 'react';

/** The colour scheme of the app. */
export type Theme = 'light' | 'dark';

/** Must match the key read by the inline script in `index.html`, which applies it before first paint. */
export const THEME_STORAGE_KEY = 'vespenelabs.theme';

/** Used when nothing is stored or storage is blocked. Keep in sync with the script in `index.html`. */
export const DEFAULT_THEME: Theme = 'dark';

function parseTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The theme stored in this browser, else the default. */
function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Puts the `dark` class on `<html>` (tokens and the `dark:` variant key off it) and sets `color-scheme`. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

let current = readStoredTheme();
const listeners = new Set<() => void>();

function update(theme: Theme): void {
  current = theme;
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

/** Applies a theme and stores it for this browser (other tabs follow through the `storage` event). */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private window): the choice lasts until the page closes.
  }
  update(theme);
}

window.addEventListener('storage', (event) => {
  if (event.key !== THEME_STORAGE_KEY) return;
  update(parseTheme(event.newValue) ?? DEFAULT_THEME);
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current theme; re-renders when it changes. Change it with `setTheme`. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current);
}
