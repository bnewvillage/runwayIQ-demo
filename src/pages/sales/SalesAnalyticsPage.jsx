import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSalesCube, getSalesCustomers, getSalesDaily, getSalesItemSeries, getSalesItems,
  getStockMonthly,
} from '../../lib/api.js';
import { itemStockSeries } from '../../lib/stockHistory.js';
import { fmtCurrency, fmtCurrencyCompact, fmtNum } from '../../lib/format.js';
import { COUNTRIES } from '../../lib/constants.js';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { useWidth } from '../../app/WidthProvider.jsx';
import CopyButton from '../../components/CopyButton.jsx';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { loadExcludedBrands, toggleExcludedBrand } from '../../lib/excludedBrands.js';
import SalesFilterBar from './SalesFilterBar.jsx';
import Kpi from './SalesKpiCard.jsx';
import ShareCard from './SalesShareCard.jsx';
import ItemsTable from './SalesItemsTable.jsx';
import SalesTrendChart from '../../components/SalesTrendChart.jsx';
import {
  CHANNELS, EMPTY, scope, totals, asp, margin, marginPct, returnRate, runRate,
  groupBy, monthlySeries, monthlySeriesBy, allMonthsIn, growth, monthLabels,
  sortSalesItems, weeksIn,
  orderScope, orderTotals, describeScope, scopeParts, isNarrowed,
  VIEWS, selectorView, applies,
  endOfMonth,
} from './salesData.js';

const MEASURES = [
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'units', label: 'Units', money: false },
];

// Shared with Demand Glance on purpose: an exclusion is a statement
// about a brand ("we don't reorder this"), not about one page, so the
// two surfaces read and write the same key rather than each keeping a
// private list that silently disagrees with the other.

