import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStockHealthTiers, getStockHealthSummary, getBrandStockHealth, getCatalogStockHealth, getReceiptsMonthly, getStockouts } from '../../lib/api.js';
import { fmtCurrency, fmtNum } from '../../lib/format.js';
import { COUNTRIES } from '../../lib/constants.js';
import { matchQuery } from '../../lib/searchMatch.js';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { downloadCsv } from '../../lib/download.js';
import CopyButton from '../../components/CopyButton.jsx';
import {
  TIER_ORDER, TIER_TONE, TIER_SHADE, brandHealthCsv, catalogHealthCsv, squarify,
  brandValue, catalogScope, countryValueTotals, countryUnitTotals, tierTotal,
  itemTurnover, itemSellThrough, medianSkuTurnover, medianSkuSellThrough, sortItems,
  sortStockouts, stockoutCsv,
} from './stockHealthData.js';

const COUNTRY_KEYS = COUNTRIES.map((c) => c.key);

function toggleIn(list, val) {
  return list.includes(val) ? list.filter((v) => v !== val) : [...list, val];
}

export default function StockAnalysisPage() {
  const [tiers, setTiers] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);

  // Multi-select everywhere: a brand list, a country list, a tier list --
  // empty always means "no filter, show everything," never "select
  // nothing." Brands are additive when fetched (per-brand item rows get
  // concatenated); countries/tiers narrow the SAME already-loaded data.
  const [brands, setBrands] = useState([]);
  const [countries, setCountries] = useState([]);
  const [tierFilters, setTierFilters] = useState([]);

  const [currency, setCurrency] = useState('AED');
  // Value by default: the mix is read to decide where money is tied
  // up, and SKU count over-weights a long tail of cheap stragglers.
  const [treemapMeasure, setTreemapMeasure] = useState('value');
  const [search, setSearch] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [itemSort, setItemSort] = useState({ key: 'item_code', dir: 'asc' });
  const [stockoutSort, setStockoutSort] = useState({ key: 'units_sold_l3m', dir: 'desc' });

  // Stock-outs are their own view, not a filter over the item table: a
  // stocked-out item has no stock, and the item table is by definition
  // items that HAVE stock (see compute_stockouts' docstring).
  const [showStockouts, setShowStockouts] = useState(false);

  // The brand panel needs to match the right column's height exactly --
  // no dead space below the list, but still a genuinely scrollable,
  // capped wrapper (never all 185 brands rendered unbounded). CSS Grid
  // stretch + flex:1 + min-height:0 can't do this alone: with no
  // explicit height anywhere in the chain, the row height and the
  // list's content height are circularly dependent, and browsers
  // resolve that by growing to fit everything -- which is exactly the
  // "whole page is one giant list" bug this was built to fix. Measuring
  // the right column's actual rendered height and applying it as an
  // explicit height on the left panel breaks that circularity.
  //
  // A callback ref, not a plain useRef + useEffect(fn, []): .stock-right
  // only exists inside {summary && (...)}, and summary is still null on
  // the very first render (it loads async) -- a plain effect with an
  // empty dependency array runs once, immediately, before that data
  // arrives, finds rightRef.current still null, and never gets another
  // chance to attach the observer once the real element finally mounts.
  // Confirmed live: the panel's inline height never got set at all,
  // ever, for exactly this reason. A callback ref fires precisely when
  // React actually attaches (or detaches) the DOM node, whenever that
  // happens to be.
  const rightObserverRef = useRef(null);
  const [rightHeight, setRightHeight] = useState(null);

  const setRightRef = useCallback((el) => {
    if (rightObserverRef.current) {
      rightObserverRef.current.disconnect();
      rightObserverRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setRightHeight(entry.contentRect.height);
    });
    observer.observe(el);
    rightObserverRef.current = observer;
  }, []);

  useEffect(() => {
    getStockHealthTiers().then((d) => setTiers(d.tiers)).catch(() => setTiers({}));
    getStockHealthSummary()
      .then((d) => setSummary(d.brands))
      .catch((err) => setSummaryError(err.message));
  }, []);

  // Per-brand item detail is fetched once per brand and kept here for the
  // life of the page -- not prefetched for every brand up front (that's
  // ~26k items across ~185 brands, the same whole-catalog shape that
  // already OOM'd once this session), but re-selecting a brand you've
  // already viewed is then instant with no re-fetch. Real state, not a
  // ref: React's rules-of-hooks lint disallows reading a ref's .current
  // during render (even read-only, even from a stable ref only ever
  // mutated in effects) -- brandRows below needs to read this while
  // rendering, so it has to be state.
  const [brandRowsByName, setBrandRowsByName] = useState({});
  const [brandFetchError, setBrandFetchError] = useState(null);

  useEffect(() => {
    const missing = brands.filter((b) => !(b in brandRowsByName));
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      setBrandFetchError(null);
      try {
        const fetched = await Promise.all(missing.map(async (b) => [b, (await getBrandStockHealth(b)).items]));
        if (!cancelled) setBrandRowsByName((prev) => ({ ...prev, ...Object.fromEntries(fetched) }));
      } catch (err) {
        if (!cancelled) setBrandFetchError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [brands, brandRowsByName]);

  // Concatenated rows for every selected brand, each stamped with which
  // brand it came from (compute_brand_stock_health's rows don't carry
  // that on their own, unlike the catalog endpoint's) -- needed the
  // moment more than one brand can be selected, so the item table and
  // CSV export can still say which brand each row belongs to. null while
  // any selected brand hasn't finished loading yet, same "don't render
  // stale data under the new selection's label" reasoning as before.
  const brandRows = useMemo(() => {
    if (!brands.length) return null;
    if (!brands.every((b) => b in brandRowsByName)) return null;
    return brands.flatMap((b) => (brandRowsByName[b] || []).map((r) => ({ ...r, brand: b })));
  }, [brands, brandRowsByName]);

  // Item-level detail for a country/tier filter clicked with NO brand
  // selected. Precomputed (see stock_health_items / api/main.py's
  // docstring) but now filtered server-side by the current
  // countries/tierFilters -- refetches on every filter change instead of
  // fetching the whole ~4.5MB catalog once and filtering client-side,
  // since the whole point is to only pull down what's actually being
  // looked at. A separate, deliberate "export full catalog" action
  // (below) bypasses this and always asks for everything.
  const needsCatalogDetail = !brands.length && (countries.length > 0 || tierFilters.length > 0);
  const {
    data: catalogData, error: catalogError, loading: catalogLoading,
  } = useAsyncData(() => getCatalogStockHealth(countries, tierFilters),
    [countries, tierFilters], { enabled: needsCatalogDetail });
  const catalogRows = catalogData?.items ?? null;

  const {
    data: stockoutData, error: stockoutError,
  } = useAsyncData(() => getStockouts(brands, countries), [brands, countries], { enabled: showStockouts });
  const stockouts = stockoutData?.stockouts ?? null;

  // Deliberately separate from the (now server-filtered) browsing fetch
  // above: this always asks for the complete, unfiltered catalog --
  // ~4.5MB -- regardless of whatever's currently selected, for exporting
  // to Excel for manual dissection. A distinct action rather than
  // conflating "export what I'm looking at" with "give me everything."
  const [fullExportLoading, setFullExportLoading] = useState(false);
  const [fullExportError, setFullExportError] = useState(null);

  async function exportFullCatalog() {
    setFullExportLoading(true);
    setFullExportError(null);
    try {
      const d = await getCatalogStockHealth();
      downloadCsv('full_catalog_stock_health.csv', catalogHealthCsv(d.items));
    } catch (err) {
      setFullExportError(err.message);
    } finally {
      setFullExportLoading(false);
    }
  }

  // Receipt value received, month over month, trailing 12 months -- live
  // (not precomputed: a small GROUP BY over the pipeline's already
  // month-aggregated table, see receipt_value_by_month's docstring).
  //
  // Brands ARE blended together here (fine -- summing several brands'
  // inbound receipts is a real number), but countries never are: QAT/KSA
  // receipts are frequently UAE stock moving onward (the same UAE-hub
  // redistribution pattern documented for net_order elsewhere in this
  // app), so summing countries would double-count the same inbound value.
  // Multiple selected countries instead render as separate lines, one
  // fetch each. No countries selected defaults to just UAE (the real
  // entry point), never a blended "all three" total. A brand must be
  // selected at all -- there's no analogous "default brand," and a
  // catalog-wide sum has the same double-counting problem across brands
  // that a cross-country sum has across countries.
  const chartCountries = countries.length ? countries : ['UAE'];
  const [receiptSeries, setReceiptSeries] = useState(null);
  const [receiptError, setReceiptError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReceiptSeries(null);
      setReceiptError(null);
      if (!brands.length) return;
      const series = countries.length ? countries : ['UAE'];
      try {
        const results = await Promise.all(series.map(async (c) => {
          const d = await getReceiptsMonthly(brands, c);
          return [c, d.months];
        }));
        if (!cancelled) setReceiptSeries(Object.fromEntries(results));
      } catch (err) {
        if (!cancelled) setReceiptError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [brands, countries]);

  // The brand summary is an aggregate of the SAME source data the item
  // rows come from, so every headline figure is derivable from it --
  // including when brands are selected. That means the KPIs, treemap and
  // country bars render instantly from data already in hand instead of
  // blanking out while a per-brand item fetch resolves; brandRows now
  // feeds only the item table, which is the one thing it's actually
  // needed for. (This also retires the null-scope loading state that
  // previously existed purely to avoid showing a stale brand's numbers.)
  const scopedSummary = useMemo(() => {
    if (!summary) return [];
    return brands.length ? summary.filter((b) => brands.includes(b.brand)) : summary;
  }, [summary, brands]);

  // Countries AND tiers both narrow this -- that's the cross-filter.
  const scope = useMemo(
    () => catalogScope(scopedSummary, countries, tierFilters),
    [scopedSummary, countries, tierFilters],
  );

  const countryTotals = useMemo(
    () => countryValueTotals(scopedSummary, COUNTRY_KEYS, tierFilters),
    [scopedSummary, tierFilters],
  );

  const countryUnitTotalsScoped = useMemo(
    () => countryUnitTotals(scopedSummary, COUNTRY_KEYS, tierFilters),
    [scopedSummary, tierFilters],
  );

  // Always the whole catalog's total (country- and tier-scoped, never
  // brand-scoped) -- the left list's share bars compare every brand
  // against the same denominator regardless of which ones are selected.
  // Using scope.value here was the bug once: once brands were picked,
  // every OTHER brand's bar was measured against the SELECTED brands'
  // total instead of the catalog's, producing bars with no meaning.
  const catalogTotal = useMemo(
    () => catalogScope(summary, countries, tierFilters).value,
    [summary, countries, tierFilters],
  );

  const visibleBrands = useMemo(() => {
    if (!summary) return [];
    let rows = search.trim() ? summary.filter((b) => matchQuery(b.brand, search)) : summary;
    // A brand with nothing in the current country/tier scope isn't a
    // candidate for selection -- listing it at zero would be noise.
    if (countries.length || tierFilters.length) {
      rows = rows.filter((b) => brandValue(b, countries, tierFilters) > 0);
    }
    return [...rows].sort(
      (a, b) => brandValue(b, countries, tierFilters) - brandValue(a, countries, tierFilters));
  }, [summary, search, countries, tierFilters]);

  function toggleBrand(name) {
    setBrands((prev) => toggleIn(prev, name));
  }
  function toggleCountry(key) {
    setCountries((prev) => toggleIn(prev, key));
  }
  function toggleTier(key) {
    setTierFilters((prev) => toggleIn(prev, key));
  }

  // Three states for the item-detail section: brand-scoped (1+ brands
  // selected), catalog-scoped (no brand, but a country or tier filter is
  // active -- driven by catalogRows instead), or nothing to show yet.
  const detailMode = brands.length ? 'brand' : (needsCatalogDetail ? 'catalog' : 'none');
  const detailRows = detailMode === 'brand' ? brandRows : (detailMode === 'catalog' ? catalogRows : null);
  const detailLoading = detailMode === 'brand' ? (brands.length > 0 && !brandRows && !brandFetchError) : catalogLoading;
  const detailError = detailMode === 'brand' ? brandFetchError : catalogError;
  // A Brand column only earns its place once more than one brand could
  // be in the rows -- always true in catalog mode (many brands), and
  // true in brand mode only once 2+ brands are actually selected.
  const showBrandColumn = detailMode === 'catalog' || brands.length > 1;

  // Rows for whichever mode is active, narrowed by search and any
  // selected tiers (clicking a tier chip/treemap tile -- OR'd together,
  // not AND'd: "Aging or Critical" makes sense as a filter, "Aging and
  // Critical" would always be empty since a health value can only be one
  // tier at a time).
  const visibleSkus = useMemo(() => {
    if (!detailRows) return [];
    let rows = detailRows;
    if (skuSearch.trim()) {
      rows = rows.filter((r) => matchQuery(r.item_code, skuSearch) || matchQuery(r.item_name || '', skuSearch));
    }
    const countryKeysToCheck = countries.length ? countries : COUNTRY_KEYS;
    if (tierFilters.length) {
      rows = rows.filter((r) => countryKeysToCheck.some((c) => tierFilters.includes(r.health[c])));
    }
    return sortItems(rows, itemSort, COUNTRY_KEYS);
  }, [detailRows, skuSearch, tierFilters, countries, itemSort]);

  const visibleCountries = countries.length ? COUNTRIES.filter((c) => countries.includes(c.key)) : COUNTRIES;

  // Exact for however many brands are selected, because it's computed from
  // the rows themselves -- a median can't be derived from per-brand
  // medians, so storing one would be right for a single brand and quietly
  // wrong for any other selection.
  const medianTurn = useMemo(() => medianSkuTurnover(detailRows), [detailRows]);
  const medianSellThr = useMemo(() => medianSkuSellThrough(detailRows), [detailRows]);

  function toggleItemSort(key) {
    setItemSort((s2) => (s2.key === key
      ? { key, dir: s2.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'item_code' || key === 'item_name' || key === 'brand' ? 'asc' : 'desc' }));
  }
  const itemArrow = (key) => (itemSort.key === key ? (itemSort.dir === 'desc' ? ' ▼' : ' ▲') : '');

  function exportCsv() {
    const label = brands.length === 1 ? brands[0].replace(/\s+/g, '_')
      : brands.length > 1 ? 'multi_brand'
        : 'catalog';
    const csv = showBrandColumn ? catalogHealthCsv(visibleSkus) : brandHealthCsv(visibleSkus);
    downloadCsv(`${label}_stock_health.csv`, csv);
  }

  if (summaryError) return <div className="page-error">Error loading stock health: {summaryError}</div>;

  const anyFilterActive = brands.length > 0 || countries.length > 0 || tierFilters.length > 0;

  return (
    <>
      <div className="container page-head">
        <p className="page-eyebrow">Stock analysis</p>
        <div className="hero-row">
          <div className="hero-metric">
            <p className="hero-figure accent">{summary && scope ? fmtCurrency(scope.value, currency) : '—'}</p>
            <p className="hero-label">
              {brands.length ? brands.join(' + ') : 'catalog'} stock{countries.length ? ` · ${countries.join(' + ')}` : ''} on hand
              {scope && <>{' · '}{fmtNum(scope.skuCount)} SKUs</>}
            </p>
          </div>
        </div>
        <p className="hero-note">
          Health tiers by trailing sales (fast mover through dead stock). A SKU with no sale in 12 months is
          only <strong>dead stock</strong> if it also wasn&#39;t received in that same window &mdash; otherwise
          it&#39;s <strong>new stock</strong> (received under 3 months ago) or <strong>aging</strong> (received
          3&ndash;12 months ago), since it never had a fair chance to sell yet.
        </p>
      </div>

      <div className="container toolbar">
        <div className="field">
          <span className="field-label">Search brands</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Brand — ,,and //or --exclude" />
        </div>
        <div className="field">
          <span className="field-label">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['EUR', 'AED', 'USD'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {anyFilterActive && (
          <div className="pill-row" style={{ justifyContent: 'flex-start' }}>
            {brands.map((b) => (
              <button key={'b-' + b} className="pill pill--active" onClick={() => toggleBrand(b)}>
                <span className="pill-text">{b}</span><span className="pill-x">&times;</span>
              </button>
            ))}
            {countries.map((c) => (
              <button key={'c-' + c} className="pill pill--active" onClick={() => toggleCountry(c)}>
                <span className="pill-text">{c}</span><span className="pill-x">&times;</span>
              </button>
            ))}
            {tierFilters.map((t) => (
              <button key={'t-' + t} className="pill pill--active" onClick={() => toggleTier(t)}>
                <span className="pill-text">{tiers?.[t]?.label || t}</span><span className="pill-x">&times;</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!summary && !summaryError && <div className="page-loading">Loading stock health&hellip;</div>}

      {summary && (
        <div className="container stock-layout">
          <div className="stock-brand-panel" style={rightHeight != null ? { height: rightHeight } : undefined}>
            <div className="stock-brand-panel-head">
              <span>Brands</span>
              <span>{fmtNum(visibleBrands.length)}</span>
            </div>
            <div className="stock-brand-list">
              {visibleBrands.length === 0 && <div className="stock-brand-empty">No brands match.</div>}
              {visibleBrands.map((b, i) => {
                const value = brandValue(b, countries);
                const share = catalogTotal > 0 ? value / catalogTotal : 0;
                const selected = brands.includes(b.brand);
                return (
                  <button
                    key={b.brand}
                    className={'stock-brand-row' + (selected ? ' selected' : '')}
                    onClick={() => toggleBrand(b.brand)}
                  >
                    <span className={'stock-brand-check' + (selected ? ' checked' : '')} aria-hidden="true" />
                    <span className="stock-brand-rank">{i + 1}</span>
                    <span className="stock-brand-main">
                      <span className="stock-brand-name">{b.brand}</span>
                      <span className="stock-brand-value">{fmtCurrency(value, currency)}</span>
                      <div className="share-track"><div className="share-fill" style={{ width: `${Math.max(2, share * 100)}%` }} /></div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="stock-right" ref={setRightRef}>
              <>
                {/* Grouped by the question each answers, because ten
                    tiles in undifferentiated rows forced the reader to
                    work out which figures were even comparable. Position
                    (what we hold, now) and performance (what it did, over
                    a year) are different units on different time bases,
                    and mixing them invited exactly the wrong comparisons. */}
                <div className="stock-kpi-group">
                  <div className="stock-kpi-group-head">Stock on hand · now</div>
                  <div className="stock-kpi-row">
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">{fmtCurrency(scope.value, currency)}</span>
                      <span className="stock-kpi-label">Stock value</span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">{fmtNum(scope.units)}</span>
                      <span className="stock-kpi-label">Stock units</span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">{fmtNum(scope.skuCount)}</span>
                      <span className="stock-kpi-label">{brands.length ? 'SKUs in stock' : 'Brand-SKU pairs'}</span>
                      <span className="stock-kpi-sub">
                        {brands.length
                          ? 'Items with stock in the selected brands'
                          : 'One per brand+country combination -- not unique items'}
                      </span>
                    </div>
                    {/* Stock-outs belongs with position, not performance:
                        it's the gap in what we hold -- the counterpart to
                        the three tiles beside it, not a sales result. */}
                    <button
                      className={'stock-kpi-tile stock-kpi-tile--action' + (showStockouts ? ' selected' : '')}
                      onClick={() => setShowStockouts((v) => !v)}
                      title="Show the items selling with nothing on the shelf"
                    >
                      <span className="stock-kpi-num" style={{ color: scope.stockouts > 0 ? 'var(--caution)' : undefined }}>
                        {fmtNum(scope.stockouts)}
                      </span>
                      <span className="stock-kpi-label">Stock-outs {showStockouts ? '▲' : '▼'}</span>
                      <span className="stock-kpi-sub">sold in last 3mo, nothing on the shelf</span>
                    </button>
                  </div>
                </div>

                {/* Sales-derived, so country-scoped but never tier-scoped:
                    an item's health tier is DERIVED from its sales history,
                    so filtering these by tier would be circular.

                    GMROI is deliberately absent. It divides a full year of
                    gross margin by stock value at a single instant, where
                    the textbook figure divides by AVERAGE inventory over
                    the period -- so a brand that just took delivery scores
                    badly for reasons unrelated to how well it earns. Still
                    computed and stored, so re-enabling is one line once the
                    denominator is trustworthy: see build_stock_history.py
                    on backfilling month-end balances from the stock ledger. */}
                <div className="stock-kpi-group">
                  <div className="stock-kpi-group-head">Sold · last 12 months</div>
                  <div className="stock-kpi-row">
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">{fmtCurrency(scope.revenue, currency)}</span>
                      <span className="stock-kpi-label">Revenue</span>
                      <span className="stock-kpi-sub">excludes internal transfers</span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">{fmtCurrency(scope.cogs, currency)}</span>
                      <span className="stock-kpi-label">COGS</span>
                      {/* Margin reads off by subtracting this from Revenue.
                          Approximate for the same reason GMROI's numerator
                          is: the sales table carries revenue but no cost,
                          so this uses today's unit cost, not cost at sale. */}
                      <span className="stock-kpi-sub">at current unit cost — revenue minus this is margin</span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">
                        {scope.turnover == null ? '—' : scope.turnover.toFixed(2)}
                      </span>
                      <span className="stock-kpi-label">Turnover</span>
                      <span className="stock-kpi-sub">
                        {fmtNum(scope.soldUnits)} sold{tierFilters.length ? ' · all tiers' : ''}
                      </span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">
                        {scope.sellThrough == null ? '—' : `${scope.sellThrough.toFixed(0)}%`}
                      </span>
                      <span className="stock-kpi-label">Sell-through</span>
                      {/* The "brand totals" caveat is load-bearing, not
                          pedantry: numerator and denominator aren't matched
                          per SKU, so receiving 100 of item A and selling 100
                          of item B reads as a healthy 100% while A sits
                          untouched. */}
                      <span className="stock-kpi-sub">sold ÷ received, brand totals — not matched per SKU</span>
                    </div>
                  </div>
                </div>

                {/* Every SKU weighted equally, against the volume-weighted
                    totals above. The GAP between the two groups is the
                    finding: strong totals with a weak median means a few
                    fast SKUs are carrying a lot of dead weight. */}
                <div className="stock-kpi-group">
                  <div className="stock-kpi-group-head">Typical SKU · last 12 months</div>
                  <div className="stock-kpi-row">
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">
                        {medianTurn.value == null ? '—' : medianTurn.value.toFixed(2)}
                      </span>
                      <span className="stock-kpi-label">Median SKU turnover</span>
                      {/* The zero share is what makes this read as a
                          finding rather than a broken tile: on a brand with
                          a long dead tail the median is legitimately 0.00,
                          and "0.00 · 61% sold nothing" states the same fact
                          in a form a purchaser can act on. */}
                      <span className="stock-kpi-sub">
                        {medianTurn.zeroShare == null ? 'select a brand or filter'
                          : `${Math.round(medianTurn.zeroShare * 100)}% of SKUs sold nothing`}
                      </span>
                    </div>
                    <div className="stock-kpi-tile">
                      <span className="stock-kpi-num">
                        {medianSellThr.value == null ? '—' : `${medianSellThr.value.toFixed(0)}%`}
                      </span>
                      <span className="stock-kpi-label">Median SKU sell-through</span>
                      <span className="stock-kpi-sub">
                        {medianSellThr.zeroShare == null ? 'select a brand or filter'
                          : `matched per SKU · ${Math.round(medianSellThr.zeroShare * 100)}% sold nothing`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="stock-chart-row">
                  <div className="chart-card">
                    <div className="chart-title-row">
                      <div className="chart-title">Health mix{brands.length ? ` · ${brands.join(', ')}` : ''}</div>
                      <div className="seg-toggle">
                        {TREEMAP_MEASURES.map((m) => (
                          <button
                            key={m.key}
                            className={'btn-toggle' + (treemapMeasure === m.key ? ' active' : '')}
                            onClick={() => setTreemapMeasure(m.key)}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <HealthTreemap
                      tierStats={scope.tierStats}
                      tiers={tiers}
                      activeTiers={tierFilters}
                      onToggleTier={toggleTier}
                      measure={treemapMeasure}
                      currency={currency}
                    />
                    {/* At-risk lives here, not in the KPI row: it's a
                        statement ABOUT this mix, so it stays whole while
                        the tiles above narrow to the selected tier. */}
                    <div className="mix-atrisk">
                      <span className="mix-atrisk-value">{fmtCurrency(scope.atRiskValue, currency)}</span>
                      {' critical + dead · '}
                      {fmtNum(scope.atRiskCount)} of {fmtNum(tierTotal(scope.tierCounts))} stocked
                      {scope.valueAllTiers > 0
                        && ` · ${Math.round((scope.atRiskValue / scope.valueAllTiers) * 100)}% of value`}
                    </div>
                  </div>
                  <div className="chart-card stock-country-card">
                    <div className="stock-country-card-top">
                      <div className="stock-country-group">
                        <div className="chart-title">Stock by country (value)</div>
                        {COUNTRIES.map((c) => {
                          const v = countryTotals[c.key] || 0;
                          const max = Math.max(1, ...COUNTRY_KEYS.map((k) => countryTotals[k] || 0));
                          const selected = countries.includes(c.key);
                          return (
                            <div
                              key={c.key}
                              className={'stock-country-bar' + (countries.length && !selected ? ' dim' : '') + (selected ? ' selected' : '')}
                              onClick={() => toggleCountry(c.key)}
                            >
                              <div className="stock-country-bar-head">
                                <span><span className={'dot dot-' + c.dot} /> {c.label}</span>
                                <span>{fmtCurrency(v, currency)}</span>
                              </div>
                              <div className="share-track">
                                <div className="share-fill" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: `var(--mkt-${c.dot})` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="stock-country-group">
                        <div className="chart-title">Stock by country (units)</div>
                        {COUNTRIES.map((c) => {
                          const v = countryUnitTotalsScoped[c.key] || 0;
                          const max = Math.max(1, ...COUNTRY_KEYS.map((k) => countryUnitTotalsScoped[k] || 0));
                          const selected = countries.includes(c.key);
                          return (
                            <div
                              key={c.key}
                              className={'stock-country-bar' + (countries.length && !selected ? ' dim' : '') + (selected ? ' selected' : '')}
                              onClick={() => toggleCountry(c.key)}
                            >
                              <div className="stock-country-bar-head">
                                <span><span className={'dot dot-' + c.dot} /> {c.label}</span>
                                <span>{fmtNum(v)}</span>
                              </div>
                              <div className="share-track">
                                <div className="share-fill" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: `var(--mkt-${c.dot})` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="stock-receipt-chart-wrap">
                      <div className="chart-title">Receipt value received (12mo)</div>
                      {brands.length ? (
                        <ReceiptChart series={receiptSeries} countries={chartCountries} error={receiptError} currency={currency} />
                      ) : (
                        <div className="chart-empty">Select a brand to see receipt value received.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
          </div>
        </div>
      )}

      {showStockouts && (
        <StockoutPanel
          stockouts={stockouts}
          error={stockoutError}
          sort={stockoutSort}
          onSort={setStockoutSort}
          onClose={() => setShowStockouts(false)}
        />
      )}

      <div className="container" style={{ marginTop: 'var(--s6)' }}>
        {detailMode === 'none' && (
          <div className="chart-empty" style={{ padding: 'var(--s7) 0' }}>
            Select a brand, or click a health tier / country, to see item-level detail.
          </div>
        )}

        {detailMode !== 'none' && (
          <>
            <div className="toolbar" style={{ paddingTop: 0 }}>
              <div className="field">
                <span className="field-label">{brands.length ? brands.join(', ') : 'Catalog'} &middot; item code</span>
                <input type="text" value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} placeholder="Code or name" />
              </div>
              <button className="export-btn" style={{ marginLeft: 'auto' }} onClick={exportCsv}>
                Export CSV ({fmtNum(visibleSkus.length)})
              </button>
              {detailMode === 'catalog' && (
                <button className="export-btn" onClick={exportFullCatalog} disabled={fullExportLoading} title="Ignores the current country/tier filter -- always the whole catalog, for offline analysis in Excel.">
                  {fullExportLoading ? 'Exporting full catalog…' : 'Export full catalog'}
                </button>
              )}
            </div>
            {fullExportError && <div className="page-error">{fullExportError}</div>}

            {detailLoading && <div className="page-loading">Loading {brands.length ? brands.join(', ') : 'catalog'}&hellip;</div>}
            {detailError && <div className="page-error">{detailError}</div>}

            {!detailLoading && !detailError && (
              <div className="tablewrap">
                <table className="fa-table single-header" style={{ tableLayout: 'auto', width: '100%' }}>
                  <thead>
                    <tr className="sub-row">
                      {showBrandColumn && <th className="col-name sortable" onClick={() => toggleItemSort('brand')}>Brand{itemArrow('brand')}</th>}
                      <th className="col-code sortable" onClick={() => toggleItemSort('item_code')}>Code{itemArrow('item_code')}</th>
                      <th className="col-name sortable" onClick={() => toggleItemSort('item_name')}>Item{itemArrow('item_name')}</th>
                      {visibleCountries.map((c) => (
                        <th key={c.key} className="sortable" onClick={() => toggleItemSort(`stock:${c.key}`)}>
                          <span className={'dot dot-' + c.dot} />{c.label} stock{itemArrow(`stock:${c.key}`)}
                        </th>
                      ))}
                      {/* Health sorts worst-first by tier severity, not
                          alphabetically -- "Aging before Critical" would be
                          a meaningless ordering of a ranked scale. */}
                      {visibleCountries.map((c) => (
                        <th key={c.key + 'h'} className="sortable" onClick={() => toggleItemSort(`health:${c.key}`)}>
                          <span className={'dot dot-' + c.dot} />{c.label} health{itemArrow(`health:${c.key}`)}
                        </th>
                      ))}
                      {/* Per-SKU flow: item totals across countries, so
                          these two stay put when a country filter narrows
                          the stock/health columns beside them. */}
                      <th className="sortable" onClick={() => toggleItemSort('l12m_sold')} title="Units sold in the last 12 months (excludes internal transfers)">Sold 12m{itemArrow('l12m_sold')}</th>
                      <th className="sortable" onClick={() => toggleItemSort('l12m_received')} title="Units received in the last 12 months">Recv 12m{itemArrow('l12m_received')}</th>
                      <th className="sortable" onClick={() => toggleItemSort('turnover')} title="Units sold ÷ units on hand. Above 1 means it turned over more than once.">Turn{itemArrow('turnover')}</th>
                      <th className="sortable" onClick={() => toggleItemSort('sell_through')} title="Units sold ÷ units received, matched per SKU. Above 100% means it sold more than came in, drawing down existing stock.">Sell-thr{itemArrow('sell_through')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSkus.length === 0 && (
                      <tr><td colSpan={6 + visibleCountries.length * 2 + (showBrandColumn ? 1 : 0)} style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 24 }}>No SKUs match.</td></tr>
                    )}
                    {visibleSkus.map((r) => (
                      <tr key={(r.brand || '') + r.item_code} className="item-row">
                        {showBrandColumn && <td className="col-name">{r.brand}</td>}
                        <td className="col-code"><span className="code-cell">{r.item_code}<CopyButton text={r.item_code} title="Copy item code" /></span></td>
                        <td className="col-name" title={r.item_name}>{r.item_name}</td>
                        {visibleCountries.map((c) => <td key={c.key}>{fmtNum(r.stock[c.key])}</td>)}
                        {visibleCountries.map((c) => <td key={c.key + 'h'}><HealthBadge tier={r.health[c.key]} tiers={tiers} /></td>)}
                        <td>{fmtNum(r.l12m_sold || 0)}</td>
                        <td>{fmtNum(r.l12m_received || 0)}</td>
                        <td>{itemTurnover(r) == null ? <span className="no-data">&mdash;</span> : itemTurnover(r).toFixed(2)}</td>
                        <td>{itemSellThrough(r) == null ? <span className="no-data">&mdash;</span> : `${itemSellThrough(r).toFixed(0)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}


// Its own component, not inline JSX: a stocked-out item has no stock, so
// it cannot come from the item table (which is by definition items that
// HAVE stock) and needs its own fetch, shape and empty state. Inlining it
// added ~55 lines to an already 800-line component for no shared state --
// it reads three props and owns nothing.
function StockoutPanel({ stockouts, error, sort, onSort, onClose }) {
  const rows = stockouts ? sortStockouts(stockouts, sort) : null;
  const toggle = (key) => onSort(sort.key === key
    ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
    // Text sorts open ascending, quantities and dates descending -- the
    // interesting end of a name is the start, of a number the top.
    : { key, dir: ['brand', 'item_code', 'item_name', 'country'].includes(key) ? 'asc' : 'desc' });
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  return (
      <div className="container" style={{ marginTop: 'var(--s6)' }}>
        <div className="toolbar" style={{ paddingTop: 0 }}>
          <span className="review-tag">Stock-outs</span>
          <span className="review-count">
            {stockouts ? `${fmtNum(stockouts.length)} item-market pairs selling with no stock` : 'Loading…'}
            {stockouts && ` · ${fmtNum(stockouts.filter((r) => r.held_elsewhere).length)} held in another market`}
          </span>
          <button
            className="btn-toggle"
            style={{ marginLeft: 'auto' }}
            disabled={!rows || !rows.length}
            onClick={() => downloadCsv('stockouts.csv', stockoutCsv(rows))}
          >
            Export CSV
          </button>
          {/* Exports every row in scope, not the 300 rendered -- the table
              caps rendering for the browser's sake, which is not a reason
              to hand back a truncated file. */}
          <button className="btn-toggle" onClick={onClose}>Close</button>
        </div>
        {error && <div className="page-error">{error}</div>}
        {rows && (
          <div className="tablewrap">
            <table className="fa-table single-header" style={{ tableLayout: 'auto', width: '100%' }}>
              <thead>
                <tr className="sub-row">
                  <th className="col-name sortable" onClick={() => toggle('brand')}>Brand{arrow('brand')}</th>
                  <th className="col-code sortable" onClick={() => toggle('item_code')}>Code{arrow('item_code')}</th>
                  <th className="col-name sortable" onClick={() => toggle('item_name')}>Item{arrow('item_name')}</th>
                  <th className="sortable" onClick={() => toggle('country')}>Out in{arrow('country')}</th>
                  <th className="sortable" onClick={() => toggle('units_sold_l3m')}>Sold 3mo{arrow('units_sold_l3m')}</th>
                  <th className="sortable" onClick={() => toggle('last_sold')}>Last sold{arrow('last_sold')}</th>
                  {/* The first question on seeing a stockout is whether
                      it's a transfer rather than a purchase -- so stock
                      in the other markets is shown, not just the gap. */}
                  <th className="sortable" onClick={() => toggle('held_elsewhere')}>Held elsewhere{arrow('held_elsewhere')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 24 }}>
                    No stock-outs in scope.
                  </td></tr>
                )}
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.item_code + r.country} className="item-row">
                    <td className="col-name">{r.brand}</td>
                    <td className="col-code"><span className="code-cell">{r.item_code}<CopyButton text={r.item_code} title="Copy item code" /></span></td>
                    <td className="col-name" title={r.item_name}>{r.item_name}</td>
                    <td><span className={'dot dot-' + r.country.toLowerCase()} />{r.country}</td>
                    <td>{fmtNum(r.units_sold_l3m)}</td>
                    <td>{r.last_sold}</td>
                    <td>
                      {r.held_elsewhere
                        ? Object.entries(r.stock_elsewhere).filter(([, v]) => v > 0)
                            .map(([c, v]) => `${c} ${fmtNum(v)}`).join(', ')
                        : <span className="no-data">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
}

// Virtual coordinate space for the squarify layout -- percentages of
// this feed the rendered cells' CSS position, and the container's CSS
// aspect-ratio is locked to the same VW:VH so the percentages stay
// geometrically correct at any actual render width, with no DOM
// measurement needed.
const TREEMAP_VW = 600;
const TREEMAP_VH = 460;

// Three measures, because they answer genuinely different questions and
// can disagree sharply: dead stock is usually a large share of SKU COUNT
// (lots of cheap stragglers) but a much smaller share of VALUE, while one
// expensive slow-moving line can dominate value while barely registering
// as a count. Count is the default because it's what the brand-SKU-pairs
// KPI tile above already uses -- switching measures doesn't change what
// "selecting a tier" means, only how the mix is drawn.
const TREEMAP_MEASURES = [
  { key: 'count', label: 'SKUs', format: (n) => fmtNum(n) },
  { key: 'units', label: 'Units', format: (n) => fmtNum(n) },
  { key: 'value', label: 'Value', format: (n, currency) => fmtCurrency(n, currency) },
];

function HealthTreemap({ tierStats, tiers, activeTiers, onToggleTier, measure, currency }) {
  const [hoverTier, setHoverTier] = useState(null);
  const measureDef = TREEMAP_MEASURES.find((m) => m.key === measure) || TREEMAP_MEASURES[0];
  const valueOf = (t) => tierStats[t]?.[measureDef.key] || 0;
  const total = TIER_ORDER.reduce((s, t) => s + valueOf(t), 0);
  const items = TIER_ORDER
    .filter((t) => valueOf(t) > 0)
    .map((t) => ({ tier: t, value: valueOf(t) }))
    .sort((a, b) => b.value - a.value);

  if (total === 0) {
    return <div className="no-data" style={{ padding: 'var(--s6) 0', textAlign: 'center' }}>No stock in scope</div>;
  }

  // squarify's rect extents come directly from the input values, so they
  // must already sum to the target area -- raw tier counts (summing to
  // `total`, not TREEMAP_VW * TREEMAP_VH) produced a sliver of rects in
  // one corner instead of filling the container.
  const area = TREEMAP_VW * TREEMAP_VH;
  const rects = squarify(items.map((i) => (i.value / total) * area), 0, 0, TREEMAP_VW, TREEMAP_VH);
  const hoverIdx = hoverTier ? items.findIndex((i) => i.tier === hoverTier) : -1;
  const hoverRect = hoverIdx >= 0 ? rects[hoverIdx] : null;
  const anySelected = activeTiers.length > 0;

  return (
    <div className="stock-treemap-outer">
      <div className="stock-treemap" style={{ aspectRatio: `${TREEMAP_VW} / ${TREEMAP_VH}` }}>
        {items.map(({ tier: t, value }, i) => {
          const rect = rects[i];
          const selected = activeTiers.includes(t);
          const dimmed = anySelected && !selected;
          return (
            <div
              key={t}
              className={'stock-treemap-cell' + (selected ? ' selected' : '')}
              style={{
                left: `${(rect.x / TREEMAP_VW) * 100}%`,
                top: `${(rect.y / TREEMAP_VH) * 100}%`,
                width: `${(rect.w / TREEMAP_VW) * 100}%`,
                height: `${(rect.h / TREEMAP_VH) * 100}%`,
                background: `var(--${TIER_TONE[t]})`,
                opacity: (dimmed ? 0.35 : 1) * TIER_SHADE[t],
                cursor: onToggleTier ? 'pointer' : 'default',
              }}
              onClick={onToggleTier ? () => onToggleTier(t) : undefined}
              onMouseEnter={() => setHoverTier(t)}
              onMouseLeave={() => setHoverTier((h) => (h === t ? null : h))}
            />
          );
        })}
      </div>
      {/* A custom tooltip instead of the title attribute: the browser's
          native tooltip has a fixed, un-tunable ~1s hover delay before it
          appears, which read as laggy on a treemap with many small
          adjacent cells. This one is a sibling of .stock-treemap (whose
          overflow:hidden would otherwise clip a tooltip trying to render
          past a cell's own edge), positioned at the hovered cell's own
          center using the SAME rect percentages the cell itself uses --
          no mouse-position tracking needed, and it appears the instant
          the pointer enters a cell. */}
      {hoverRect && (
        <div
          className="stock-treemap-tooltip"
          style={{
            left: `${((hoverRect.x + hoverRect.w / 2) / TREEMAP_VW) * 100}%`,
            top: `${((hoverRect.y + hoverRect.h / 2) / TREEMAP_VH) * 100}%`,
          }}
        >
          {tiers?.[hoverTier]?.label || hoverTier}: {measureDef.format(items[hoverIdx].value, currency)}
        </div>
      )}
      <div className="stock-treemap-legend">
        {items.map(({ tier: t, value }) => (
          <div
            key={t}
            className={'stock-treemap-legend-item' + (activeTiers.includes(t) ? ' active' : '')}
            onClick={onToggleTier ? () => onToggleTier(t) : undefined}
            style={onToggleTier ? { cursor: 'pointer' } : undefined}
          >
            <span className={'tier-dot tier-dot--' + TIER_TONE[t]} style={{ opacity: TIER_SHADE[t] }} />
            {tiers?.[t]?.label || t} ({measureDef.format(value, currency)})
          </div>
        ))}
      </div>
    </div>
  );
}

// Multi-series: one line per selected country (or just UAE by default),
// never blended together -- see the fetch effect's own comment for why.
// Brands ARE already summed together server-side by the time `series`
// gets here.
function ReceiptChart({ series, countries, error, currency }) {
  if (error) return <div className="chart-empty">{error}</div>;
  if (!series) return <div className="chart-empty">Loading&hellip;</div>;
  const hasData = countries.some((c) => (series[c] || []).some((m) => m.value > 0));
  if (!hasData) return <div className="chart-empty">No receipts in this window.</div>;

  const allMonths = countries.map((c) => series[c] || []).find((m) => m.length) || [];
  const n = allMonths.length;
  const W = 560, H = 140, padL = 56, padB = 20, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(1, ...countries.flatMap((c) => (series[c] || []).map((m) => m.value)));
  const xFor = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxV) * plotH;

  return (
    <>
      {countries.length > 1 && (
        <div className="chart-legend">
          {countries.map((c) => {
            const meta = COUNTRIES.find((cc) => cc.key === c);
            return <span key={c} className="chart-legend-item"><span className={'dot dot-' + meta.dot} />{c}</span>;
          })}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140 }}>
        {[0, 0.5, 1].map((f) => {
          const y = padT + plotH - f * plotH;
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--edge-soft)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">
                {fmtCurrency(f * maxV, currency)}
              </text>
            </g>
          );
        })}
        {allMonths.map((m, i) => (
          <text key={m.year_month} x={xFor(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">
            {m.year_month.slice(5)}
          </text>
        ))}
        {countries.map((c) => {
          const months = series[c] || [];
          const meta = COUNTRIES.find((cc) => cc.key === c);
          const color = `var(--mkt-${meta.dot})`;
          const pts = months.map((m, i) => `${xFor(i)},${yFor(m.value)}`).join(' ');
          return (
            <g key={c}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
              {months.map((m, i) => (
                <circle key={m.year_month} cx={xFor(i)} cy={yFor(m.value)} r="2.5" fill={color}>
                  <title>{c} {m.year_month}: {fmtCurrency(m.value, currency)}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </>
  );
}

function HealthBadge({ tier, tiers }) {
  if (!tier) return <span className="no-data">&mdash;</span>;
  return (
    <span className={'health-badge health-badge--' + TIER_TONE[tier]} title={tiers?.[tier]?.desc}>
      {tiers?.[tier]?.label || tier}
    </span>
  );
}
