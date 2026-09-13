// Pure logic for the Forecast Accuracy page -- sibling to
// ForecastAccuracyPage.jsx per CONTEXT.md's convention.
//
// Scoring itself happens server-side (shared/forecast_snapshots.py), since
// it needs the sales window. What lives here is presentation logic: how a
// score is worded, and how the Forecast Value Add verdict is framed.

/** Horizon progress as a 0-1 fraction. A committed snapshot isn't
 * scoreable until its horizon closes, but it isn't opaque either -- this
 * drives the "50% through, 30% of forecast sold" in-flight read, which is
 * the part that can still be acted on. */
export function horizonProgress(score) {
  if (!score) return 0;
  const start = new Date(score.window_start).getTime();
  const end = new Date(score.window_end).getTime();
  const now = new Date(score.measured_through).getTime();
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

/** Who forecast more accurately, in plain words.
 *
 * Deliberately refuses to answer when nothing was overridden: with no
 * overrides the manager's position IS the model's, so any "winner" would
 * be an artefact of comparing a number to itself. Forecast Value Add is
 * only meaningful over lines where a human actually made a different
 * claim. */
export function fvaVerdict(score) {
  if (!score || !score.matured) return null;
  if (!score.override_count) {
    return { tone: 'info', text: 'No overrides — the model stood unchallenged.' };
  }
  const { manager_wins: mgr, model_wins: mdl, ties } = score;
  if (mgr > mdl) {
    return { tone: 'steady', text: `Your overrides beat the model on ${mgr} of ${score.override_count} lines.` };
  }
  if (mdl > mgr) {
    return { tone: 'crit', text: `The model beat your overrides on ${mdl} of ${score.override_count} lines.` };
  }
  return { tone: 'caution', text: `Even — ${mgr} each, ${ties} tied.` };
}

/** Lower MAE is better, so an improvement is a REDUCTION. Returned as a
 * signed percentage where positive means the override helped. */
export function maeImprovement(score) {
  if (!score || !score.model_mae) return null;
  return ((score.model_mae - score.manager_mae) / score.model_mae) * 100;
}

/** Bias reads as over- or under-forecasting, which have opposite fixes --
 * MAE alone can't distinguish them, so it's always shown alongside. */
export function biasLabel(bias) {
  if (bias == null) return '—';
  if (Math.abs(bias) < 0.05) return 'balanced';
  return bias > 0 ? `over by ${bias.toFixed(2)}/line` : `under by ${Math.abs(bias).toFixed(2)}/line`;
}

export function fmtWindow(score) {
  if (!score) return '';
  const d = (s) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${d(score.window_start)} → ${d(score.window_end)}`;
}
