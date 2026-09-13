import { useEffect, useMemo, useState } from 'react';
import { getSalesCube, getStockHealthSummary, getStockHealthTiers } from '../../lib/api.js';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { useMeta } from '../../app/MetaProvider.jsx';
import { useWidth } from '../../app/WidthProvider.jsx';
import { COUNTRIES, CURRENCIES } from '../../lib/constants.js';
import SalesTrendChart from '../../components/SalesTrendChart.jsx';
import BaLeaderboard from './BaLeaderboard.jsx';
import BaVersus from './BaVersus.jsx';
import BaStockMix from './BaStockMix.jsx';
import BaSplits from './BaSplits.jsx';
import {
  CHANNELS, LEADERBOARD_COLUMNS, MAX_PICKED, benchmark, brandSeries,
  joinBrands, ledgerCostShare, moneyWindows, monthLabels, population, scopeCells,
  sortLeaderboard, usablePeriod,
  windowMonths, withGrowth, withShares,
} from './brandData.js';

// Brand Analytics -- the join of Sales Analytics and Stock Analysis, one
// row per brand, up to four of them side by side.
//
// Both payloads arrive whole and stay in memory: the cube is ~2,500 cells
// and the stock summary ~190 rows, so every filter and every comparison
// here is an array pass, not a round trip. Same design as Sales Analytics,
// and for the same reason -- anything that reaches for the network on a
// tick-box change has misunderstood it.
//
// Every figure's provenance is settled in brandData.js. This file decides
// nothing about the numbers; it holds state and arranges components.

const EMPTY_CELLS = [];
const EMPTY_SUMMARY = [];
const PERIODS = [
  { size: 3, label: '3 months' },
  { size: 6, label: '6 months' },
  { size: 0, label: 'All' },
];
const POPULATIONS = [
  { key: 'material', label: 'Material' },
  { key: 'stocked', label: 'Stocked' },
  { key: 'all', label: 'All' },
];