function toggleIn(list, v) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function SalesAnalyticsPage() {
  const [filter, setFilter] = useState(EMPTY);
  // Both measures on by default. Revenue and units answer different
  // questions about the same sale -- which one matters depends on whether
  // you are thinking about money or about stock -- and making the reader
  // flip between them to see both was busywork. Turning one off hides its
  // donut and its brand columns together, so the control does one thing.
  const [measures, setMeasures] = useState(() => new Set(['revenue', 'units']));
  const toggleMeasure = (k) => setMeasures((cur) => {
    const next = new Set(cur);
    // Never both off -- an empty page is not a state worth reaching by
    // clicking twice.
    if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
    return next;
  });
  const [currency, setCurrency] = useState('AED');
  const [brandSearch, setBrandSearch] = useState('');

  // The entire cube, once. ~5,000 cells (~0.2 MB) -- everything below is
  // an in-memory filter over this, which is what makes every visual
  // cross-filter every other one with no round trip.
  const { data, error, loading } = useAsyncData(() => getSalesCube(), [],
    { cacheKey: 'sales-cube' });
  const cells = data?.cells ?? null;
  const orders = data?.orders ?? null;

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));

  const months = useMemo(() => (cells ? allMonthsIn(cells) : []), [cells]);
  // The x axis spans what is SELECTED, not all history -- plotting 28
  // months of flat zero either side of a 3-month horizon would waste the
  // axis and flatten the shape of the part being looked at.
  const visibleMonths = useMemo(
    () => (filter.months.length ? months.filter((m) => filter.months.includes(m)) : months),
    [months, filter.months]);

  // Each consumer names its view; VIEWS says what that view honours and
  // every caption below is derived from the same entry.
  const scoped = useMemo(() => (cells ? scope(cells, filter) : []), [cells, filter]);
  const chartScoped = useMemo(
    () => (cells ? scope(cells, filter, VIEWS.chart) : []), [cells, filter]);
  const cardCells = useMemo(
    () => (cells ? scope(cells, filter, VIEWS.card) : []), [cells, filter]);
  const global = useMemo(() => totals(cardCells), [cardCells]);

  const narrowed = isNarrowed(filter);
  // Any selection at all narrows the charts and tables below the cards.
  // "Has the user narrowed anything at all", so it is asked against the
  // view that honours every dimension -- VIEWS.full is blind to `item`,
  // and asking it here would leave a page scoped to one SKU unmarked.
  const anyFilter = Object.keys(EMPTY)
    .some((dim) => applies(filter, dim, VIEWS.customers));
  const filtMark = anyFilter ? ' is-filtered' : '';
  // A split card states brand and period beside the measure -- they
  // qualify both halves -- and the market part under each figure.
  const cardParts = scopeParts(filter, VIEWS.card);
  const basis = narrowed
    ? [cardParts.brands, cardParts.period].join(' · ')
    : null;

  // Each share view drops its OWN dimension from the filter so it stays
  // whole and can act as its own selector -- a country donut filtered by
  // country would be a single segment. Selection shows as a highlighted
  // slice instead.
  // Grouped once per measure rather than per selected measure: both are
  // usually on, and computing the pair is cheap over ~5,000 cells.
  const groupsFor = useCallback((dim, own, mkey) => groupBy(
    cells ? scope(cells, filter, selectorView(own)) : [], dim, mkey), [cells, filter]);
  const byCountry = useMemo(() => ({
    revenue: groupsFor('country', 'countries', 'revenue'),
    units: groupsFor('country', 'countries', 'units'),
  }), [groupsFor]);
  const byChannel = useMemo(() => ({
    revenue: groupsFor('channel', 'channels', 'revenue'),
    units: groupsFor('channel', 'channels', 'units'),
  }), [groupsFor]);
  const byBrand = useMemo(() => ({
    revenue: groupsFor('brand', 'brands', 'revenue'),
    units: groupsFor('brand', 'brands', 'units'),
  }), [groupsFor]);

  // Revenue leads when it is on; the other measure rides along in the
  // readout rather than needing a chart of its own.
  const primary = measures.has('revenue') ? 'revenue' : 'units';
  const secondary = measures.has('revenue') && measures.has('units') ? 'units' : null;

  // Part of the filter rather than state beside it. It is a dimension
  // like any other -- it narrows what several panels answer, and it has
  // to appear in their captions -- and the moment a second consumer
  // honoured it, keeping it outside `filter` meant every one of those
  // captions would have had to remember it separately.
  const selectedItem = filter.item;
  // Takes a value OR an updater, because that is the contract a useState
  // setter has and the items table already calls it with the updater
  // form to toggle a row off. Dropping that stored the FUNCTION as the
  // filter: truthy, so every panel fetched for it and got nothing back.
  const setSelectedItem = (v) => set({
    item: typeof v === 'function' ? v(filter.item) : v,
  });
  const seriesStart = visibleMonths[0] || null;
  const seriesEnd = visibleMonths[visibleMonths.length - 1] || null;
  const { data: itemSeries } = useAsyncData(
    () => getSalesItemSeries(selectedItem, filter.countries, filter.channels,
      seriesStart, seriesEnd ? endOfMonth(seriesEnd) : null),
    [selectedItem, filter.countries, filter.channels, seriesStart, seriesEnd],
    { enabled: !!selectedItem });
  // The cube has no item dimension, so a selected item's series comes
  // from its own rows. Shown ONLY for that item, even while the request
  // is in flight or failed: falling back to the unfiltered total under
  // an item's name would answer a different question than the label.
  const chartCells = useMemo(
    () => (selectedItem ? (itemSeries?.points || []) : chartScoped),
    [selectedItem, itemSeries, chartScoped]);

  // Zooming replots the drilled month day by day. Off by default and
  // per-session rather than sticky: the monthly shape is what the page
  // is for, and a chart silently showing 31 days on load would be
  // answering a question nobody asked yet.
  const [zoomed, setZoomed] = useState(false);
  const zoomOn = zoomed && !!filter.drill;
  const { data: daily } = useAsyncData(
    () => getSalesDaily(filter.drill, endOfMonth(filter.drill),
      filter.countries, filter.channels, filter.brands),
    [filter.drill, filter.countries, filter.channels, filter.brands],
    { enabled: zoomOn });

  // Daily rows are already cell-shaped -- the endpoint names its bucket
  // `year_month` at every grain -- so the same series builder plots them
  // without a granularity argument or a rename on the way in.
  const dailyCells = useMemo(() => daily?.points || [], [daily]);
  // Rows without a bucket are dropped rather than plotted: an API a
  // version behind returns a differently-named column, and the whole
  // page white-screening on one stale field is not a trade worth making
  // for a chart that can simply render empty.
  const dailyDays = useMemo(
    () => [...new Set(dailyCells.map((c) => c.year_month).filter(Boolean))].sort(),
    [dailyCells]);
  const dailyLabels = useMemo(
    () => dailyDays.map((d) => String(Number(d.slice(8, 10)))),
    [dailyDays]);

  const buildSeries = useCallback((dim, mkey) => {
    const split = monthlySeriesBy(zoomOn ? dailyCells : chartCells,
                                  zoomOn ? dailyDays : visibleMonths, dim, mkey);
    const dots = dim === 'country'
      ? Object.fromEntries(COUNTRIES.map((c) => [c.key, c.dot]))
      : { Showroom: 'showroom', Distribution: 'distribution', Ecommerce: 'ecommerce' };
    return {
      series: Object.fromEntries(split.map((x) => [x.key, x.points.map((p) => p.value)])),
      keys: split.map((x) => ({ key: x.key, label: x.key, dot: dots[x.key] || 'uae' })),
    };
  }, [chartCells, visibleMonths, zoomOn, dailyCells, dailyDays]);

  // Month-end stock, drawn under the sales line for a SELECTED ITEM
  // only. Fetched with the selection, like the item's sales series
  // beside it, and not at all otherwise.
  //
  // Only per item: a brand- or market-level version of this was built
  // and dropped. Aggregated that far up, stock is flat and adds nothing
  // a reader cannot already see, while forcing two awkward calls (which
  // market's floor a multi-market line starts at, and what to do when a
  // market joins the record mid-chart) to answer a question nobody was
  // asking. One SKU's shelf against its own sales is the question a
  // buyer actually has, and it needs no apportioning at all.
  const { data: stockHist } = useAsyncData(
    () => getStockMonthly(selectedItem), [selectedItem],
    { enabled: !!selectedItem });

  // The market chart only, and never zoomed: the channel cut has no
  // stock dimension to split by, and a zoomed axis is days, which the
  // monthly snapshots cannot fill.
  const buildMirror = useCallback((dim) => {
    if (dim !== 'country' || zoomOn || !selectedItem) return undefined;
    if (!stockHist?.points?.length) return undefined;
    const measure = primary === 'revenue' ? 'value' : 'units';
    const { series, keys } = itemStockSeries(
      stockHist.points, visibleMonths, measure, stockHist.floors, filter.countries);
    if (!keys.length) return undefined;
    const dots = Object.fromEntries(COUNTRIES.map((c) => [c.key, c.dot]));
    return {
      series,
      keys: keys.map((k) => ({ key: k, label: k, dot: dots[k] || 'uae' })),
      mode: measure === 'value' ? 'value' : 'units',
      label: measure === 'value' ? 'Stock value' : 'Stock on hand',
    };
  }, [stockHist, zoomOn, selectedItem, primary, visibleMonths, filter.countries]);

  const axisLabels = useMemo(() => monthLabels(visibleMonths), [visibleMonths]);

  // Held here, not per chart: the two plot the same periods, and moving
  // one crosshair without the other makes comparing a market against a
  // channel a matter of finding the same column twice by eye.
  const [hoverIdx, setHoverIdx] = useState(null);

  // The dense layout gives every card a definite height, which is the only
  // state where a chart can be told to draw to its container. Matched here
  // rather than guessed from width alone: the CSS query is the authority.
  const { wide } = useWidth();
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 2100px)');
    const sync = () => setRoomy(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const denseLayout = wide && roomy;

  // One object per kind of card, not eight props per card. Everything in
  // here is about the page's current view, so it is the same for every
  // card of that kind -- see SalesKpiCard.
  const cardView = {
    narrowed,
    context: scopeParts(filter, VIEWS.full).markets,
    basis,
    scope: describeScope(filter, VIEWS.card),
    defaultOpen: denseLayout,
    fullMatrix: denseLayout,
    pickedCountries: filter.countries,
    pickedChannels: filter.channels,
  };
  const fullView = { scope: describeScope(filter, VIEWS.full) };
  const orderView = { scope: describeScope(filter, VIEWS.order) };

  // Clicking a point drills the whole page to that month; clicking the
  // month already isolated steps back out. Only wired while the charts
  // plot `visibleMonths` -- zoomed they plot days, so the index would
  // mean something else, and nothing downstream can filter to a day.
  const pickMonth = (i) => {
    const m = visibleMonths[i];
    if (m) set({ drill: filter.drill === m ? null : m });
  };
  const pickedIndex = filter.drill ? visibleMonths.indexOf(filter.drill) : -1;

  // Same cells/axis as the trend chart above it (chartScoped ignores the
  // drill so a clicked point doesn't collapse the comparison to itself;
  // visibleMonths is what's actually selected, not full history) -- MoM
  // and YoY must read the two-months-back and year-back offsets against
  // the SAME axis the filter produced, or a window that ends before the
  // dataset's last month reads its excluded tail as real zero-sales
  // months instead of "not in scope".
  const g = useMemo(() => growth(monthlySeries(chartScoped, visibleMonths, primary)),
    [chartScoped, visibleMonths, primary]);
  const ord = useMemo(() => orderTotals(orders ? orderScope(orders, filter) : []), [orders, filter]);

  // Concentration is NOT additive -- the top 10 of a year is not the
  // union of each month's top 10 -- so it cannot come from the cube and
  // is fetched per scope. See the endpoint's docstring.
  // The items table honours the drill; the chart series above it does
  // not, which is why these are derived separately from seriesStart/End.
  const rangeStart = filter.drill || visibleMonths[0] || null;
  const rangeEnd = filter.drill || visibleMonths[visibleMonths.length - 1] || null;

  const { data: cust } = useAsyncData(
    // Fifty rather than ten: the card is a scroll region beside a table
    // of the same height, and ten rows left it half empty with no way to
    // see who came next. The headline still measures the top ten, so the
    // sentence and the list stay independent of each other.
    () => getSalesCustomers(filter.countries, filter.channels, filter.brands,
      rangeStart, rangeEnd ? endOfMonth(rangeEnd) : null, 50, filter.item),
    [filter.countries, filter.channels, filter.brands, filter.item, rangeStart, rangeEnd],
    { enabled: !!cells });

  // The SKUs behind the current view. Fetched per filter rather than
  // cubed -- an item dimension would take the cube from ~4,900 cells to
  // ~69,000, a 14x payload for a question asked occasionally.
  const [itemSort, setItemSort] = useState({ key: 'revenue', dir: 'desc' });
  const [excludedBrands, setExcludedBrands] = useState(loadExcludedBrands);
  // Capped by default and expanded only on request -- the full list is
  // 11,139 rows, and nobody scrolls that far without meaning to.
  const [showAllItems, setShowAllItems] = useState(false);
  const { data: itemData, loading: itemsLoading } = useAsyncData(
    () => getSalesItems(filter.countries, filter.channels, filter.brands,
      rangeStart, rangeEnd ? endOfMonth(rangeEnd) : null, showAllItems ? 0 : 500),
    [filter.countries, filter.channels, filter.brands, rangeStart, rangeEnd, showAllItems],
    { enabled: !!cells });
  // Exclusions are applied client-side rather than sent to the server:
  // the list is a personal view preference, and filtering here keeps the
  // response cacheable across users who exclude different brands.
  const items = useMemo(() => {
    if (!itemData) return null;
    const kept = excludedBrands.size
      ? itemData.items.filter((r) => !excludedBrands.has(r.brand))
      : itemData.items;
    return sortSalesItems(kept, itemSort);
  }, [itemData, itemSort, excludedBrands]);

  const itemBrands = useMemo(
    () => [...new Set((itemData?.items || []).map((r) => r.brand).filter(Boolean))].sort(),
    [itemData]);

  function toggleExcluded(brand) {
    setExcludedBrands((cur) => toggleExcludedBrand(cur, brand));
  }
  const toggleItemSort = (key) => setItemSort((c) => (c.key === key
    ? { key, dir: c.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['item_code', 'item_name', 'brand'].includes(key) ? 'asc' : 'desc' }));
  const itemArrow = (key) => (itemSort.key === key ? (itemSort.dir === 'desc' ? ' ▼' : ' ▲') : '');

  // One row per brand carrying BOTH measures, rather than a list per
  // measure. Revenue share and unit share are most useful read across a
  // single row -- a brand that is 20% of the money and 5% of the volume
  // is the thing a buyer wants to spot.
  const [brandSort, setBrandSort] = useState({ key: 'revenueShare', dir: 'desc' });
  const toggleBrandSort = (key) => setBrandSort((c) => (c.key === key
    ? { key, dir: c.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'key' ? 'asc' : 'desc' }));
  const brandArrow = (key) => (brandSort.key === key ? (brandSort.dir === 'desc' ? ' ▼' : ' ▲') : '');

  // Concentration over ALL brands in scope, not the 60 rendered -- a
  // share computed from a capped list would describe the cap.
  // The panel honours the page's range, so its title must stop claiming
  // twelve months regardless. `full history` is the endpoint's rolling
  // window when nothing is selected, so it is named as what it is.
  const custParts = scopeParts(filter, VIEWS.customers);
  const custPeriodLabel = custParts.period === 'full history'
    ? 'last 12 months' : custParts.period;
  // The API computes the all-brand comparison only when a brand filter
  // is narrowing something, so its presence IS the condition.
  const custGlobal = !!cust && cust.narrowed;
  // Ranked by revenue by default -- the panel is about concentration, so
  // that is the order the headline sentence describes.
  const [custSort, setCustSort] = useState({ key: 'revenue', dir: 'desc' });
  const toggleCustSort = (key) => setCustSort((c) => (c.key === key
    ? { key, dir: c.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'customer' ? 'asc' : 'desc' }));
  const custArrow = (key) => (custSort.key === key
    ? (custSort.dir === 'desc' ? ' \u25bc' : ' \u25b2') : '');
  const custRows = useMemo(() => {
    if (!cust) return [];
    const dir = custSort.dir === 'desc' ? -1 : 1;
    return [...cust.customers].sort((a, b) => {
      const av = a[custSort.key], bv = b[custSort.key];
      // Nulls last whichever way the column is pointing: a customer with
      // no score is not the best OR the worst, it is unknown.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [cust, custSort]);

  const brandTop10Share = useMemo(() => {
    const rows = byBrand.revenue;
    const total = rows.reduce((s2, x) => s2 + x.value, 0);
    if (!(total > 0)) return '—';
    const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 10)
      .reduce((s2, x) => s2 + x.value, 0);
    return `${Math.round(top / total * 100)}%`;
  }, [byBrand]);
  const brandCount = useMemo(
    () => new Set([...byBrand.revenue, ...byBrand.units].map((x) => x.key)).size,
    [byBrand]);

  // Top ten of each measure for the ranked donut. Built from the same
  // grouped totals the table reads, so the two cannot disagree.
  const brandList = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    const revTotal = byBrand.revenue.reduce((s2, x) => s2 + x.value, 0);
    const unitTotal = byBrand.units.reduce((s2, x) => s2 + x.value, 0);
    const units = new Map(byBrand.units.map((x) => [x.key, x.value]));
    const rev = new Map(byBrand.revenue.map((x) => [x.key, x.value]));
    const keys = [...new Set([...rev.keys(), ...units.keys()])];
    const cmp = (a, b) => {
      const av = a[brandSort.key], bv = b[brandSort.key];
      if (typeof av === 'string') return brandSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      const d = (av ?? -Infinity) - (bv ?? -Infinity);
      return brandSort.dir === 'asc' ? d : -d;
    };
    return keys
      .map((key) => ({
        key,
        revenue: rev.get(key) || 0,
        units: units.get(key) || 0,
        revenueShare: revTotal > 0 ? (rev.get(key) || 0) / revTotal : null,
        unitShare: unitTotal > 0 ? (units.get(key) || 0) / unitTotal : null,
      }))
      .filter((b) => !q || b.key.toLowerCase().includes(q))
      // Selected brands first, then the chosen sort. The list is capped
      // at 60 and the catalogue runs to hundreds, so a brand selected
      // from a search could otherwise vanish from the table that is
      // supposed to show it is active.
      .sort((a, b) => {
        const as = filter.brands.includes(a.key), bs = filter.brands.includes(b.key);
        if (as !== bs) return as ? -1 : 1;
        return cmp(a, b);
      })
      .slice(0, 60);
  }, [byBrand, brandSearch, brandSort, filter.brands]);

  if (error) return <div className="page-error">Error loading sales: {error}</div>;
  if (loading || !cells) return <div className="container" style={{ padding: 'var(--s6)' }}>Loading sales…</div>;

  const fmtFor = (mkey) => (mkey === 'revenue'
    ? (v) => fmtCurrency(v, currency)
    : (v) => fmtNum(v));
  // Same figure at a width a bar column can hold.
  const fmtShortFor = (mkey) => (mkey === 'revenue'
    ? (v) => fmtCurrencyCompact(v, currency)
    : (v) => fmtNum(v));

  return (
    <>
      {/* The filter bar and the card groups share one grid, so wide
          view can seat the bar beside the cards rather than above
          them. In DOM order the bar still comes first, which IS the
          stacked layout at normal width -- no second markup for the
          narrow case. */}
      <div className="container head-grid">
        <div className="da-filters">
          {/* The title is placed BY the bar's grid rather than stacked
              above it -- one line of naming does not need a band of the
              page, which is why wide view used to hide it outright. */}
          <SalesFilterBar
            filter={filter} onChange={setFilter} months={months}
            leadSlot={(
              <div className="page-head">
                <h1>Sales Analytics</h1>
                <p className="page-sub">
                  {fmtNum(cells.length)} brand/market/channel/month cells over {months.length} months.
                  Every chart filters every other one.
                </p>
              </div>
            )}
            extraGroups={[
              {
                label: 'Show',
                node: MEASURES.map((mm) => (
                  <button key={mm.key}
                          className={'btn-toggle' + (measures.has(mm.key) ? ' active' : '')}
                          onClick={() => toggleMeasure(mm.key)}>{mm.label}</button>
                )),
              },
              {
                label: 'Currency',
                node: ['EUR', 'AED', 'USD'].map((c) => (
                  <button key={c} className={'btn-toggle' + (currency === c ? ' active' : '')}
                          onClick={() => setCurrency(c)}>{c}</button>
                )),
              },
            ]}
          />
        </div>

        <div className="stock-kpi-group da-kpi-sales">
          <div className="stock-kpi-group-head">
            Sales · all markets and channels
            <span className="kpi-note-dim"> — click a card for its market × channel breakdown</span>
          </div>
          <div className="stock-kpi-row">
            {/* "net of returns" was ambiguous -- it reads as "this IS the
                returns" to anyone not already thinking in accounting
                terms. Say what was done to the number instead. */}
            <Kpi l="Revenue" s="returns already deducted"
                 n={fmtCurrency(global.revenue, currency)}
                 view={cardView}
                 cells={scoped} compute={(x) => x.revenue}
                 fmt={(v) => fmtCurrency(v, currency)}
                 matrixFmt={(v) => fmtCurrencyCompact(v, currency)} />
            <Kpi l="Units" s="returns already deducted"
                 n={fmtNum(global.units)}
                 view={cardView}
                 cells={scoped} compute={(x) => x.units} fmt={fmtNum} />
            <Kpi l="ASP" s="revenue ÷ units"
                 n={asp(global) == null ? '—' : fmtCurrency(asp(global), currency)}
                 view={cardView}
                 cells={scoped} compute={asp}
                 fmt={(v) => (v == null ? '—' : fmtCurrency(v, currency))} />
            {/* Divided by the weeks in scope rather than handed raw units:
                both the expansion and the narrowed figure run through
                `compute`, so a units-only compute would have put a unit
                count under a label that says units per WEEK. */}
            <Kpi l="Run rate" s="units/week — historical, not a forecast"
                 n={runRate(cardCells) == null ? '—' : fmtNum(runRate(cardCells))}
                 view={cardView}
                 cells={scoped}
                 compute={(x) => (weeksIn(visibleMonths) > 0 ? x.units / weeksIn(visibleMonths) : null)}
                 fmt={(v) => (v == null ? '—' : fmtNum(v))} />
          </div>
        </div>

        <div className="stock-kpi-group da-kpi-quality">
          <div className="stock-kpi-group-head">Quality · all markets and channels</div>
          <div className="stock-kpi-row">
            <Kpi l="Margin"
                 s={marginPct(global) == null ? 'at current unit cost'
                   : `${Math.round(marginPct(global) * 100)}% — at current unit cost`}
                 n={fmtCurrency(margin(global), currency)}
                 view={cardView}
                 cells={scoped} compute={margin} fmt={(v) => fmtCurrency(v, currency)}
                 matrixFmt={(v) => fmtCurrencyCompact(v, currency)} />
            <Kpi l="Return rate" s={`${fmtNum(global.returnUnits)} units credited back`}
                 n={returnRate(global) == null ? '—' : `${(returnRate(global) * 100).toFixed(1)}%`}
                 tone={returnRate(global) > 0.05 ? 'caution' : null}
                 view={cardView}
                 cells={scoped} compute={returnRate}
                 fmt={(v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)} />
            <Kpi n={g.mom == null ? '—' : `${g.mom > 0 ? '+' : ''}${Math.round(g.mom * 100)}%`}
                 l="MoM" s="latest month vs previous" view={fullView} />
            {/* YoY needs 13 months. Qatar has 8, so this states the limit
                rather than rendering a dash that reads as zero growth. */}
            <Kpi n={g.yoy == null ? '—' : `${g.yoy > 0 ? '+' : ''}${Math.round(g.yoy * 100)}%`}
                 l="YoY" s={g.yoy == null ? 'needs 13 months in scope' : 'vs same month last year'}
                 view={fullView} />
          </div>
        </div>

        {/* Order metrics have NO brand dimension -- an order spans brands
            (36% of them do, carrying 64% of value). The brand filter is
            visibly disabled here rather than silently ignored. */}
        <div className="stock-kpi-group da-kpi-orders">
          <div className="stock-kpi-group-head">
            Orders · market and channel only
            {filter.brands.length > 0 && (
              <span className="kpi-note"> — brand filter does not apply: an order spans brands</span>
            )}
          </div>
          <div className="stock-kpi-row">
            <Kpi n={fmtNum(ord.orders)} l="Orders" s="invoices in scope" view={orderView} />
            <Kpi n={ord.aov == null ? '—' : fmtCurrency(ord.aov, currency)} l="Average order value"
                 view={orderView} />
            <Kpi n={ord.basketLines == null ? '—' : ord.basketLines.toFixed(2)} l="Lines per order"
                 s="how many lines an invoice carries" view={orderView} />
            <Kpi n={ord.basketUnits == null ? '—' : ord.basketUnits.toFixed(2)} l="Units per order"
                 view={orderView} />
          </div>
        </div>
      </div>


      <div className="container">

        {/* One grid for every data block on the page, so wide view can
            regroup them into columns instead of stretching each one.
            Two-up at normal width, which is what they already were. */}
        <div className="data-grid">

        {/* Market and channel, always side by side. They are different
            decompositions of the same total, so a reader wants both at
            once; overlaying them in one chart would instead imply a
            comparison between a country and a channel, which means
            nothing. The old Consolidated / By market / By channel toggle
            is gone -- three modes to reach a view that fits on screen
            anyway was a control standing in for a layout. */}
          {[['country', 'By market'], ['channel', 'By channel']].map(([dim, label]) => {
            const sr = buildSeries(dim, primary);
            const altSr = secondary ? buildSeries(dim, secondary) : null;
            return (
              <div className={`chart-card da-chart-${dim}` + filtMark} key={dim}>
                <div className="chart-title-row">
                  <div className="chart-title">
                    {primary === 'revenue' ? 'Revenue' : 'Units'} · {label}
                    {zoomOn && <span className="chart-title-note"> · by day</span>}
                  </div>
                  {selectedItem && (
                    <button className="btn-toggle active" style={{ marginLeft: 'auto' }}
                            title="Back to all items"
                            onClick={() => setSelectedItem(null)}>
                      {selectedItem} ✕
                    </button>
                  )}
                  {filter.drill && (
                    <div className="seg-toggle" style={{ marginLeft: 'auto' }}>
                      <button className={'btn-toggle' + (zoomed ? ' active' : '')}
                              onClick={() => setZoomed((v) => !v)}
                              title="Replot the drilled month day by day">
                        {zoomed ? 'By month' : 'Zoom in'}
                      </button>
                      <button className="btn-toggle"
                              onClick={() => { setZoomed(false); set({ drill: null }); }}
                              title="Clear the drilled month">
                        Zoom out
                      </button>
                    </div>
                  )}
                </div>
                <SalesTrendChart series={sr.series} keys={sr.keys} title=""
                                 mode={primary === 'revenue' ? 'value' : 'units'}
                                 currency={currency}
                                 labels={zoomOn ? dailyLabels : axisLabels}
                                 hover={hoverIdx} onHover={setHoverIdx} fill={denseLayout}
                                 onPick={zoomOn ? undefined : pickMonth}
                                 picked={!zoomOn && pickedIndex >= 0 ? pickedIndex : undefined}
                                 mirror={buildMirror(dim)}
                                 alt={altSr ? { series: altSr.series, mode: secondary === 'revenue' ? 'value' : 'units' } : undefined} />
              </div>
            );
          })}

        {/* One donut per dimension per active measure. Revenue share and
            unit share genuinely differ -- a market can be a third of the
            money and a fifth of the volume -- and seeing them together is
            the point. Turning a measure off removes its donut AND its
            brand columns, so the control has one meaning everywhere. */}
        {/* Two cards, matching every other two-up section on the page,
            with both measures inside each. Toggling a measure off drops
            its figure rather than collapsing a whole card, so the grid
            never goes lopsided. */}
        <ShareCard dimLabel="market" rows={byCountry} selected={filter.countries}
                   onToggle={(k) => set({ countries: toggleIn(filter.countries, k) })}
                   measures={measures} fmtFor={fmtFor} fmtShortFor={fmtShortFor}
                   className="da-donut-country"
                   bars={denseLayout} />
        <ShareCard dimLabel="channel" rows={byChannel} selected={filter.channels}
                   onToggle={(k) => set({ channels: toggleIn(filter.channels, k) })}
                   measures={measures} fmtFor={fmtFor} fmtShortFor={fmtShortFor}
                   className="da-donut-channel"
                   bars={denseLayout} />

        <div className={'chart-card chart-card--fill da-brand' + filtMark}>
          <div className="chart-title-row">
            <div className="chart-title">Share by brand</div>
            <input className="input" placeholder="Search brands…" value={brandSearch}
                   onChange={(e) => setBrandSearch(e.target.value)} style={{ maxWidth: 200 }} />
          </div>
          {/* The same one-line summary its neighbour carries, so the two
              tables start at the same height AND the reader gets the
              headline before the rows rather than adding up the top of
              the list themselves. */}
          <div className="mix-atrisk">
            <span className="mix-atrisk-value">{brandTop10Share}</span>
            {' of revenue from the top 10 of '}{fmtNum(brandCount)}{' brands'}
          </div>
          <div className="tablewrap tablewrap-fill">
            <table className="fa-table single-header" style={{ width: '100%' }}>
              <thead>
                <tr className="sub-row">
                  <th className="col-name sortable" onClick={() => toggleBrandSort('key')}>Brand{brandArrow('key')}</th>
                  {measures.has('revenue') && (
                    <>
                      <th className="sortable" onClick={() => toggleBrandSort('revenue')}>Revenue{brandArrow('revenue')}</th>
                      <th className="sortable" onClick={() => toggleBrandSort('revenueShare')}>Rev share{brandArrow('revenueShare')}</th>
                    </>
                  )}
                  {measures.has('units') && (
                    <>
                      <th className="sortable" onClick={() => toggleBrandSort('units')}>Units{brandArrow('units')}</th>
                      <th className="sortable" onClick={() => toggleBrandSort('unitShare')}>Unit share{brandArrow('unitShare')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {brandList.map((b) => {
                  const on = filter.brands.includes(b.key);
                  return (
                    <tr key={b.key} className={'item-row' + (on ? ' selected' : '')}
                        style={{ cursor: 'pointer' }}
                        onClick={() => set({ brands: toggleIn(filter.brands, b.key) })}>
                      <td className="col-name">{b.key}</td>
                      {measures.has('revenue') && (
                        <>
                          <td>{fmtCurrency(b.revenue, currency)}</td>
                          <td>{b.revenueShare == null ? '—' : `${(b.revenueShare * 100).toFixed(1)}%`}</td>
                        </>
                      )}
                      {measures.has('units') && (
                        <>
                          <td>{fmtNum(b.units)}</td>
                          <td>{b.unitShare == null ? '—' : `${(b.unitShare * 100).toFixed(1)}%`}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className={'chart-card chart-card--fill da-cust' + filtMark}>
      <div className="chart-title">Customer concentration · {custPeriodLabel}</div>
          {/* The panel honours every dimension, item included, so it
              states all of them -- the period is in the title above. */}
          <div className="chart-title-scope">{custParts.brands} · {custParts.markets} · {custParts.item}</div>
          {!cust ? <div className="chart-empty">Loading…</div> : (
            <>
              <div className="mix-atrisk">
                <span className="mix-atrisk-value">
                  {cust.total_revenue > 0
                    // The top TEN explicitly, not "whatever rows came back":
                    // the list is fifty deep now, and summing what was fetched
                    // would quietly change what this sentence means the next
                    // time the limit moved.
                    ? `${Math.round(cust.customers.slice(0, 10).reduce((s, c) => s + Number(c.revenue), 0) / cust.total_revenue * 100)}%`
                    : '—'}
                </span>
                {' of revenue from the top 10 of '}{fmtNum(cust.customer_count)}{' customers'}
              </div>
              {/* With a brand filter on, every figure above is that
                  brand's. The line below says the same thing for the
                  whole business over the same period, so a brand's big
                  account is not mistaken for a big account. */}
              {custGlobal && cust.global_total_revenue > 0 && (
                <div className="mix-atrisk mix-atrisk--sub">
                  {fmtCurrency(cust.global_total_revenue, currency)}
                  {' across all brands, from '}{fmtNum(cust.global_customer_count)}
                  {' customers over '}{fmtNum(cust.global_total_orders)}{' orders — '}
                  {/* A single SKU is routinely a fraction of a percent of
                      the whole business, and rounding that to "0%" reads
                      as a broken figure rather than a small one. */}
                  {(() => {
                    const p = cust.total_revenue / cust.global_total_revenue * 100;
                    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
                  })()}
                  {' of it this selection'}
                </div>
              )}
              <div className="tablewrap tablewrap-fill">
                <table className="fa-table single-header" style={{ width: '100%' }}>
                  <thead>
                    {/* Revenue and Orders are the CURRENT scope; Power and
                        Biggest order span the whole live ERP feed. That mix
                        is the point -- filtered performance read against a
                        fixed score -- but it is not self-evident, so the
                        two whole-feed columns say so. */}
                    <tr className="sub-row">
                      <th className="col-name sortable" onClick={() => toggleCustSort('customer')}>Customer{custArrow('customer')}</th>
                      <th className="sortable" onClick={() => toggleCustSort('revenue')}>Revenue{custArrow('revenue')}</th>
                      <th className="sortable" onClick={() => toggleCustSort('orders')}>Orders{custArrow('orders')}</th>
                      <th className="sortable" onClick={() => toggleCustSort('power')}
                          title="Whole live ERP feed: their average order against their channel's average order">
                        Power{custArrow('power')}
                      </th>
                      <th className="sortable" onClick={() => toggleCustSort('best_order')}
                          title="Whole live ERP feed: the largest single order they have placed">
                        Biggest order{custArrow('best_order')}
                      </th>
                      {/* The all-brand pair. Revenue alone answered "is
                          this a big account", but not "do they buy
                          often" -- one AED 900k order and ninety small
                          ones look identical in a revenue column, and
                          they are entirely different accounts. */}
                      {custGlobal && (
                        <th className="sortable" onClick={() => toggleCustSort('global_revenue')}
                            title="Revenue with us across all brands, over the period and markets in scope">
                          All-brand rev{custArrow('global_revenue')}
                        </th>
                      )}
                      {custGlobal && (
                        <th className="sortable" onClick={() => toggleCustSort('global_orders')}
                            title="Invoices with us across all brands, over the period and markets in scope">
                          All-brand orders{custArrow('global_orders')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {custRows.map((c) => (
                      <tr key={c.customer} className="item-row">
                        <td className="col-name">{c.customer}</td>
                        <td>{fmtCurrency(Number(c.revenue), currency)}</td>
                        <td>{fmtNum(c.orders)}</td>
                        {/* The dot says WHICH average the score is against,
                            in the same colour that channel wears everywhere
                            else -- the baseline is per row, so a single
                            footnote could not tell you which applied. One
                            order in the whole feed proves capacity but not
                            habit, so
                            those scores are dimmed rather than hidden. */}
                        <td className={'cust-power'
                          + (c.lifetime_orders === 1 ? ' cust-power--thin' : '')}>
                          {c.power == null ? '' : (
                            <>
                              <span className={'dot dot-' + String(c.channel || '').toLowerCase()}
                                    title={c.channel && cust.channel_aov?.[c.channel]
                                      ? `vs ${c.channel} average order, `
                                        + fmtCurrency(cust.channel_aov[c.channel], currency)
                                      : undefined} />
                              {`${c.power.toFixed(1)}\u00d7`}
                            </>
                          )}
                        </td>
                        <td>{c.best_order == null ? ''
                          : fmtCurrency(Number(c.best_order), currency)}</td>
                        {custGlobal && (
                          <td>{c.global_revenue == null ? ''
                            : fmtCurrency(Number(c.global_revenue), currency)}</td>
                        )}
                        {custGlobal && (
                          <td>{c.global_orders == null ? '' : fmtNum(c.global_orders)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>


        <ItemsTable
          items={items} itemData={itemData} loading={itemsLoading}
          excluded={excludedBrands} onToggleExcluded={toggleExcluded}
          allBrands={itemBrands} showAll={showAllItems} onShowAll={setShowAllItems}
          onSort={toggleItemSort} arrow={itemArrow}
          months={visibleMonths} currency={currency}
          selected={selectedItem} onSelect={setSelectedItem}
          className={'chart-card da-items' + filtMark} />
        </div>
      </div>
    </>
  );
}

