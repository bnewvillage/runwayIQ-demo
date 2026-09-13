import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Content width, persisted. Off by default.
 *
 * The default measure is a reading width, which is right for a laptop and
 * wasteful on an ultrawide: the page keeps its narrow column and answers
 * the extra pixels with empty margin, so everything is found by scrolling
 * instead of by looking. Wide view spends that margin on content.
 *
 * Not the default, because a wide measure on a normal display stretches
 * rows past the point where a name on the left and a number on the right
 * can be read as one line. Whoever has the screen for it opts in once.
 */
const WidthContext = createContext(null);
const KEY = 'runwayiq.wide';

function initial() {
  try { return localStorage.getItem(KEY) === 'wide'; } catch { /* private mode */ }
  return false;
}

export function WidthProvider({ children }) {
  const [wide, setWide] = useState(initial);

  useEffect(() => {
    try { localStorage.setItem(KEY, wide ? 'wide' : 'normal'); } catch { /* private mode */ }
  }, [wide]);

  const toggle = useCallback(() => setWide((w) => !w), []);
  const value = useMemo(() => ({ wide, toggle }), [wide, toggle]);

  return <WidthContext.Provider value={value}>{children}</WidthContext.Provider>;
}

export function useWidth() {
  const ctx = useContext(WidthContext);
  if (!ctx) throw new Error('useWidth must be used inside WidthProvider');
  return ctx;
}
