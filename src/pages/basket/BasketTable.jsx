import { useMemo } from 'react';
import { AFFINITY_COLS, COL_INFO } from './basketData.js';
import { fmtNum } from '../../lib/format.js';

const pct = (v) => (v * 100).toFixed(v < 0.1 ? 2 : 1) + '%';
const fmtCell = (v, kind) => (kind === 'int' ? fmtNum(v)
  : kind === 'x' ? v.toFixed(1) + '×' : pct(v));

function ItemCell({ idx, meta }) {
  const m = meta[idx] || [];
  return (
    <td className="bk-item">
      <div className="bk-item-code">{m[0]}</div>
      <div className="bk-item-name" title={m[1]}>{m[2] ? m[2] + ' · ' : ''}{m[1] || ''}</div>
    </td>
  );
}

const infoTitle = (key) => {
  const i = COL_INFO[key];
  return i ? `${i.meaning}\n\nAnswers: ${i.question}\nUse: ${i.use}` : undefined;
};

export default function BasketTable({ rows, meta, sort, setSort, limit, showTips, colVis }) {
  const cols = useMemo(() => AFFINITY_COLS.filter((c) => colVis.has(c.key)), [colVis]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    return [...rows].sort((x, y) => {
      const a = x[key], b = y[key];
      return (dir === 'asc' ? 1 : -1) * (a - b);
    });
  }, [rows, sort]);

  const shown = sorted.slice(0, limit);

  const onSort = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');

  const head = (key, label, cls) => (
    <th className={(cls || '') + ' sortable'}
        title={showTips ? infoTitle(key) : undefined}
        onClick={() => onSort(key)}>{label}{arrow(key)}</th>
  );

  return (
    <div className="tablewrap">
      <table className="fa-table single-header bk-table">
        <thead>
          <tr className="sub-row">
            <th className="col-name">Item A</th>
            <th className="col-name">Item B</th>
            {cols.map((c) => head(c.key, c.label))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr><td colSpan={2 + cols.length} className="chart-empty">
              No pairs meet the current filters.
            </td></tr>
          )}
          {shown.map((r) => (
            <tr key={r.a + '|' + r.b} className="item-row">
              <ItemCell idx={r.a} meta={meta} />
              <ItemCell idx={r.b} meta={meta} />
              {cols.map((c) => (
                <td key={c.key}>{fmtCell(r[c.key], c.kind)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
