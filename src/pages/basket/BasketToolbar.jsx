import { AFFINITY_COLS, GAP_CHOICES } from './basketData.js';

const CHANNEL_LIST = ['Showroom', 'Ecommerce', 'Distribution'];
const MIN_CHOICES = [2, 3, 5, 10];

/** The gap reads as a sentence, not a number: "30d" alone does not say
 *  what it does to a basket, and this control changes what the whole
 *  page is claiming. */
const gapLabel = (g) => (g === null ? 'Per invoice' : g === 0 ? 'Same day' : g + 'd');
const gapTitle = (g) => (g === null
  ? 'One basket per invoice -- the strict reading: bought in one transaction'
  : g === 0
    ? 'One basket per customer per day -- merges two invoices raised on the same visit'
    : `One basket per run of purchases with no gap longer than ${g} days`);

function Toggles({ options, active, onToggle }) {
  return (
    <div className="filtergroup-row">
      {options.map((o) => (
        <button key={o.key} type="button"
                className={'btn-toggle' + (active.includes(o.key) ? ' active' : '')}
                onClick={() => onToggle(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

export default function BasketToolbar({
  gap, setGap, channels, toggleChannel, brand, setBrand, brands,
  minCount, setMinCount, searchA, setSearchA, searchB, setSearchB,
  colVis, toggleCol,
}) {
  return (
    <div className="filterbar">
      <div className="filtergroup">
        <span className="filtergroup-label">Item A</span>
        <input className="bk-search" value={searchA} onChange={(e) => setSearchA(e.target.value)}
               placeholder="Code/name — ,,and //or --excl" />
      </div>
      <div className="filtergroup">
        <span className="filtergroup-label">Item B</span>
        <input className="bk-search" value={searchB} onChange={(e) => setSearchB(e.target.value)}
               placeholder="Code/name — ,,and //or --excl" />
      </div>

      <div className="filtergroup">
        <span className="filtergroup-label">Basket gap</span>
        <div className="filtergroup-row">
          {[null, ...GAP_CHOICES].map((g) => (
            <button key={String(g)} type="button" title={gapTitle(g)}
                    className={'btn-toggle' + (gap === g ? ' active' : '')}
                    onClick={() => setGap(g)}>{gapLabel(g)}</button>
          ))}
        </div>
      </div>

      <div className="filtergroup">
        <span className="filtergroup-label">Channel</span>
        <Toggles options={CHANNEL_LIST.map((c) => ({ key: c, label: c }))}
                 active={channels} onToggle={toggleChannel} />
      </div>

      <div className="filtergroup">
        <span className="filtergroup-label">Brand</span>
        <select className="bk-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="filtergroup">
        <span className="filtergroup-label">Min baskets</span>
        <div className="filtergroup-row">
          {MIN_CHOICES.map((n) => (
            <button key={n} type="button"
                    className={'btn-toggle' + (minCount === n ? ' active' : '')}
                    title={n < 5 ? 'Lift is unstable at low counts' : undefined}
                    onClick={() => setMinCount(n)}>{'≥' + n}</button>
          ))}
        </div>
      </div>

      <div className="filtergroup">
        <span className="filtergroup-label">Columns</span>
        <Toggles options={AFFINITY_COLS.map((c) => ({ key: c.key, label: c.label }))}
                 active={colVis} onToggle={toggleCol} />
      </div>
    </div>
  );
}
