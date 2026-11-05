import { useSyncExternalStore } from 'react';

/** Studio pages, addressed by URL hash (`#/air-quality`) so they can be linked without a router. */
export type Route = 'editor' | 'air-quality' | 'import';

const ROUTES: Record<string, Route> = { '#/air-quality': 'air-quality', '#/import': 'import' };

function current(): Route {
  return ROUTES[window.location.hash] ?? 'editor';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(route: Route): void {
  window.location.hash = route === 'editor' ? '' : `#/${route}`;
}
