/**
 * Turns the two pipeline markers into a verdict about last night's run.
 *
 * A bare timestamp doesn't answer "did the nightly pull work?" -- it makes
 * the reader do date arithmetic to notice a missed run. This states the
 * conclusion instead.
 */

// The scheduled run fires at 02:00 UTC but GitHub's scheduler drifts:
// observed completions land around 03:04, and a busy morning can push that
// later. A legitimate run is therefore up to ~26h old just before its
// successor completes, so the threshold sits above that. A genuinely
// missed run passes 28h shortly after its window closes.
const STALE_HOURS = 28;

// load_supabase and build_demand_glance commit separately, ~31s apart on a
// healthy run. A gap measured in hours means the load committed and the
// glance rebuild rolled back -- Forecast Analytics is current, Demand
// Glance is serving yesterday. Rare, silent, and it leaves one page
// confidently wrong, which is the whole reason this is surfaced.
const SPLIT_HOURS = 6;

const HOUR = 3600 * 1000;

/**
 * @returns {{state: 'unknown'|'fresh'|'stale'|'partial', ageHours: number|null,
 *            coreLoad: string|null, demandGlance: string|null, detail: string}}
 */
export function assessFreshness(meta, now = Date.now()) {
  const coreLoad = meta?.core_load ?? null;
  const demandGlance = meta?.demand_glance ?? null;

  if (!coreLoad) {
    return {
      state: 'unknown', ageHours: null, coreLoad, demandGlance,
      detail: "Couldn't reach the freshness marker, so the age of this data is unverified.",
    };
  }

  const core = new Date(coreLoad).getTime();
  const ageHours = (now - core) / HOUR;

  if (demandGlance) {
    const splitHours = (core - new Date(demandGlance).getTime()) / HOUR;
    if (splitHours > SPLIT_HOURS) {
      return {
        state: 'partial', ageHours, coreLoad, demandGlance,
        detail: 'The ERP load succeeded but the Demand Glance rebuild did not. '
              + 'Forecast Analytics is current; Demand Glance is showing older figures.',
      };
    }
  }

  if (ageHours > STALE_HOURS) {
    return {
      state: 'stale', ageHours, coreLoad, demandGlance,
      detail: `No successful pull in ${Math.floor(ageHours)} hours — the nightly run looks like it was missed.`,
    };
  }

  return {
    state: 'fresh', ageHours, coreLoad, demandGlance,
    detail: 'Last nightly pull completed normally.',
  };
}

/** Compact relative age for the header: "4h ago", "2d ago". */
export function fmtAge(hours) {
  if (hours == null) return '—';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
