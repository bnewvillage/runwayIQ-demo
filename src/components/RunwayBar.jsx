/**
 * Weeks of stock, drawn as the runway remaining before a SKU runs dry.
 *
 * This is the number the app is named for and the most decision-relevant
 * fact on a row, but as text ("12.4 wks") it can't be scanned down a list
 * of hundreds — every row looks the same until you read it. As a bar, the
 * rows that need attention separate themselves before you read anything.
 *
 * It deliberately flags BOTH failure modes. Running dry is the obvious
 * one. Stock sitting far past the target tick is capital asleep on a
 * shelf, which costs real money and is invisible in every "low stock"
 * indicator that only ever warns downward.
 */
const TARGET_WEEKS = 12;   // cover we aim to hold
const SCALE_WEEKS = 24;    // bar is linear to here, then clamps

// Every real decision lives in the first few weeks. The difference
// between 40 and 60 weeks of cover doesn't change what you order today,
// so the top of the scale is compressed rather than given equal room.
function band(weeks) {
  if (weeks < 2) return 'crit';
  if (weeks < 6) return 'caution';
  if (weeks <= 20) return 'steady';
  return 'over';
}

export default function RunwayBar({ weeks, showValue = true }) {
  if (weeks == null) {
    return <span className="runway-empty" title="No velocity signal, so cover can't be projected">&mdash;</span>;
  }
  const tone = band(weeks);
  const pct = Math.min(100, (weeks / SCALE_WEEKS) * 100);
  const label = weeks > 99 ? '99+' : weeks < 1 ? '<1' : weeks.toFixed(1);
  const title = tone === 'over'
    ? `${label} weeks of cover — well past the ${TARGET_WEEKS}-week target, capital sitting still`
    : `${label} weeks of cover (target ${TARGET_WEEKS})`;

  return (
    <span className="runway" title={title}>
      {/* The track carries the band too, not just the fill: a SKU with
          almost no cover has a near-zero fill, so on a plain grey track
          the most urgent rows would render as the emptiest and read as
          "no data". Tinting the track makes an empty runway unmistakably
          an empty runway. */}
      <span className={'runway-track ' + tone}>
        <span className={'runway-fill ' + tone} style={{ width: `${pct}%` }} />
        <span className="runway-tick" style={{ left: `${(TARGET_WEEKS / SCALE_WEEKS) * 100}%` }} />
      </span>
      {showValue && <span className={'runway-val ' + tone}>{label}w</span>}
    </span>
  );
}
