import { useCallback, useMemo, useState } from 'react';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { getSalesBaskets } from '../../lib/api.js';
import { fmtNum } from '../../lib/format.js';
import { matchQuery } from '../../lib/searchMatch.js';
import BasketToolbar from './BasketToolbar.jsx';
import BasketTable from './BasketTable.jsx';
import {
  buildBaskets, computeAffinity, COL_INFO, AFFINITY_COLS,
  GAP_DEFAULT, ITEM,
} from './basketData.js';

const LIMIT = 500;
// One shared empty array rather than `?? []` at each use: a fresh []
// every render is a new identity, which invalidates every memo below it
// and re-pairs 80,000 tuples on renders that changed nothing.
const NONE = [];
const INFO_KEYS = ['count', 'na', 'nb', 'support', 'confAB', 'confBA', 'lift', 'jaccard'];
const INFO_LABEL = {
  count: 'n(A&B)', na: 'n(A)', nb: 'n(B)', support: 'Support',
  confAB: 'Confidence A>B', confBA: 'Confidence B>A', lift: 'Lift', jaccard: 'Jaccard',
};

function InfoPanel({ onClose }) {
  return (
    <div className="bk-info">
      <div className="bk-info-head">
        <span>What these columns mean (header tooltips are active while this is open)</span>
        <button className="btn-toggle" onClick={onClose}>Close</button>
      </div>
      <div className="bk-info-grid">
        {INFO_KEYS.map((k) => (
          <div className="bk-info-card" key={k}>
            <div className="bk-info-metric">{INFO_LABEL[k]}</div>
            <div className="bk-info-meaning">{COL_INFO[k].meaning}</div>
            <div className="bk-info-line"><strong>Answers:</strong> {COL_INFO[k].question}</div>
            <div className="bk-info-line"><strong>Use it:</strong> {COL_INFO[k].use}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BasketPage() {
  // Fetched once and paired in memory. See the endpoint's docstring for
  // why the server does not compute the affinity itself.
  const { data, loading, error } = useAsyncData(() => getSalesBaskets(), [],
    { cacheKey: 'sales-baskets' });

  const [gap, setGap] = useState(GAP_DEFAULT);
  // Distribution off by default: a dealer restock is replenishment, not
  // a shopping basket, and its hundreds of lines would swamp every pair
  // count with "things that appear on big orders together".
  const [channels, setChannels] = useState(['Showroom', 'Ecommerce']);
  const [brand, setBrand] = useState('');
  // Five, not the three this was ported with. Lift is (cnt * total) /
  // (na * nb), so at a count of 3 it swings wildly -- and lift is the
  // default sort, which put the least reliable rows on top of the first
  // screen anyone saw.
  const [minCount, setMinCount] = useState(5);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [sort, setSort] = useState({ key: 'lift', dir: 'desc' });
  const [showInfo, setShowInfo] = useState(false);
  const [colVis, setColVis] = useState(() => new Set(AFFINITY_COLS.map((c) => c.key)));

  const meta = data?.items ?? NONE;
  const rows = data?.rows ?? NONE;
  const chanNames = data?.channels ?? NONE;

  const brandOf = useCallback((i) => (meta[i] ? meta[i][2] : null), [meta]);
  const brands = useMemo(
    () => [...new Set(meta.map((m) => m[2]).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [meta]);

  // Channel names come back as a dictionary, so the selection is
  // translated to indices once rather than per row.
  const channelsOn = useMemo(
    () => new Set(chanNames.map((c, i) => [c, i]).filter(([c]) => channels.includes(c)).map(([, i]) => i)),
    [chanNames, channels]);

  const baskets = useMemo(
    () => buildBaskets(rows, gap, channelsOn), [rows, gap, channelsOn]);
  const affinity = useMemo(
    () => computeAffinity(baskets, { brandOf, brand: brand || null, minCount }),
    [baskets, brandOf, brand, minCount]);

  // Item A / Item B searches, symmetric: a pair passes if one item
  // matches A and the other matches B, in either orientation. A matched
  // pair is reoriented so the A-search item sits in column A, with
  // na/nb and the two confidences swapped to stay correct.
  const displayRows = useMemo(() => {
    const qa = searchA.trim().toLowerCase();
    const qb = searchB.trim().toLowerCase();
    if (!qa && !qb) return affinity.rows;
    const m = (i, q) => matchQuery(`${meta[i]?.[0] || ''}\n${meta[i]?.[1] || ''}`, q);
    const out = [];
    for (const r of affinity.rows) {
      if (m(r.a, qa) && m(r.b, qb)) out.push(r);
      else if (m(r.b, qa) && m(r.a, qb)) {
        out.push({ ...r, a: r.b, b: r.a, na: r.nb, nb: r.na, confAB: r.confBA, confBA: r.confAB });
      }
    }
    return out;
  }, [affinity, searchA, searchB, meta]);

  const toggleChannel = useCallback((c) => setChannels(
    (cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c])), []);
  const toggleCol = useCallback((key) => setColVis((cur) => {
    const n = new Set(cur);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  }), []);

  const itemsInScope = useMemo(() => {
    if (!brand) return null;
    return new Set(rows.filter((r) => brandOf(r[ITEM]) === brand).map((r) => r[ITEM])).size;
  }, [rows, brand, brandOf]);

  return (
    <>
      <div className="container page-head">
        <h1>Baskets</h1>
        <p className="page-sub">
          What sells together. A basket is one customer session — a run of purchases with no
          gap longer than the selected silence — so the gap control changes the claim, from
          &ldquo;on one invoice&rdquo; to &ldquo;in one shopping period&rdquo;.
        </p>
      </div>

      <div className="container">
      <BasketToolbar
        gap={gap} setGap={setGap}
        channels={channels} toggleChannel={toggleChannel}
        brand={brand} setBrand={setBrand} brands={brands}
        minCount={minCount} setMinCount={setMinCount}
        searchA={searchA} setSearchA={setSearchA}
        searchB={searchB} setSearchB={setSearchB}
        colVis={[...colVis]} toggleCol={toggleCol} />

      <div className="bk-stats">
        <span><strong>{fmtNum(affinity.totalBaskets)}</strong> baskets with two or more items</span>
        <span><strong>{fmtNum(affinity.pairsFound)}</strong> pairs at ≥{minCount}</span>
        {/* Brand scope narrows the DENOMINATORS as well as the rows, so
            support and lift are "within this brand" and are not
            comparable with the unfiltered figures. Said out loud
            because nothing about the numbers themselves shows it. */}
        <span>{brand
          ? `${brand} only — ${fmtNum(itemsInScope)} items, and support/lift are within this brand`
          : 'All brands'}</span>
        {affinity.skippedHuge > 0 && (
          <span className="bk-note">
            {fmtNum(affinity.skippedHuge)} basket{affinity.skippedHuge === 1 ? '' : 's'} over 250 items
            excluded entirely
          </span>
        )}
      </div>

      <div className="chart-card">
        <div className="chart-title-row">
          <div className="chart-title">
            Item pairs
            <span className="chart-title-note">
              {' · '}{fmtNum(displayRows.length)}
              {displayRows.length > LIMIT ? ` — showing top ${LIMIT}` : ''}
            </span>
          </div>
          <button className="btn-toggle" style={{ marginLeft: 'auto' }}
                  onClick={() => setShowInfo((v) => !v)}>
            {showInfo ? 'Hide guide' : 'Column guide'}
          </button>
        </div>

        {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}

        {loading && <div className="chart-empty">Loading sales…</div>}
        {error && <div className="chart-empty">Error: {String(error)}</div>}
        {!loading && !error && (
          <BasketTable rows={displayRows} meta={meta} sort={sort} setSort={setSort}
                       limit={LIMIT} showTips={showInfo} colVis={colVis} />
        )}
      </div>
      </div>
    </>
  );
}
