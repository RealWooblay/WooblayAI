/**
 * Theme / appearance — dark, light, system. Persisted to localStorage.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useState, useMemo, type ReactNode } from 'react';

const STORAGE_KEY = 'wooblay-appearance';

export type ThemeId = 'dark' | 'light' | 'system';

type ResolvedTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  resolved: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStored(): ThemeId {
  if (typeof window === 'undefined') return 'dark';
  const s = localStorage.getItem(STORAGE_KEY);
  if (s === 'light' || s === 'dark' || s === 'system') return s;
  return 'dark';
}

function resolveTheme(theme: ThemeId): ResolvedTheme {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  }
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const t = getStored();
    const r = resolveTheme(t);
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = r;
    return t;
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getStored()));

  useLayoutEffect(() => {
    const next = resolveTheme(theme);
    setResolved(next);
    document.documentElement.dataset.theme = next;
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const m = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      const next = m.matches ? 'light' : 'dark';
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    m.addEventListener('change', handler);
    return () => m.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useMemo(() => (t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, resolved }), [theme, setTheme, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function useThemeOptional() {
  return useContext(ThemeContext);
}
