import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Light/dark, persisted. Defaults to the OS preference rather than forcing
 * dark: someone opening this on a bright warehouse floor shouldn't have to
 * find a setting first.
 */
const ThemeContext = createContext(null);
const KEY = 'runwayiq.theme';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* private mode */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initial);

  // The attribute, not a class: the palette is swapped by redefining custom
  // properties under [data-theme="light"], so every token flips at once and
  // no component needs to know which theme is active.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
