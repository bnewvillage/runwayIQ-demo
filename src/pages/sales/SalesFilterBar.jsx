import { COUNTRIES } from '../../lib/constants.js';
import { CHANNELS, EMPTY, periodLabel } from './salesData.js';

/**
 * The filter bar for both sales pages.
 *
 * Shared rather than written twice: the two pages had drifted into
 * different control layouts for the same job, and every addition made
 * the gap wider. One component means a new filter appears identically on
 * both, and the grouping stays consistent as more get added.
 *
 * Groups carry quiet labels because an undivided row of twenty chips
 * gives a reader no way to tell a market from a period from a view mode.
 */
export default function SalesFilterBar({
  filter, onChange, months,
  extraGroups,          // [{ label, node }] -- page-specific controls
  endSlot,              // trailing actions
  leadSlot,             // the page title, placed by the bar's own grid
}) {
  const set = (patch) => onChange({ ...filter, ...patch });
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const active = filter.countries.length + filter.channels.length
    + filter.brands.length + (filter.months.length ? 1 : 0) + (filter.drill ? 1 : 0);

  // The --sales modifier is what the wide layout targets. Without it the
  // wide rules reshape EVERY filter bar in the app into this page's
  // two-column grid with its own named areas, which other pages neither
  // have nor want.
  return (
    <div className="filterbar filterbar--sales">
      {leadSlot}
      <div className="filtergroup fg-market">
        <span className="filtergroup-label">Market</span>
        <div className="filtergroup-row">
          {COUNTRIES.map((c) => (
            <button key={c.key}
                    className={'btn-toggle' + (filter.countries.includes(c.key) ? ' active' : '')}
                    onClick={() => set({ countries: toggleIn(filter.countries, c.key) })}>
              <span className={'dot dot-' + c.dot} />{c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filtergroup fg-channel">
        <span className="filtergroup-label">Channel</span>
        <div className="filtergroup-row">
          {CHANNELS.map((ch) => (
            <button key={ch}
                    className={'btn-toggle' + (filter.channels.includes(ch) ? ' active' : '')}
                    onClick={() => set({ channels: toggleIn(filter.channels, ch) })}>{ch}</button>
          ))}
        </div>
      </div>

      <div className="filtergroup fg-period">
        <span className="filtergroup-label">Period</span>
        <div className="filtergroup-row">
          {/* A period button is on when the selection IS that window --
              compared against the same slice the click would produce, so
              the two can't disagree. Longer windows than the data covers
              are disabled with the reason stated: a greyed-out button
              with no explanation reads as broken rather than as empty. */}
          {[3, 6, 12, 24].map((n) => {
            const window = months.slice(-n);
            const on = filter.months.length === window.length
              && filter.months.length > 0
              && filter.months[0] === window[0];
            return (
              <button key={n} className={'btn-toggle' + (on ? ' active' : '')}
                      disabled={n > months.length}
                      title={n > months.length
                        ? `Only ${months.length} months of history available`
                        : undefined}
                      onClick={() => set({ months: window })}>{n}mo</button>
            );
          })}
          <button className={'btn-toggle' + (filter.months.length ? '' : ' active')}
                  onClick={() => set({ months: [] })}>All</button>
          <select className="input" value={filter.months[0] || ''} aria-label="From month"
                  onChange={(e) => {
                    const from = e.target.value;
                    const to = filter.months[filter.months.length - 1] || months[months.length - 1];
                    set({ months: months.filter((x) => x >= from && x <= to) });
                  }}>
            <option value="">From</option>
            {months.map((x) => <option key={x} value={x}>{x.slice(0, 7)}</option>)}
          </select>
          <select className="input" value={filter.months[filter.months.length - 1] || ''} aria-label="To month"
                  onChange={(e) => {
                    const to = e.target.value;
                    const from = filter.months[0] || months[0];
                    set({ months: months.filter((x) => x >= from && x <= to) });
                  }}>
            <option value="">To</option>
            {months.map((x) => <option key={x} value={x}>{x.slice(0, 7)}</option>)}
          </select>
        </div>
      </div>

      {(extraGroups || []).map((g) => (
        <div className={'filtergroup fg-' + g.label.toLowerCase()} key={g.label}>
          <span className="filtergroup-label">{g.label}</span>
          <div className="filtergroup-row">{g.node}</div>
        </div>
      ))}

      {/* A month drilled into from a chart is a filter like any other, so
          it is dismissible from the bar rather than only by finding the
          point that set it. */}
      {filter.drill && (
        <div className="filtergroup fg-drill">
          <span className="filtergroup-label">Drilled to</span>
          <div className="filtergroup-row">
            <button className="btn-toggle active" onClick={() => set({ drill: null })}>
              {periodLabel([filter.drill])} ✕
            </button>
          </div>
        </div>
      )}

      <div className="filterbar-end">
        {active > 0 && (
          <button className="btn-toggle"
                  onClick={() => onChange(EMPTY)}>
            Clear {active}
          </button>
        )}
        {endSlot}
      </div>
    </div>
  );
}
