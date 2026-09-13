import { useMeta } from '../app/MetaProvider.jsx';
import { fmtAge } from '../lib/freshness.js';
import { fmtDateTimeLocal } from '../lib/format.js';

const DOT = { fresh: 'ok', stale: 'bad', partial: 'warn', unknown: 'unknown' };
const LABEL = { fresh: 'Data', stale: 'Stale', partial: 'Partial', unknown: 'Data' };

/**
 * States whether last night's pull worked, in the header where it's seen
 * without being looked for. A timestamp alone makes the reader do date
 * arithmetic to notice a missed run, so the dot carries the verdict and
 * the age carries the detail.
 */
export default function FreshnessBadge() {
  const { freshness } = useMeta();
  const { state, ageHours, coreLoad, detail } = freshness;
  const stamp = fmtDateTimeLocal(coreLoad);

  return (
    <span
      className={'freshness-badge is-' + state}
      title={stamp ? `${detail}\nLast successful pull: ${stamp}` : detail}
    >
      <span className={'fresh-dot fresh-dot--' + DOT[state]} aria-hidden="true" />
      <span className="fresh-label">{LABEL[state]}</span>
      <span className="fresh-age">{state === 'unknown' ? 'unverified' : fmtAge(ageHours)}</span>
    </span>
  );
}
