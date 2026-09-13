import { useEffect, useMemo, useState } from 'react';
import {
  getBrands, getForecastHorizons, getOpenDraft, startForecastDraft,
  setForecastOverride, commitForecastSnapshot, discardForecastDraft,
} from '../../lib/api.js';
import { fmtCurrency, fmtNum, fmtDateTimeLocal } from '../../lib/format.js';
import { CURRENCIES, COUNTRIES, ALLOWED_CHANNEL_WEIGHTS, DEFAULT_CHANNEL_WEIGHTS } from '../../lib/constants.js';
import { matchQuery } from '../../lib/searchMatch.js';
import { measureCodeColWidth } from '../../lib/tableWidth.js';
import { movingAverage, projectTrend } from '../../lib/trend.js';
import CopyButton from '../../components/CopyButton.jsx';
import SalesTrendChart from '../../components/SalesTrendChart.jsx';
import { downloadCsv } from '../../lib/download.js';
import { BLOCKS, VALUE_COLS, CHANNEL_ABBR, normalizeForecastRow, sortVal, forecastCsv, withOverrides } from './forecastData.js';
import { useBrandForecast } from './useBrandForecast.js';
import { useFittedBlocks, COL_W } from './useFittedBlocks.js';

// Series definitions for the two sales charts. Same shape as COUNTRIES
// (key/label/dot) so SalesChart doesn't care which cut it's drawing.
const COUNTRY_SERIES = COUNTRIES;
const CHANNEL_SERIES = [
  { key: 'Showroom', label: 'Showroom', dot: 'showroom' },
  { key: 'Distribution', label: 'Distribution', dot: 'distribution' },
  { key: 'Ecommerce', label: 'Ecommerce', dot: 'ecommerce' },
];

