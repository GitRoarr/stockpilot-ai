import { useSyncExternalStore } from 'react';

// Light (default) / dark / system theme. The preference is stored per browser; index.html applies it before first paint.
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'sp-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

export function getPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export const resolved = (p: ThemePref = getPref()): 'light' | 'dark' => (p === 'system' ? (media().matches ? 'dark' : 'light') : p);

function apply() {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.classList.toggle('dark', resolved() === 'dark');
  // Re-enable transitions after the new colours have been painted.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  listeners.forEach((l) => l());
}

export function setPref(p: ThemePref) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable: the choice still applies for this page view */
  }
  apply();
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  media().addEventListener('change', () => getPref() === 'system' && apply());
  window.addEventListener('storage', (e) => e.key === KEY && apply());
}

/** Current preference and the theme actually shown; re-renders when either changes. */
export function useTheme(): { pref: ThemePref; theme: 'light' | 'dark'; setPref: (p: ThemePref) => void } {
  wire();
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${getPref()}:${resolved()}`,
  );
  const [pref, theme] = snap.split(':') as [ThemePref, 'light' | 'dark'];
  return { pref, theme, setPref };
}
