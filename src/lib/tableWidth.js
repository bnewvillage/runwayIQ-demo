// Measures the pixel width the item-code column needs to fully show the
// longest code in the data (uniform, content-driven) -- same approach as
// purchase_assistant/web's tableWidth.js. Codes must never be clipped:
// a truncated SKU is useless for ordering. Capped so one extreme bundle
// SKU can't blow the column out to something ugly.
let _ctx = null;

export function measureCodeColWidth(codes, { min = 150, max = 392, pad = 28 } = {}) {
  if (!codes || !codes.length) return min;
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  // Must match .fa-table td.col-code's font (IBM Plex Mono 12px). If these
  // two drift apart the column is sized for the wrong metrics and codes
  // clip -- and a truncated SKU can't be ordered against.
  _ctx.font = '400 12px "IBM Plex Mono", ui-monospace, monospace';
  let widest = 0;
  for (const c of codes) {
    const w = _ctx.measureText(c || '').width;
    if (w > widest) widest = w;
  }
  return Math.min(max, Math.max(min, Math.ceil(widest) + pad));
}