export default function ForecastAnalyticsPage() {
  const [brands, setBrands] = useState([]);
  const [horizons, setHorizons] = useState([]);
  // No brand pre-selected -- loading whatever happens to be first
  // alphabetically implies it's worth looking at, which it isn't.
  const [brand, setBrand] = useState('');
  const [months, setMonths] = useState(3);
  const [currency, setCurrency] = useState('EUR');
  const [signed, setSigned] = useState(false);
  const [channelWeights, setChannelWeights] = useState(DEFAULT_CHANNEL_WEIGHTS);
  // Value block off by default -- it's derived from columns already on
  // screen, and this table is wide enough without it.
  const [dataBlocks, setDataBlocks] = useState(() => new Set(['stock', 'sales', 'velocity', 'demand']));
  // Off by default and deliberately so: 89.6% of (item, country) pairs
  // sell through exactly one channel, so for nine rows in ten this adds a
  // line that restates the number above it. It earns its place only when
  // you're asking what's driving a figure, which is occasional.
  const [showChannels, setShowChannels] = useState(false);
  const [sort, setSort] = useState({ block: 'meta', key: 'item_code', dir: 'asc' });
  const [searchCode, setSearchCode] = useState('');
  const [searchName, setSearchName] = useState('');
  const [respectFilters, setRespectFilters] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartMode, setChartMode] = useState('value');
  // 'raw' = actual weekly sales, no projection -- sales are just sales.
  // 'trend' = a moving-average smoothing of the same weeks, with a
  // forward extension continuing its recent slope. Deliberately a
  // toggle between two views of the SAME chart slot, not four charts at
  // once -- see the trend.js module docstring for why this is a
  // different (and separate) computation from the Velocity column's
  // forecast model, even though both are "where is this headed."
  const [chartView, setChartView] = useState('raw');

  // ---- forecast review (draft) state ----
  // draftId non-null == a review is open for this brand, which is what
  // makes forecast cells editable. `overrides` is {item_code: {UAE, QAT,
  // KSA}} held locally so the ladder recomputes on keystroke-commit
  // without waiting on the server; the write is fire-and-forget behind it.
  const [draftId, setDraftId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState(null);

  // Restore any open draft when the brand changes -- an in-progress review
  // has to survive a reload or a day away, or it isn't a draft, it's a
  // scratch pad that loses your work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDraftId(null);
      setOverrides({});
      setDraftError(null);
      if (!brand) return;
      try {
        const { draft } = await getOpenDraft(brand);
        if (cancelled || !draft) return;
        const map = {};
        draft.lines.forEach((l) => {
          if (l.manager_forecast == null) return;
          map[l.item_code] = { ...(map[l.item_code] || {}), [l.country]: Number(l.manager_forecast) };
        });
        setDraftId(draft.id);
        setOverrides(map);
      } catch (err) {
        if (!cancelled) setDraftError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [brand]);

  async function startReview() {
    setDraftBusy(true);
    setDraftError(null);
    try {
      const { snapshot_id } = await startForecastDraft({
        brand, months, signed,
        showroom: channelWeights.Showroom,
        distribution: channelWeights.Distribution,
        ecommerce: channelWeights.Ecommerce,
      });
      setDraftId(snapshot_id);
      // Editing a block you can't see is not a feature.
      setDataBlocks((prev) => new Set([...prev, 'forecast']));
    } catch (err) {
      setDraftError(err.message);
    } finally {
      setDraftBusy(false);
    }
  }

  async function applyOverride(row, country, value) {
    const prev = overrides[row.item_code] || {};
    const next = { ...prev };
    if (value == null) delete next[country];
    else next[country] = value;
    setOverrides((o) => {
      const copy = { ...o };
      if (Object.keys(next).length) copy[row.item_code] = next;
      else delete copy[row.item_code];
      return copy;
    });
    try {
      await setForecastOverride(draftId, {
        item_code: row.item_code,
        item_name: row.item_name || '',
        country,
        manager_forecast: value,
        // The model's own number, sent so the server can freeze what the
        // model said at the moment this judgement was made -- that's what
        // later flags the override as stale when the model moves.
        model_forecast: rawRows.find((r) => r.item_code === row.item_code)?.forecast?.[country] ?? 0,
        stock: row.stock[country] || 0,
        valuation_rate: row.valuation_rate || 0,
      });
    } catch (err) {
      setDraftError(err.message);
    }
  }

  async function commitReview() {
    setDraftBusy(true);
    setDraftError(null);
    try {
      await commitForecastSnapshot(draftId);
      // Back to pure model output: the snapshot is history now, and
      // leaving overrides on screen would mean future visits silently
      // showing numbers frozen from a past decision.
      setDraftId(null);
      setOverrides({});
    } catch (err) {
      setDraftError(err.message);
    } finally {
      setDraftBusy(false);
    }
  }

  async function discardReview() {
    setDraftBusy(true);
    try {
      await discardForecastDraft(draftId);
      setDraftId(null);
      setOverrides({});
    } catch (err) {
      setDraftError(err.message);
    } finally {
      setDraftBusy(false);
    }
  }

  const overrideCount = useMemo(
    () => Object.values(overrides).reduce((s, o) => s + Object.keys(o).length, 0),
    [overrides],
  );
  const [loadError, setLoadError] = useState(null);

  // The brand list and the valid horizons. Both are server-owned: the
  // horizons in particular are curated (2-6, then 10/12/18 -- the gap is
  // deliberate, see HORIZONS in shared/forecast.py) and must not be
  // hardcoded here. Without this the brand select renders empty and no
  // horizon buttons appear at all.
  useEffect(() => {
    Promise.all([getBrands(), getForecastHorizons()])
      .then(([b, h]) => {
        setBrands(b.brands);
        setHorizons(h.horizons);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const { rows: rawRows, inactiveOmitted, loading, error: fetchError, meta, isFetching, refresh }
    = useBrandForecast({ brand, months, signed, channelWeights });
  const error = loadError || fetchError;

  // Any modifier off its neutral 1x means the numbers on screen are a
  // what-if, not the brand's actual forecast -- surfaced as an outline so
  // it can't be mistaken for the default view after the fact.
  const modifiersChanged = Object.values(channelWeights).some((v) => v !== 1);


  // Overrides are applied here, before search/sort/export/readout, so
  // every downstream consumer sees the adjusted ladder -- sorting by net
  // order while the table shows overridden values but sorts on model
  // values would be its own quiet bug.
  const rows = useMemo(
    () => rawRows.map((r) => withOverrides(normalizeForecastRow(r), overrides[r.item_code], signed)),
    [rawRows, overrides, signed],
  );

  // Two independent queries AND'd together, same as the old Wide
  // Comparison page: a term meant for the code can't accidentally match
  // the name. Each side supports ,,and //or --exclude on its own.
  const matchesQuery = (r) =>
    matchQuery(r.item_code, searchCode) && matchQuery(r.item_name || '', searchName);

  // Inactive SKUs never reach the browser: forecast_brand drops them (see
  // _is_inactive) and reports how many, so `rows` is already the active
  // universe and there is nothing left to filter client-side.

  const visibleRows = useMemo(() => {
    let v = rows.filter(matchesQuery);
    const dir = sort.dir === 'asc' ? 1 : -1;
    v = [...v].sort((a, b) => {
      const x = sortVal(a, sort.block, sort.key), y = sortVal(b, sort.block, sort.key);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return dir * c;
    });
    return v;
  }, [rows, searchCode, searchName, sort]);

  const codeW = useMemo(
    () => measureCodeColWidth(visibleRows.map((r) => r.item_code)),
    [visibleRows]
  );

  const totals = useMemo(() => {
    const scoped = respectFilters ? rows.filter(matchesQuery) : rows;
    const stockUnits = scoped.reduce((s, r) => s + r.stock.global, 0);
    const stockValue = scoped.reduce((s, r) => s + r.stockVal, 0);
    const salesUnits = scoped.reduce((s, r) => s + r.sales.global, 0);
    const salesValue = scoped.reduce((s, r) => s + r.salesVal, 0);
    const salesCost = scoped.reduce((s, r) => s + r.sales.global * r.valuation_rate, 0);
    const netUnits = scoped.reduce((s, r) => s + r.demand.global, 0);
    const netValue = scoped.reduce((s, r) => s + r.netVal, 0);
    const margin = salesValue - salesCost;
    return { count: scoped.length, stockUnits, stockValue, salesUnits, salesValue, margin,
      marginPct: salesValue > 0 ? margin / salesValue : 0, netUnits, netValue };
  }, [rows, respectFilters, searchCode, searchName]);

  // Raw sales, period -- no projection here. See trendSeries below for
  // the smoothed/forward-looking view; keeping the two apart is the
  // whole point (sales are just sales; the trend is a separate,
  // explicitly-labeled read on them).
  const chartSeries = useMemo(() => {
    if (!showChart) return null;
    const codes = new Set((respectFilters ? visibleRows : rows).map((r) => r.item_code));
    const scoped = rawRows.filter((r) => codes.has(r.item_code));
    const byCountry = { UAE: [], QAT: [], KSA: [] };
    const byChannel = { Showroom: [], Distribution: [], Ecommerce: [] };
    const add = (target, key, weekly, rate) => {
      // sales_value would be more accurate than units*cost for revenue,
      // but weekly_sales is unit-only (see shared/forecast.py) -- units
      // is exact, this "value" mode is a cost-basis approximation.
      const values = chartMode === 'qty' ? weekly : weekly.map((u) => u * rate);
      values.forEach((v, i) => { target[key][i] = (target[key][i] || 0) + v; });
    };
    scoped.forEach((r) => {
      COUNTRIES.forEach(({ key }) => add(byCountry, key, r.weekly_sales?.[key] || [], r.valuation_rate));
      // Same weeks cut a second way. Absent on older API responses, so
      // this stays optional rather than assuming the field exists.
      Object.keys(byChannel).forEach((ch) => add(byChannel, ch, r.weekly_sales_by_channel?.[ch] || [], r.valuation_rate));
    });
    return { byCountry, byChannel };
  }, [showChart, chartMode, rawRows, respectFilters, visibleRows, rows]);

  // Smoothed trend + forward extension, computed purely from the same
  // raw weekly arrays above (lib/trend.js) -- NOT the Velocity column's
  // horizon-tiered WMA/Holt model, and deliberately so: that model only
  // ever exists per country (see VelocityCell/normalizeForecastRow), so
  // a channel trend line would have been impossible to draw honestly
  // from it. A moving average has no such restriction -- it works on
  // whatever series it's given, country or channel alike.
  const trendSeries = useMemo(() => {
    if (!chartSeries) return null;
    const weeksAhead = Math.round(months * (52 / 12));
    const smoothAndProject = (raw) => {
      const smoothed = {};
      const projected = {};
      Object.entries(raw).forEach(([key, vals]) => {
        const trend = movingAverage(vals);
        smoothed[key] = trend;
        const p = projectTrend(trend, weeksAhead);
        if (p) projected[key] = p;
      });
      return { smoothed, projected };
    };
    const country = smoothAndProject(chartSeries.byCountry);
    const channel = smoothAndProject(chartSeries.byChannel);
    return {
      byCountry: country.smoothed, projectedByCountry: country.projected,
      byChannel: channel.smoothed, projectedByChannel: channel.projected,
    };
  }, [chartSeries, months]);

  function toggleSort(block, key) {
    setSort((s) => (s.block === block && s.key === key
      ? { block, key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { block, key, dir: block === 'meta' ? 'asc' : 'desc' }));
  }
  const arrowFor = (block, key) => (sort.block === block && sort.key === key ? (sort.dir === 'desc' ? '▼' : '▲') : '');
  function toggleBlock(key) {
    setDataBlocks((cur) => {
      const next = new Set(cur);
      if (next.has(key)) { if (next.size > 1) next.delete(key); } else next.add(key);
      return next;
    });
  }

  // Blocks the user asked for, minus whatever the viewport can't fit.
  // Dropping a whole group is better than clipping one: a half-visible
  // column of numbers is worse than an absent one, because you can't tell
  // which country it belongs to. `dataBlocks` stays the user's intent --
  // widening the window brings groups back without re-toggling anything.
  const { wrapRef, blocks: visibleBlocks, dropped, fittedWidth, nameW } = useFittedBlocks(dataBlocks, codeW);

  function exportCsv() {
    downloadCsv(`${brand.replace(/\s+/g, '_')}_forecast_${months}mo.csv`, forecastCsv(visibleRows, signed));
  }

  if (error && !brands.length) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="page--wide">
      <div className="container page-head">
        <p className="page-eyebrow">Forecast analytics</p>
        <div className="hero-row">
          <div className="hero-metric">
            <p className="hero-figure accent">{brand ? fmtCurrency(totals.netValue, currency) : '—'}</p>
            <p className="hero-label">
              {brand ? `net order for ${brand} over ${months} months` : 'Select a brand to begin'}
            </p>
          </div>
          {brand && (
            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat-num">{fmtNum(totals.netUnits)}</span>
                <span className="hero-stat-label">units</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-num">{fmtNum(totals.count)}</span>
                <span className="hero-stat-label">active skus</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-num">{fmtCurrency(totals.stockValue, currency)}</span>
                <span className="hero-stat-label">stock on hand</span>
              </div>
            </div>
          )}
        </div>
        <div className="small-screen-note">
          <span>
            The comparison matrix needs a wider screen to be read honestly. Search, totals and
            per-SKU figures work here; open Runway IQ on a laptop for the full side-by-side view.
          </span>
        </div>
      </div>

      <div className="container toolbar">
        <div className="field">
          <span className="field-label">Item code</span>
          <input type="text" value={searchCode} onChange={(e) => setSearchCode(e.target.value)} placeholder="Code — ,,and //or --exclude" />
        </div>
        <div className="field">
          <span className="field-label">Item name</span>
          <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Name — ,,and //or --exclude" />
        </div>
        <div className="field">
          <span className="field-label">Brand</span>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Select a brand&hellip;</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Horizon</span>
          <div className="btn-group">
            {horizons.map((m) => (
              <div key={m} className={'btn-toggle' + (months === m ? ' active' : '')} onClick={() => setMonths(m)}>
                {isFetching(m) ? <span className="spinner" aria-label="Loading" /> : `${m}mo`}
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="container toolbar-row2">
        <div className="field" style={{ gap: 8 }}>
          <span className={'field-label' + (modifiersChanged ? ' changed' : '')}>
            Demand modifier{modifiersChanged ? ' · modified' : ''}
          </span>
          <div className="modifier-set">
            {Object.keys(ALLOWED_CHANNEL_WEIGHTS).map((channel) => (
              <div key={channel} className={'modifier-group' + (channelWeights[channel] !== 1 ? ' changed' : '')}>
                <span className="modifier-name">{channel}</span>
                <div className="modifier-vals">
                  {ALLOWED_CHANNEL_WEIGHTS[channel].map((v) => (
                    <div
                      key={v}
                      className={'mod-btn' + (channelWeights[channel] === v ? ' active' : '')}
                      onClick={() => setChannelWeights((cur) => ({ ...cur, [channel]: v }))}
                    >{v}&times;</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Data</span>
          <div className="data-chips">
            {/* Sits with the block toggles because it is one: it reveals
                a sub-line inside Sales and Velocity rather than a column
                group. Stock is absent from it deliberately -- stock is
                held per country, not per channel. */}
            <button
              className={'btn-toggle' + (showChannels ? ' active' : '')}
              onClick={() => setShowChannels((v) => !v)}
              title="Show the channel mix behind each country's sales and velocity"
            >
              Channels
            </button>
            {BLOCKS.map((b) => {
              const on = dataBlocks.has(b.key);
              const squeezed = on && dropped.includes(b.label);
              return (
                <div
                  key={b.key}
                  className={'btn-toggle' + (on ? ' active' : '') + (squeezed ? ' squeezed' : '')}
                  title={squeezed ? 'Hidden — not enough page width. Widen the window or turn off another group.' : undefined}
                  onClick={() => toggleBlock(b.key)}
                >
                  {b.label.split(' ')[0]}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={'readout' + (respectFilters ? ' scoped' : '')}>
        <div className="cell"><p className="cell-label">{brand} · SKUs</p><p className="cell-value">{fmtNum(totals.count)}</p></div>
        <div className="cell"><p className="cell-label">Stock on hand · units</p><p className="cell-value">{fmtNum(totals.stockUnits)}</p></div>
        <div className="cell"><p className="cell-label">Stock value · {currency} (cost)</p><p className="cell-value">{fmtCurrency(totals.stockValue, currency)}</p></div>
        <div className="cell"><p className="cell-label">Sales {months}mo · units</p><p className="cell-value">{fmtNum(totals.salesUnits)}</p></div>
        <div className="cell"><p className="cell-label">Sales value · {currency} (price)</p><p className="cell-value">{fmtCurrency(totals.salesValue, currency)}</p></div>
        <div className="cell"><p className="cell-label">Margin · {currency}</p><p className="cell-value">{fmtCurrency(totals.margin, currency)}<span className="cell-sub">{Math.round(totals.marginPct * 100)}%</span></p></div>
        <div className="cell"><p className="cell-label">Net order · units</p><p className="cell-value">{fmtNum(totals.netUnits)}</p></div>
        <div className="cell"><p className="cell-label">Net value · {currency} (cost)</p><p className="cell-value accent">{fmtCurrency(totals.netValue, currency)}</p></div>
      </div>
      <div className={'container readout-note' + (respectFilters ? ' filtered' : '')}>
        {respectFilters ? 'Cards and chart reflect the current search filter' : 'Cards and chart are brand-wide totals (search filters only the table below)'}
      </div>

      <div className="container chart-bar">
        <div className={'btn-icon' + (respectFilters ? ' active' : '')} onClick={() => setRespectFilters((v) => !v)} title="Make the cards and chart reflect the current search instead of brand-wide totals">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h10l-4 4.5V12l-2-1V7.5z" /></svg>
          Respect filters
        </div>
        <div className={'btn-icon' + (signed ? ' active' : '')} onClick={() => setSigned((v) => !v)} title="Let net order go negative when regions are overstocked">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h8" /></svg>
          Show negatives
        </div>
        <div className={'btn-icon' + (showChart ? ' active' : '')} onClick={() => setShowChart((v) => !v)} title="Toggle the sales-over-time chart">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12V2M2 12h10M4.5 9l2.5-3 2 1.5L12 4.5" /></svg>
          {showChart ? 'Hide sales chart' : 'Show sales chart'}
        </div>
        {showChart && (
          <div className="btn-group">
            <div className={'btn-toggle' + (chartMode === 'value' ? ' active' : '')} onClick={() => setChartMode('value')}>{currency}</div>
            <div className={'btn-toggle' + (chartMode === 'qty' ? ' active' : '')} onClick={() => setChartMode('qty')}>Qty</div>
          </div>
        )}
        {showChart && (
          <div className="btn-group" title="Raw: actual weekly sales, no projection. Trend: a smoothed moving average with a forward extension.">
            <div className={'btn-toggle' + (chartView === 'raw' ? ' active' : '')} onClick={() => setChartView('raw')}>Raw</div>
            <div className={'btn-toggle' + (chartView === 'trend' ? ' active' : '')} onClick={() => setChartView('trend')}>Trend</div>
          </div>
        )}
        {brand && !draftId && (
          <div className={'btn-icon' + (draftBusy ? '' : '')} onClick={draftBusy ? undefined : startReview}
               title="Snapshot this brand's forecast so it can be scored against what actually sells, and start overriding it">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11.5L11 2.5M8.5 2.5H11.5V5.5M2.5 5v6.5H9" /></svg>
            {draftBusy ? 'Starting…' : 'Start forecast review'}
          </div>
        )}
        {brand && draftId && (
          <div className="review-bar">
            <span className="review-tag">Review open</span>
            <span className="review-count">{fmtNum(overrideCount)} override{overrideCount === 1 ? '' : 's'}</span>
            <button className="btn-toggle active" disabled={draftBusy} onClick={commitReview}
                    title="Lock these numbers and start the horizon clock — a committed snapshot can't be edited">
              {draftBusy ? 'Committing…' : 'Commit snapshot'}
            </button>
            <button className="btn-toggle" disabled={draftBusy} onClick={discardReview} title="Throw away this draft and its overrides">
              Discard
            </button>
          </div>
        )}
        {draftError && <span className="review-error">{draftError}</span>}
        {brand && inactiveOmitted > 0 && (
          // Stated rather than toggleable: these SKUs have no stock, no
          // sale in 18 months and no model signal, so there's no decision
          // to make about them -- but the count still has to be visible,
          // or a short list looks like missing data.
          <span className="omitted-note" title="No stock anywhere, nothing sold in 18 months, and no velocity signal">
            {fmtNum(inactiveOmitted)} inactive SKUs not shown
          </span>
        )}
        <span className="freshness" style={{ marginLeft: 'auto' }}>
          {meta === null
            ? null
            : fmtDateTimeLocal(meta.core_load)
              ? <>Data as of {fmtDateTimeLocal(meta.core_load)}</>
              : <span className="freshness-unknown">Freshness unverified</span>}
          <button className="link-btn" onClick={refresh} title="Discard locally cached forecasts and refetch">
            Refresh data
          </button>
        </span>
        {brand && (
          <button className="export-btn" onClick={exportCsv}>
            Export CSV ({fmtNum(visibleRows.length)})
          </button>
        )}
      </div>
      {showChart && chartSeries && (
        // Two cuts of the same weeks side by side where there's room:
        // "which market" and "which channel" are the two questions asked
        // of this data, and answering them in one glance beats toggling.
        // Collapses to one column under 1200px (see .chart-grid). Raw vs
        // Trend swaps the CONTENT of these same two slots rather than
        // adding a second row -- four charts at once was more than
        // needed for "what happened" vs "which way is it going."
        <div className="container chart-grid">
          {chartView === 'raw' ? (
            <>
              <SalesTrendChart series={chartSeries.byCountry} keys={COUNTRY_SERIES} title="By country" mode={chartMode} currency={currency} />
              <SalesTrendChart series={chartSeries.byChannel} keys={CHANNEL_SERIES} title="By channel" mode={chartMode} currency={currency} />
            </>
          ) : (
            <>
              <SalesTrendChart series={trendSeries.byCountry} keys={COUNTRY_SERIES} title="By country (trend)" mode={chartMode} currency={currency} projected={trendSeries.projectedByCountry} emptyMessage="No sales in this window to compute a trend from." />
              <SalesTrendChart series={trendSeries.byChannel} keys={CHANNEL_SERIES} title="By channel (trend)" mode={chartMode} currency={currency} projected={trendSeries.projectedByChannel} emptyMessage="No sales in this window to compute a trend from." />
            </>
          )}
        </div>
      )}

      {/* Always mounted (even with nothing to show yet) so the
          ResizeObserver has a stable container to measure from the
          first render, not just after a brand loads. */}
      <div
        className="container fa-table-wrap tablewrap"
        ref={wrapRef}
        // --fa-fitted feeds .fa-table-wrap's own --measure (see styles.css):
        // the wrapper grows to fit the table's real width and stays
        // centered via the ordinary .container rule, rather than a
        // max-width:none escape hatch that had nothing to center against.
        style={fittedWidth ? { '--fa-fitted': `${fittedWidth}px` } : undefined}
      >
        {!brand && <div className="page-loading">Select a brand to run a forecast.</div>}
        {brand && loading && <div className="page-loading">Loading forecast&hellip;</div>}
        {brand && error && <div className="page-error">{error}</div>}
        {brand && !loading && !error && (
          <ForecastTable
            rows={visibleRows} visibleBlocks={visibleBlocks} sort={sort} onSort={toggleSort} fittedWidth={fittedWidth} nameW={nameW}
            arrowFor={arrowFor} currency={currency} codeW={codeW}
            draftId={draftId} overrides={overrides} onOverride={applyOverride}
            showChannels={showChannels}
          />
        )}
      </div>
    </div>
  );
}

function ForecastTable({ rows, visibleBlocks, sort, onSort, arrowFor, currency, codeW, fittedWidth, nameW,
                         draftId, overrides, onOverride, showChannels }) {
  return (
    <>
      <table
        className="fa-table"
        // An exact width, not a ceiling. With table-layout:fixed, a
        // max-width smaller than the wrapper lets the browser shrink
        // the table and proportionally squish every column to fit --
        // silently misaligning them, not scrolling. An explicit width
        // keeps every <col> at its real size always; if that's wider
        // than the wrapper has room for, the wrapper's own
        // overflow-x:auto (see .tablewrap) produces a real horizontal
        // scrollbar instead -- the correct fallback when even Value
        // plus Demand doesn't fit a narrow viewport.
        style={fittedWidth ? { width: fittedWidth } : undefined}
      >
        <colgroup>
          <col style={{ width: codeW }} /><col style={{ width: nameW }} />
          {visibleBlocks.map((b) => {
            if (b.key === 'value') return VALUE_COLS.map((v) => <col key={v.key} style={{ width: COL_W.value }} />);
            if (b.key === 'velocity') {
              return [...COUNTRIES.map((c) => <col key={c.key} style={{ width: COL_W.velocity }} />), <col key="global" style={{ width: COL_W.velocity }} />];
            }
            return [...COUNTRIES.map((c) => <col key={c.key} style={{ width: COL_W.unit }} />), <col key="global" style={{ width: COL_W.unit }} />];
          })}
        </colgroup>
        <thead>
          <tr className="group-row">
            <th /><th />
            {visibleBlocks.map((b) => {
              if (b.key === 'value') return <th key={b.key} className="blk-start" colSpan={VALUE_COLS.length}>Value ({currency})</th>;
              const span = COUNTRIES.length + 1;
              return <th key={b.key} className="blk-start" colSpan={span}>{b.label}</th>;
            })}
          </tr>
          <tr className="sub-row">
            <th className={'col-code sortable' + (sort.block === 'meta' && sort.key === 'item_code' ? ' active' : '')} onClick={() => onSort('meta', 'item_code')}>
              Code<span className="sort-arrow">{arrowFor('meta', 'item_code')}</span>
            </th>
            <th className={'col-name sortable' + (sort.block === 'meta' && sort.key === 'item_name' ? ' active' : '')} onClick={() => onSort('meta', 'item_name')}>
              Item<span className="sort-arrow">{arrowFor('meta', 'item_name')}</span>
            </th>
            {visibleBlocks.map((b) => {
              if (b.key === 'value') {
                return VALUE_COLS.map((v, i) => (
                  <th key={v.key} className={(i === 0 ? 'blk-start ' : '') + 'value-col sortable' + (sort.block === 'value' && sort.key === v.key ? ' active' : '')} onClick={() => onSort('value', v.key)}>
                    {v.label}<span className="sort-arrow">{arrowFor('value', v.key)}</span>
                  </th>
                ));
              }
              const cols = COUNTRIES.map((c, i) => (
                <th key={c.key} className={(i === 0 ? 'blk-start ' : '') + 'sortable' + (sort.block === b.key && sort.key === c.key ? ' active' : '')} onClick={() => onSort(b.key, c.key)}>
                  <span className={'dot dot-' + c.dot} />{c.label}<span className="sort-arrow">{arrowFor(b.key, c.key)}</span>
                </th>
              ));
              return [...cols, (
                <th key="global" className={'global-col sortable' + (sort.block === b.key && sort.key === 'global' ? ' active' : '')} onClick={() => onSort(b.key, 'global')}>
                  <span className="dot dot-global" />Global<span className="sort-arrow">{arrowFor(b.key, 'global')}</span>
                </th>
              )];
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={20} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 24 }}>No SKUs match.</td></tr>}
          {rows.map((r) => (
            <ForecastRow
              key={r.item_code} row={r} visibleBlocks={visibleBlocks} currency={currency}
              draftId={draftId} overrides={overrides[r.item_code]} onOverride={onOverride}
              showChannels={showChannels}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function ForecastRow({ row, visibleBlocks, currency, draftId, overrides, onOverride, showChannels }) {
  return (
    <tr className="item-row">
      <td className="col-code"><span className="code-cell">{row.item_code}<CopyButton text={row.item_code} title="Copy item code" /></span></td>
      {/* Full name, clipped by CSS ellipsis (not a fixed character
          count) -- the whole point of nameW flexing with available
          width is for wider columns to show MORE of the name, which a
          pre-sliced string can't do regardless of how much room the
          column ends up with. */}
      <td className="col-name" title={row.item_name}>{row.item_name}</td>
      {visibleBlocks.map((b) => {
        if (b.key === 'value') {
          return VALUE_COLS.map((v, i) => <td key={v.key} className={(i === 0 ? 'blk-start ' : '') + 'value-col'}>{fmtCurrency(row[v.key], currency)}</td>);
        }
        if (b.key === 'velocity') {
          const cells = COUNTRIES.map((c, i) => (
            <td key={c.key} className={i === 0 ? 'blk-start' : ''}>
              <VelocityCell v={row.velocity[c.key]} />
              {showChannels && <ChannelMix mix={row.velocityByChannel?.[c.key]} decimals />}
            </td>
          ));
          return [...cells, <td key="global" className="global-col"><VelocityCell v={row.velocity.global} /></td>];
        }
        if (b.key === 'forecast') {
          // The one editable block -- units expected to SELL, which is
          // the only rung of the ladder that's a pure claim about the
          // market (see CONTEXT.md). Read-only until a review is open,
          // because an edit with nowhere to be recorded is a lie.
          const cells = COUNTRIES.map((c, i) => (
            <td key={c.key} className={i === 0 ? 'blk-start' : ''}>
              <ForecastCell
                value={row.forecast?.[c.key]}
                overridden={overrides?.[c.key] != null}
                editable={!!draftId}
                onCommit={(v) => onOverride(row, c.key, v)}
              />
            </td>
          ));
          return [...cells, <td key="global" className="global-col"><UnitCell v={row.forecast?.global ?? 0} /></td>];
        }
        if (b.key === 'demand') {
          // Demand is the one block where sign carries meaning: + is what
          // needs ordering, - is surplus. Stock and sales are plain counts.
          const cells = COUNTRIES.map((c, i) => {
            const v = row.demand[c.key];
            return <td key={c.key} className={i === 0 ? 'blk-start' : ''}>{v == null ? <span className="no-data">&mdash;</span> : <UnitCell v={v} showSign />}</td>;
          });
          return [...cells, <td key="global" className="global-col"><UnitCell v={row.demand.global} /></td>];
        }
        // Stock deliberately gets no channel mix: stock is held per
        // COUNTRY, not per channel -- there is no ecommerce warehouse --
        // so a channel split of it would be inventing a fact.
        const cells = COUNTRIES.map((c, i) => (
          <td key={c.key} className={i === 0 ? 'blk-start' : ''}>
            <UnitCell v={row[b.key][c.key]} />
            {showChannels && b.key === 'sales' && <ChannelMix mix={row.salesByChannel?.[c.key]} />}
          </td>
        ));
        return [...cells, <td key="global" className="global-col"><UnitCell v={row[b.key].global} /></td>];
      })}
    </tr>
  );
}

/** The channel mix behind one country's number, shown under it rather
 * than as extra columns. Nine more columns would be unreadable and would
 * push whole blocks off the viewport (useFittedBlocks drops what doesn't
 * fit), for a value that is single-channel on nine rows in ten. A
 * sub-line costs no width and only grows row height when switched on.
 *
 * Renders nothing when a country has one channel or none: the number
 * above already says it, and repeating it is the noise this toggle exists
 * to keep out of the default view. */
function ChannelMix({ mix, decimals = false }) {
  if (!mix) return null;
  const entries = Object.entries(mix);
  if (entries.length < 2) return null;
  return (
    <span className="chan-mix">
      {entries.map(([ch, v]) => (
        <span key={ch} className="chan-mix-part">
          {/* Velocity is units per WEEK and routinely below 1, so it needs
              decimals -- rounding it to an integer rendered every slow
              channel as a flat "0", which is worse than showing nothing.
              Sales are whole units and stay integers. */}
          <span className="chan-mix-tag">{CHANNEL_ABBR[ch] || ch}</span>
          {decimals ? v.toFixed(2) : fmtNum(v)}
        </span>
      ))}
    </span>
  );
}

/** One forecast figure, editable while a review is open.
 *
 * Local draft state while focused, committed on blur or Enter, abandoned
 * on Escape -- persisting every keystroke would fire a write per digit
 * and make "3" a real, recorded claim on the way to typing "30". Clearing
 * the box removes the override entirely rather than setting zero: zero is
 * a genuine forecast ("this stops selling"), absence is not. */
function ForecastCell({ value, overridden, editable, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  if (!editable) {
    return value == null ? <span className="no-data">&mdash;</span> : <UnitCell v={value} />;
  }
  if (!editing) {
    return (
      <button
        className={'fc-cell' + (overridden ? ' fc-cell--overridden' : '')}
        onClick={() => { setText(value == null ? '' : String(value)); setEditing(true); }}
        title={overridden ? 'Overridden — click to edit, clear the box to revert to the model'
                          : 'Click to override this forecast'}
      >
        {value == null ? <span className="no-data">&mdash;</span> : fmtNum(value)}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed === '') return onCommit(null);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return;      // reject silently, keep prior value
    onCommit(n);
  };
  return (
    <input
      className="fc-input"
      autoFocus
      value={text}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function VelocityCell({ v }) {
  if (!v) return <span className="no-data">&mdash;</span>;
  // The global column carries a rate but no direction/method -- those are
  // per-country and don't aggregate (see normalizeForecastRow).
  const arrow = v.direction === 'up' ? '▲' : v.direction === 'down' ? '▼' : '—';
  const tag = v.method ? (v.method.startsWith('holt') ? 'holt' : 'wma') : null;
  return (
    <>
      <div className="rate-cell">
        {v.direction && <span className={'dir-arrow ' + v.direction}>{arrow}</span>}
        <span>{v.weekly_rate.toFixed(1)}/wk</span>
        {tag && <span className={'method-tag' + (tag === 'holt' ? ' holt' : '')} title={v.method}>{tag}</span>}
      </div>
      {v.weeks_of_stock != null && <span className="wks" style={{ display: 'block', marginTop: 1 }}>({v.weeks_of_stock.toFixed(1)} wks)</span>}
    </>
  );
}

/** `showSign` is opt-in and used only by the demand block, where + means
 * "order this many" and - means surplus. On a stock or sales count a
 * leading + says nothing -- plus of what? -- so it's omitted there. */
function UnitCell({ v, showSign }) {
  const zero = Math.round(v) === 0;
  const neg = v < 0;
  const txt = showSign && v > 0 && !zero ? '+' + fmtNum(v) : fmtNum(v);
  return <span className={neg ? 'neg' : zero ? 'zero' : ''}>{txt}</span>;
}

