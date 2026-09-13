import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES } from '../../lib/constants.js';
import { BLOCKS, VALUE_COLS } from './forecastData.js';

/**
 * Decides which data blocks the matrix can actually show at the current
 * viewport width, and hands back the ref to measure against.
 *
 * The column widths live here rather than beside the table because the
 * fitter and the <colgroup> have to agree exactly -- if the width this
 * reserves for a block differs from the width the table renders, the drop
 * calculation is quietly wrong and blocks get dropped early or clip late.
 * Co-locating them makes that a shared constant instead of a coincidence.
 */
export const COL_W = { name: 260, unit: 82, velocity: 148, value: 108 };

// Item Name is the one flexible column. Below this it's the same fixed
// width every other column uses; there's no reason for a name to sprawl
// past the point where it's actually reading as more legible.
const NAME_MAX_W = 460;

// A couple of px of slack absorbs sub-pixel column rounding.
const FIT_SLACK = 4;

// Order blocks get dropped in when the viewport can't fit them all --
// least decision-critical first. Demand is absent deliberately: it's the
// entire point of the page and is never dropped, so a narrow window
// scrolls rather than hiding it. Value is ALSO absent, and for the same
// reason: it's not a passive default the way stock/sales/velocity are --
// it's a block the user just explicitly turned on. Having it first in
// this list meant enabling it dropped it again immediately, on any screen
// narrower than ~2344px (i.e. most laptops) -- the "grow past the page
// cap" mechanism only has physical room to work above that width, so
// below it the toggle looked entirely inert. Now it's kept as long as
// possible and the wrapper's existing overflow-x:auto scroll is the
// fallback when even that isn't enough (see the width-not-maxWidth note
// on .fa-table below).
const DROP_ORDER = ['sales', 'stock', 'velocity'];

/** Rendered width of one block, given it spans the three countries plus a
 * Global column (Value is its own fixed set of aggregate columns). */
function blockWidth(key) {
  if (key === 'value') return VALUE_COLS.length * COL_W.value;
  return (key === 'velocity' ? COL_W.velocity : COL_W.unit) * (COUNTRIES.length + 1);
}

/**
 * @param dataBlocks Set of block keys the user asked for -- their intent,
 *   which is preserved: widening the window brings blocks back without
 *   re-toggling anything.
 * @param codeW measured width of the item-code column, which varies with
 *   the longest code currently in view.
 */
export function useFittedBlocks(dataBlocks, codeW) {
  const wrapRef = useRef(null);
  const [availW, setAvailW] = useState(0);

  useEffect(() => {
    // Measured from the container's own content box rather than derived
    // from the viewport minus a hardcoded padding: the gutter is a clamp()
    // that changes with viewport width, so any constant here would be
    // wrong at most sizes.
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
      setAvailW(el.clientWidth - pad - FIT_SLACK);
    };
    // documentElement, not the wrap: a scrollbar appearing or vanishing as
    // content height changes alters usable width without ever resizing the
    // wrap's own box. Observing the wrap directly was tried first and was
    // wrong -- it fired once with a transient narrow reading and never
    // again, leaving availW stuck ~60px short.
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    measure();
    return () => ro.disconnect();
  }, []);

  const fitted = useMemo(() => {
    const desired = BLOCKS.filter((b) => dataBlocks.has(b.key));
    if (!availW) return { blocks: desired, dropped: [], fittedWidth: null, nameW: COL_W.name };

    // Two independent budgets, not one shared pool.
    //
    // Cap 1 -- the normal fit. Stock/Sales/Velocity compete for room
    // against availW exactly as if Value didn't exist; Value's own width
    // is deliberately excluded from this sum so it can never cost one of
    // them its spot. This is what "Value pushed Sales out" was: Value
    // competing in the same pool, meaning turning it on could shrink the
    // budget available to blocks that were already fitting fine.
    const keep = [...desired];
    const droppedLabels = [];
    const valueOn = keep.some((b) => b.key === 'value');
    let capOne = codeW + COL_W.name
      + keep.filter((b) => b.key !== 'value').reduce((s, b) => s + blockWidth(b.key), 0);
    for (const key of DROP_ORDER) {
      if (capOne <= availW) break;
      const i = keep.findIndex((b) => b.key === key);
      if (i === -1) continue;
      capOne -= blockWidth(key);
      droppedLabels.push(keep[i].label);
      keep.splice(i, 1);
    }

    // Cap 2 -- Cap 1 plus Value's own width, added back on top once the
    // base set has already settled. Never a drop candidate, only ever
    // additive: on a wide screen this is what the matrix actually renders
    // at (growing the wrapper past the page's normal measure, same as
    // before); on a narrow one it's wider than the wrapper can offer, and
    // the wrapper's overflow-x:auto scrolls to it -- the base columns stay
    // exactly as fitted under Cap 1 the whole time either way.
    const total = capOne + (valueOn ? blockWidth('value') : 0);

    // Slack (Value off, base content already fits Cap 1 with room left)
    // goes to Item Name rather than sitting as dead margin between the
    // last column and the wrapper's edge. Value being on, or the base set
    // alone already needing the full width, both mean no slack to give.
    const baseContent = total - COL_W.name;
    const hasSlack = availW && total < availW;
    const nameW = hasSlack
      ? Math.min(NAME_MAX_W, availW - baseContent)
      : COL_W.name;
    const finalWidth = hasSlack ? baseContent + nameW : total;

    return { blocks: keep, dropped: droppedLabels, fittedWidth: finalWidth, nameW };
  }, [dataBlocks, availW, codeW]);

  return {
    wrapRef,
    blocks: fitted.blocks,
    dropped: fitted.dropped,
    fittedWidth: fitted.fittedWidth,
    nameW: fitted.nameW,
  };
}
