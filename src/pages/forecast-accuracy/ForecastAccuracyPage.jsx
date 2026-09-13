import { useEffect, useMemo, useState } from 'react';
import {
  getForecastSnapshots, getForecastSnapshot, captureModelBaseline, discardForecastDraft,
} from '../../lib/api.js';
import { fmtNum, fmtDateTimeLocal } from '../../lib/format.js';
import { horizonProgress, fvaVerdict, maeImprovement, biasLabel, fmtWindow } from './accuracyData.js';

/** Retrospective only -- adjusting a forecast happens on Forecast
 * Analytics, where the evidence that justifies an override (velocity,
 * trend, stock, sales history) is on screen. This page answers a
 * different question, at a different cadence: was the judgement any good?
 *
 * Drafts are listed here despite being committed elsewhere, because this
 * is the one page that's ABOUT snapshots -- an open draft is invisible on
 * Forecast Analytics unless you happen to navigate back to that brand,
 * which is how a half-finished review goes stale for a month unnoticed. */
export default function ForecastAccuracyPage() {
  const [snapshots, setSnapshots] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Two-step rather than a modal: discarding a draft is irreversible
  // and the confirm belongs next to the button that does it.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function discardDraft(id) {
    setDiscarding(true);
    try {
      await discardForecastDraft(id);
      setSelectedId(null);
      setConfirmDiscard(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscarding(false);
    }
  }

  async function captureBaseline() {
    setCapturing(true);
    setCaptureError(null);
    try {
      await captureModelBaseline();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setCaptureError(err.message);
    } finally {
      setCapturing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getForecastSnapshots();
        if (!cancelled) setSnapshots(d.snapshots);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDetail(null);
      setConfirmDiscard(false);
      if (!selectedId) return;
      setDetailLoading(true);
      try {
        const d = await getForecastSnapshot(selectedId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const drafts = useMemo(() => (snapshots || []).filter((s) => s.status === 'draft'), [snapshots]);
  // brand === null marks a catalogue-wide model baseline. Listed apart
  // from the brand reviews because they answer different questions -- "is
  // the model any good?" against "were our decisions good?" -- and a
  // handful of human reviews would otherwise be buried among machine runs.
  const committed = useMemo(
    () => (snapshots || []).filter((s) => s.status === 'committed' && s.brand),
    [snapshots]);
  const baselines = useMemo(
    () => (snapshots || []).filter((s) => s.status === 'committed' && !s.brand),
    [snapshots]);

  if (error) return <div className="page-error">Error loading snapshots: {error}</div>;

  const score = detail?.score;
  const verdict = fvaVerdict(score);
  const improvement = maeImprovement(score);

  return (
    <>
      <div className="container page-head">
        <p className="page-eyebrow">Forecast accuracy</p>
        <div className="hero-row">
          <div className="hero-metric">
            <p className="hero-figure accent">{snapshots ? fmtNum(committed.length) : '—'}</p>
            <p className="hero-label">committed snapshot{committed.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <p className="hero-note">
          A snapshot freezes what was forecast for a brand at a moment in time, so it can be scored
          against what actually sold. Both the model&#39;s forecast and your overrides are kept, which is
          what makes &ldquo;does the override actually help?&rdquo; a measured question rather than an
          assumed one. Forecasts are adjusted on <strong>Forecast Analytics</strong>; this page is
          purely the retrospective.
        </p>
      </div>

      {!snapshots && <div className="page-loading">Loading snapshots&hellip;</div>}

      {snapshots && !snapshots.length && (
        <div className="container">
          <div className="chart-empty" style={{ padding: 'var(--s7) 0' }}>
            No snapshots yet. Open a brand on Forecast Analytics and click &ldquo;Start forecast review&rdquo;
            to record one — accuracy can only be measured forward from the moment you start.
          </div>
        </div>
      )}

      <div className="container toolbar" style={{ paddingTop: 0 }}>
        <button className="btn-toggle" onClick={captureBaseline} disabled={capturing}>
          {capturing ? 'Capturing…' : 'Capture model baseline'}
        </button>
        {/* Deliberately manual and deliberately infrequent. Accuracy needs
            a CONSISTENT series, not a dense one -- a 3-month forecast
            recaptured nightly would give 90 overlapping predictions of
            nearly the same window, which is redundancy rather than data.
            Quarterly, aligned to the review cycle, is the intended rhythm. */}
        <span className="review-count">
          {capturing
            ? 'Freezing the model at 3, 6 and 12 months — takes about two minutes'
            : 'Freezes the model at 3, 6 and 12 months (one per velocity tier)'}
        </span>
        {captureError && <span className="page-error">{captureError}</span>}
      </div>

      {snapshots && snapshots.length > 0 && (
        <div className="container stock-layout">
          <div className="stock-brand-panel">
            <div className="stock-brand-panel-head">
              <span>Snapshots</span>
              <span>{fmtNum(snapshots.length)}</span>
            </div>
            {/* Three groups, each labelled with what it holds and how
                many. Model baselines and brand reviews answer different
                questions -- "is the model any good?" against "were our
                decisions any good?" -- and read as one undifferentiated
                list they invite comparing a machine run to a human one. */}
            <div className="stock-brand-list">
              <SnapshotGroup
                title="Open drafts" note="not yet committed — nothing is being measured"
                rows={drafts} selectedId={selectedId} onSelect={setSelectedId} />
              <SnapshotGroup
                title="Brand reviews" note="model forecast plus your overrides"
                rows={committed} selectedId={selectedId} onSelect={setSelectedId} />
              <SnapshotGroup
                title="Model baselines" note="whole catalogue, no human input"
                rows={baselines} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>

          <div className="stock-right">
            {!selectedId && (
              <div className="chart-empty" style={{ padding: 'var(--s7) 0' }}>
                Select a snapshot to see how its forecast held up.
              </div>
            )}
            {detailLoading && <div className="page-loading">Loading snapshot&hellip;</div>}

            {detail && detail.snapshot.status === 'draft' && (
              <DraftPanel
                draft={detail.snapshot}
                onDiscard={() => discardDraft(detail.snapshot.id)}
                confirming={confirmDiscard}
                onAskConfirm={setConfirmDiscard}
                busy={discarding} />
            )}

            {detail && score && (
              <>
                <div className="stock-kpi-row">
                  <div className="stock-kpi-tile">
                    <span className="stock-kpi-num">{score.model_mae}</span>
                    <span className="stock-kpi-label">Model MAE</span>
                    <span className="stock-kpi-sub">{biasLabel(score.model_bias)}</span>
                  </div>
                  <div className="stock-kpi-tile">
                    <span className="stock-kpi-num" style={{ color: improvement > 0 ? 'var(--steady)' : improvement < 0 ? 'var(--crit)' : undefined }}>
                      {score.manager_mae}
                    </span>
                    <span className="stock-kpi-label">With your overrides</span>
                    <span className="stock-kpi-sub">{biasLabel(score.manager_bias)}</span>
                  </div>
                  <div className="stock-kpi-tile">
                    <span className="stock-kpi-num">{fmtNum(score.override_count)}</span>
                    <span className="stock-kpi-label">Overrides</span>
                    <span className="stock-kpi-sub">of {fmtNum(score.line_count)} lines</span>
                  </div>
                  <div className="stock-kpi-tile">
                    <span className="stock-kpi-num">{Math.round(horizonProgress(score) * 100)}%</span>
                    <span className="stock-kpi-label">Horizon elapsed</span>
                    <span className="stock-kpi-sub">{fmtWindow(score)}</span>
                  </div>
                </div>

                {score.by_method && score.by_method.length > 0 && (
                  <div className="chart-card">
                    <div className="chart-title">Accuracy by velocity method</div>
                    {/* WAPE, not MAE, is the comparable column. The trust
                        gates admit Holt's only on dense sellers, so it runs
                        on items forecasting 13-18x the volume the fallback
                        sees -- a bigger absolute error on a bigger number
                        is not a worse forecast, and no amount of elapsed
                        time fixes that. Read MAE down a row over time;
                        read WAPE across rows. */}
                    <div className="tablewrap">
                      <table className="fa-table single-header" style={{ width: '100%' }}>
                        <thead>
                          <tr className="sub-row">
                            <th className="col-name">Method</th>
                            <th>Lines</th>
                            <th title="Total error divided by total actual units. Comparable ACROSS methods, unlike MAE.">WAPE</th>
                            <th title="Mean absolute error in units. Track one method over time; do not compare methods on this.">MAE</th>
                            <th>Bias</th>
                            <th>Actual units</th>
                          </tr>
                        </thead>
                        <tbody>
                          {score.by_method.map((m) => (
                            <tr key={m.method} className="item-row">
                              <td className="col-name">{m.method}</td>
                              <td>{fmtNum(m.lines)}</td>
                              <td>{m.wape == null ? <span className="no-data">&mdash;</span> : `${Math.round(m.wape * 100)}%`}</td>
                              <td>{m.mae}</td>
                              <td>{m.bias > 0 ? `+${m.bias}` : m.bias}</td>
                              <td>{fmtNum(m.actual_units)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!score.matured && (
                  // Provisional, and said so plainly -- a partial-window
                  // number read as final is worse than no number.
                  <div className="chart-card">
                    <div className="chart-title">Provisional</div>
                    <p className="hero-note" style={{ marginTop: 'var(--s2)' }}>
                      The horizon hasn&#39;t closed yet, so these figures are in-flight: actuals are only
                      counted through {fmtDateTimeLocal(score.measured_through)}. Forecast error will keep
                      shrinking as sales land — read this as &ldquo;tracking ahead/behind&rdquo;, not as a score.
                    </p>
                  </div>
                )}

                {verdict && (
                  <div className="chart-card">
                    <div className="chart-title">Forecast value add</div>
                    <p className={'fva-verdict fva-verdict--' + verdict.tone}>{verdict.text}</p>
                    {improvement != null && score.override_count > 0 && (
                      <p className="hero-note" style={{ marginTop: 'var(--s2)' }}>
                        Mean absolute error {improvement > 0 ? 'fell' : 'rose'} by {Math.abs(improvement).toFixed(1)}%
                        {' '}against the model&#39;s own forecast.
                      </p>
                    )}
                  </div>
                )}

                <div className="tablewrap">
                  <table className="fa-table single-header" style={{ tableLayout: 'auto', width: '100%' }}>
                    <thead>
                      <tr className="sub-row">
                        <th className="col-code">Code</th>
                        <th className="col-name">Item</th>
                        <th>Country</th>
                        <th>Model</th>
                        <th>Yours</th>
                        <th>Actual</th>
                        <th>Model err</th>
                        <th>Your err</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.lines
                        .slice()
                        // Overridden lines first, then biggest misses --
                        // this table exists to explain the verdict above,
                        // and untouched lines can't contribute to it.
                        .sort((a, b) => (
                          (b.manager_forecast != null) - (a.manager_forecast != null)
                          || Math.abs(b.model_error) - Math.abs(a.model_error)
                        ))
                        .slice(0, 200)
                        .map((l) => (
                          <tr key={l.item_code + l.country} className={'item-row' + (l.manager_forecast != null ? ' selected-row' : '')}>
                            <td className="col-code">{l.item_code}</td>
                            <td className="col-name" title={l.item_name}>{l.item_name}</td>
                            <td>{l.country}</td>
                            <td>{fmtNum(l.model_forecast)}</td>
                            <td>{l.manager_forecast == null ? <span className="no-data">&mdash;</span> : <b>{fmtNum(l.manager_forecast)}</b>}</td>
                            <td>{fmtNum(l.actual)}</td>
                            <td className={l.model_error > 0 ? 'neg' : ''}>{l.model_error > 0 ? '+' : ''}{l.model_error}</td>
                            <td className={l.manager_error > 0 ? 'neg' : ''}>{l.manager_error > 0 ? '+' : ''}{l.manager_error}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** A titled run of snapshot rows, or nothing when the group is empty.
 *
 * The note under each title says what the group IS rather than leaving
 * the reader to infer it from the rows -- "model only" on a row is easy
 * to miss when every neighbouring row looks the same. */
function SnapshotGroup({ title, note, rows, selectedId, onSelect }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="snap-group-head">
        <span className="snap-group-title">{title}</span>
        <span className="snap-group-count">{fmtNum(rows.length)}</span>
        <span className="snap-group-note">{note}</span>
      </div>
      {rows.map((s) => (
        <SnapshotRow key={s.id} s={s} selected={s.id === selectedId}
                     onSelect={() => onSelect(s.id)} />
      ))}
    </>
  );
}

/** What is actually sitting in an open draft.
 *
 * The previous version reported a count and nothing else, which told the
 * reader that something was unfinished without telling them what -- and
 * a draft with zero overrides looked identical to one carrying real
 * judgement. Both the lines and the empty case are named here, because
 * "started and abandoned" and "half-reviewed" call for different
 * actions. */
function DraftPanel({ draft, onDiscard, confirming, onAskConfirm, busy }) {
  const lines = draft.lines || [];
  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <div className="chart-title">Draft · {draft.brand}</div>
        <div className="seg-toggle" style={{ marginLeft: 'auto' }}>
          {confirming ? (
            <>
              <button className="btn-toggle btn-danger" onClick={onDiscard} disabled={busy}>
                {busy ? 'Discarding…' : `Discard ${fmtNum(lines.length)} override${lines.length === 1 ? '' : 's'}`}
              </button>
              <button className="btn-toggle" onClick={() => onAskConfirm(false)} disabled={busy}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn-toggle" onClick={() => onAskConfirm(true)}>
              Discard draft
            </button>
          )}
        </div>
      </div>

      <p className="hero-note" style={{ marginTop: 'var(--s2)' }}>
        Opened {fmtDateTimeLocal(draft.created_at)}{draft.created_by ? ` by ${draft.created_by}` : ''}.
        Nothing is being measured yet — committing it on <strong>Forecast Analytics</strong> locks
        these numbers and starts the {draft.horizon_months}-month clock.
      </p>

      {lines.length === 0 ? (
        // The case the old panel could not distinguish: a review that was
        // started and then abandoned before a single judgement was made.
        <div className="chart-empty" style={{ padding: 'var(--s5) 0' }}>
          No overrides recorded. This draft was started but nothing was changed,
          so discarding it loses nothing.
        </div>
      ) : (
        <div className="tablewrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="fa-table single-header" style={{ width: '100%' }}>
            <thead>
              <tr className="sub-row">
                <th className="col-code">Code</th>
                <th className="col-name">Item</th>
                <th>Country</th>
                <th title="What the model said when the override was typed">Model then</th>
                <th>Yours</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const base = l.model_forecast_at_override ?? l.model_forecast;
                const delta = base == null || l.manager_forecast == null
                  ? null : l.manager_forecast - base;
                return (
                  <tr key={l.item_code + l.country} className="item-row">
                    <td className="col-code">{l.item_code}</td>
                    <td className="col-name" title={l.item_name}>{l.item_name}</td>
                    <td>{l.country}</td>
                    <td>{base == null ? <span className="no-data">&mdash;</span> : fmtNum(base)}</td>
                    <td><b>{fmtNum(l.manager_forecast)}</b></td>
                    <td className={delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}>
                      {delta == null ? <span className="no-data">&mdash;</span>
                        : `${delta > 0 ? '+' : ''}${fmtNum(delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SnapshotRow({ s, selected, onSelect }) {
  return (
    <button className={'stock-brand-row' + (selected ? ' selected' : '')} onClick={onSelect}>
      <span className="stock-brand-main">
        <span className="stock-brand-name">{s.brand || 'Whole catalogue'}</span>
        <span className="stock-brand-value">
          {s.horizon_months}mo · {s.brand
            ? `${fmtNum(s.override_count)} override${s.override_count === 1 ? '' : 's'}`
            : `${fmtNum(s.line_count)} lines · model only`}
        </span>
        <span className="snap-date">
          {s.status === 'draft'
            ? `opened ${fmtDateTimeLocal(s.created_at)}`
            : `committed ${fmtDateTimeLocal(s.committed_at)}`}
        </span>
      </span>
    </button>
  );
}
