// Pure trend math for sales charts -- a trailing moving average smooths
// noisy weekly sales into a readable direction, and a forward projection
// continues that smoothed line's recent slope. Deliberately NOT the same
// math as shared/forecast.py's WMA velocity model: that's a specific
// horizon-tiered forecast used for purchasing decisions, this is just
// "smooth what's already on screen" for a chart -- similar-sounding but
// different purposes, kept clearly separate rather than risking the two
// silently drifting apart while looking like the same concept.

const DEFAULT_WINDOW = 4;

/** Trailing moving average, same length as the input -- early points use
 * whatever window is actually available (1, 2, 3... up to `window`)
 * rather than being cut off, so the trend line still starts at week 0. */
export function movingAverage(series, window = DEFAULT_WINDOW) {
  return series.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

/** Continues the trend line's recent slope (average week-over-week
 * change over the last `window` points) forward `weeksAhead` weeks from
 * the last smoothed point. Clamped at 0 -- sales can't go negative.
 * Returns null when there's nothing to project from. */
export function projectTrend(trendSeries, weeksAhead, window = DEFAULT_WINDOW) {
  const n = trendSeries.length;
  if (n === 0 || weeksAhead <= 0) return null;
  const last = trendSeries[n - 1];
  if (n < 2) return { value: Math.max(0, last), weeksAhead };
  const start = Math.max(0, n - 1 - window);
  const slope = (last - trendSeries[start]) / (n - 1 - start);
  return { value: Math.max(0, last + slope * weeksAhead), weeksAhead };
}