export default function BrandAnalyticsPage() {
  // Same key Sales Analytics uses -- whichever page loads first pays for
  // the cube, and moving between them costs nothing.
  const { data: cube, error: cubeErr, loading: cubeLoading } = useAsyncData(
    () => getSalesCube(), [], { cacheKey: 'sales-cube' },
  );
  const { data: stock, error: stockErr, loading: stockLoading } = useAsyncData(
    () => getStockHealthSummary(), [], { cacheKey: 'stock-health-summary' },
  );
  const { meta } = useMeta();
  const { wide } = useWidth();

  const [picked, setPicked] = useState([]);
  const [popKind, setPopKind] = useState('material');
  const [countries, setCountries] = useState([]);
  const [channels, setChannels] = useState([]);
  const [periodSize, setPeriodSize] = useState(0);
  const [currency, setCurrency] = useState('AED');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'stockValue', dir: 'desc' });
  const [showBenchmark, setShowBenchmark] = useState(true);
  const [measure, setMeasure] = useState('revenue');
  const [hover, setHover] = useState(null);

  // A subscription, not state derived from render -- the same shape Sales
  // Analytics uses, which is what keeps the no-setState-in-effect rule
  // satisfied while still reacting to a resize.
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 2100px)');
    const sync = () => setRoomy(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const denseLayout = wide && roomy;

  // ---- derived. Order matters: nothing below may be referenced above. ----
  const cells = cube?.cells || EMPTY_CELLS;
  const summary = stock?.brands || EMPTY_SUMMARY;

  // The tier vocabulary, from the one place that owns it --
  // HEALTH_TIERS in shared/stock_health.py. This page used to keep
  // its own copy of the labels and it went stale the first time a
  // tier was added.
  const { data: tierDoc } = useAsyncData(() => getStockHealthTiers(), [],
    { cacheKey: 'stock-health-tiers' });
  const tiers = tierDoc?.tiers;

  const period = useMemo(() => usablePeriod(cells), [cells]);
  const months = useMemo(
    () => windowMonths(period.months, periodSize), [period, periodSize],
  );
  const filters = useMemo(
    () => ({ countries, channels, months }), [countries, channels, months],
  );
  const growthFilters = useMemo(
    () => ({ countries, channels }), [countries, channels],
  );

  const joined = useMemo(
    () => withGrowth(joinBrands(cells, summary, filters), cells, period.months, growthFilters),
    [cells, summary, filters, period, growthFilters],
  );

  // Shares are computed AFTER the population filter, never before. Run the
  // other way round they are shares of all 196 brands while the total row
  // beside them sums only the ones in view -- measured at 96.5% against a
  // footer claiming 100%, which is exactly the disagreement this page
  // exists to prevent.
  // Null unless the scope spans markets whose priced feeds start on
  // different dates -- silent where it cannot mislead.
  const windows = useMemo(
    () => moneyWindows(cells, months, { countries }),
    [cells, months, countries],
  );
  // Over the cells the page is actually showing, so the share follows
  // the country/channel/period filters like every other money figure.
  const ledgerShare = useMemo(
    () => ledgerCostShare(scopeCells(cells, filters)),
    [cells, filters],
  );
  const pop = useMemo(
    () => withShares(population(joined, popKind)), [joined, popKind],
  );
  const bench = useMemo(() => benchmark(pop), [pop]);

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? pop.filter((r) => r.brand.toLowerCase().includes(q)) : pop;
    const sorted = sortLeaderboard(base, sort);
    // Ticked brands sit at the top, so changing the sort or the search
    // never means hunting for what you are comparing.
    if (!picked.length) return sorted;
    const on = sorted.filter((r) => picked.includes(r.brand));
    return [...on, ...sorted.filter((r) => !picked.includes(r.brand))];
  }, [pop, search, sort, picked]);

  // Prefer the population row so a picked brand carries the same shares the
  // table shows; fall back to the full set for a brand the population
  // filter has since excluded.
  const pickedRows = useMemo(
    () => picked
      .map((b) => pop.find((r) => r.brand === b) || joined.find((r) => r.brand === b))
      .filter(Boolean),
    [picked, pop, joined],
  );

  const revSeries = useMemo(
    () => brandSeries(cells, picked, months, 'revenue', filters),
    [cells, picked, months, filters],
  );
  const unitSeries = useMemo(
    () => brandSeries(cells, picked, months, 'units', filters),
    [cells, picked, months, filters],
  );
  const labels = useMemo(() => monthLabels(months), [months]);

  const stockAsOf = meta?.stock_health
    ? new Date(meta.stock_health).toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  // ---- handlers ----
  const togglePick = (brand) => setPicked((cur) => (
    cur.includes(brand)
      ? cur.filter((b) => b !== brand)
      : (cur.length >= MAX_PICKED ? cur : [...cur, brand])
  ));
  const toggleIn = (setter) => (value) => setter((cur) => (
    cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  ));
  const onSort = (key) => setSort((cur) => (
    cur.key === key
      ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'brand' ? 'asc' : 'desc' }
  ));

  const error = cubeErr || stockErr;
  if (error) return <div className="page-error">Error loading brands: {error}</div>;
  if (cubeLoading || stockLoading || !cube || !stock) {
    return <div className="page-loading">Loading brands…</div>;
  }

  const hasPicked = pickedRows.length > 0;

  return (
    <div className="container">
      <div className="page-eyebrow">Analytics</div>
      <div className="page-head">
        <h1>Brand Analytics</h1>
        <p className="page-sub">
          One brand in full, or up to {MAX_PICKED} against each other and against
          the portfolio. Sales and stock, joined.
        </p>
      </div>

      {/* The windows are DERIVED, never named here. Three dates written
          into this paragraph were three dates to remember to change --
          and one of them was already wrong: KSA's declared cutover is 21
          days later than its priced data actually starts. A market that
          opens next year appears in this line on its own. */}
      <div className="note-inline ba-provenance">
        <b>Money is the priced ERP feed.</b> Revenue and cost both begin
        where that feed does, which differs by market, so a figure spanning
        several markets covers a different span in each.
        {windows && (
          <> Here: {windows.map((w, i) => (
            <span key={w.country}>
              {i > 0 ? (i === windows.length - 1 ? ' and ' : ', ') : ' '}
              <b>{COUNTRIES.find((c) => c.key === w.country)?.label || w.country} {w.months}mo</b>
            </span>
          ))}.</>
        )}
        {ledgerShare != null && (
          <> Cost is the stock ledger's own figure on{' '}
            <b>{(ledgerShare * 100).toFixed(0)}%</b> of it, imputed at each
            item&rsquo;s current rate elsewhere.</>
        )}
        {period.stub && ' The first month of the feed holds four days and is excluded.'}
        {period.partial && ' The month in progress is excluded, so every comparison is between complete months.'}
        {' '}Stock is a current position, not a series.
      </div>

      {/* The app's filter bar, not a bespoke one: .filtergroup rows of
          .btn-toggle, exactly as SalesFilterBar builds it. The --brand
          modifier exists only so the wide rules below can target this bar
          without reshaping every other filter bar in the app -- the same
          reason .filterbar--sales exists. */}
      <div className="filterbar filterbar--brand">
        <div className="filtergroup">
          <span className="filtergroup-label">Brands shown</span>
          <div className="filtergroup-row">
            {POPULATIONS.map((p) => (
              <button key={p.key} type="button"
                      className={'btn-toggle' + (popKind === p.key ? ' active' : '')}
                      onClick={() => setPopKind(p.key)}>
                {p.label} {population(joined, p.key).length}
              </button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Market</span>
          <div className="filtergroup-row">
            {COUNTRIES.map((c) => (
              <button key={c.key} type="button"
                      className={'btn-toggle' + (countries.includes(c.key) ? ' active' : '')}
                      onClick={() => toggleIn(setCountries)(c.key)}>
                <span className={'dot dot-' + c.dot} />{c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Channel &mdash; sales only</span>
          <div className="filtergroup-row">
            {CHANNELS.map((c) => (
              <button key={c} type="button"
                      className={'btn-toggle' + (channels.includes(c) ? ' active' : '')}
                      onClick={() => toggleIn(setChannels)(c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Period</span>
          <div className="filtergroup-row">
            {PERIODS.map((p) => (
              <button key={p.size} type="button"
                      className={'btn-toggle' + (periodSize === p.size ? ' active' : '')}
                      onClick={() => setPeriodSize(p.size)}>
                {p.size === 0 ? `All ${period.months.length}mo` : p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Benchmark</span>
          <div className="filtergroup-row">
            <button type="button"
                    className={'btn-toggle' + (showBenchmark ? ' active' : '')}
                    onClick={() => setShowBenchmark((v) => !v)}>
              Portfolio median
            </button>
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Currency</span>
          <div className="filtergroup-row">
            <select className="input" value={currency} aria-label="Currency"
                    onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="filterbar-end">
          {hasPicked && (
            <button type="button" className="btn-toggle"
                    onClick={() => setPicked([])}>
              Clear {pickedRows.length}
            </button>
          )}
        </div>
      </div>

      <div className={'ba-grid' + (hasPicked ? '' : ' ba-grid--board')}>
        {hasPicked && (
          <div className="ba-cols">
            <BaVersus rows={pickedRows} bench={bench} currency={currency}
                      showBenchmark={showBenchmark} />
          </div>
        )}

        {hasPicked && (
          <div className="ba-trend">
            <SalesTrendChart
              series={measure === 'revenue' ? revSeries.series : unitSeries.series}
              keys={revSeries.keys}
              labels={labels}
              title={measure === 'revenue' ? 'Revenue by month' : 'Units by month'}
              mode={measure === 'revenue' ? 'value' : 'units'}
              currency={currency}
              alt={{
                series: measure === 'revenue' ? unitSeries.series : revSeries.series,
                mode: measure === 'revenue' ? 'units' : 'value',
              }}
              hover={hover}
              onHover={setHover}
              fill={denseLayout}
              emptyMessage="No priced sales for these brands in the selected period."
            />
            <div className="ba-trend-controls">
              <button type="button"
                      className={'btn-toggle btn-toggle--mini' + (measure === 'revenue' ? ' active' : '')}
                      onClick={() => setMeasure('revenue')}>Revenue</button>
              <button type="button"
                      className={'btn-toggle btn-toggle--mini' + (measure === 'units' ? ' active' : '')}
                      onClick={() => setMeasure('units')}>Units</button>
              <span className="small">
                {period.months.length} complete months. Year on year needs 13 and is
                not offered.
              </span>
            </div>
          </div>
        )}

        {hasPicked && (
          <div className="ba-stockmix">
            <BaStockMix rows={pickedRows} countries={countries} tiers={tiers}
                        currency={currency} asOf={stockAsOf} />
          </div>
        )}

        {hasPicked && (
          <div className="ba-splits-cell">
            <BaSplits rows={pickedRows} cells={cells} months={months}
                      filters={filters} currency={currency} />
          </div>
        )}

        <div className="ba-board">
          <BaLeaderboard
            rows={listed}
            columns={LEADERBOARD_COLUMNS}
            sort={sort}
            onSort={onSort}
            picked={picked}
            onToggle={togglePick}
            search={search}
            onSearch={setSearch}
            bench={bench}
            currency={currency}
            maxPicked={MAX_PICKED}
            collapsed={hasPicked}
          />
        </div>
      </div>
    </div>
  );
}
