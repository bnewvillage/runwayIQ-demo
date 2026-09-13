import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useTheme } from '../app/ThemeProvider.jsx';
import { useWidth } from '../app/WidthProvider.jsx';
import { useToast } from '../app/ToastProvider.jsx';
import { useMeta } from '../app/MetaProvider.jsx';
import { getMeta, refreshDatabase } from '../lib/api.js';

// How often to re-check whether the pull has landed, and how long to keep
// checking. The run takes minutes; past this we stop claiming to know.
const POLL_MS = 20000;
const GIVE_UP_MS = 30 * 60 * 1000;

export default function OptionsMenu() {
  const { user, signOutUser } = useAuth();
  const { theme, toggle } = useTheme();
  const { wide, toggle: toggleWide } = useWidth();
  const { push } = useToast();
  const { meta, reload } = useMeta();

  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const boxRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setConfirming(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function startRefresh() {
    setConfirming(false);
    setOpen(false);
    setRefreshing(true);

    // Captured before dispatch. Completion is "these markers moved", which
    // is a truer signal than a workflow exit code: it means the data
    // actually landed in the database, not merely that a job finished.
    const before = { core: meta?.core_load ?? null, glance: meta?.demand_glance ?? null };

    try {
      await refreshDatabase();
    } catch (err) {
      setRefreshing(false);
      push({ text: err.message || 'Could not start the refresh.', tone: 'bad', duration: 8000 });
      return;
    }
    push({ text: 'Refresh started — pulling from ERP. This takes a few minutes.', tone: 'info' });

    const deadline = Date.now() + GIVE_UP_MS;
    const poll = async () => {
      let landed = null;
      try {
        const fresh = await getMeta();
        if (fresh.core_load && fresh.core_load !== before.core) landed = fresh;
      } catch { /* transient -- keep waiting */ }

      if (landed) {
        setRefreshing(false);
        reload();
        // The two pipeline steps commit separately, so the load can land
        // while the Demand Glance rebuild does not. Report which moved
        // rather than a blanket success.
        const glanceMoved = landed.demand_glance && landed.demand_glance !== before.glance;
        push({
          text: glanceMoved
            ? 'Refresh complete — ERP data and Demand Glance are both up to date.'
            : 'ERP data updated, but the Demand Glance rebuild has not landed.',
          tone: glanceMoved ? 'good' : 'warn',
          duration: 8000,
        });
        return;
      }

      if (Date.now() > deadline) {
        setRefreshing(false);
        push({
          text: 'Still running after 30 minutes — check the pipeline run on GitHub.',
          tone: 'warn', duration: 10000,
        });
        return;
      }
      timers.current.push(setTimeout(poll, POLL_MS));
    };
    timers.current.push(setTimeout(poll, POLL_MS));
  }

  return (
    <div className="options" ref={boxRef}>
      <button
        className={'options-trigger' + (open ? ' open' : '')}
        onClick={() => { setOpen((o) => !o); setConfirming(false); }}
        aria-haspopup="menu" aria-expanded={open} aria-label="Options"
      >
        <span className="hamburger" aria-hidden="true"><i /><i /><i /></span>
      </button>

      {open && (
        <div className="options-menu" role="menu">
          <div className="options-who" title={user?.email}>{user?.email}</div>

          <button className="options-item" role="menuitem" onClick={toggle}>
            <span>Appearance</span>
            <span className="options-value">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>

          <button className="options-item" role="menuitem" onClick={toggleWide}>
            <span>Content width</span>
            <span className="options-value">{wide ? 'Wide' : 'Standard'}</span>
          </button>

          {!confirming ? (
            <button
              className="options-item" role="menuitem"
              disabled={refreshing}
              onClick={() => setConfirming(true)}
            >
              <span>Refresh database</span>
              <span className="options-value">{refreshing ? 'running…' : 'from ERP'}</span>
            </button>
          ) : (
            <div className="options-confirm">
              {/* pipeline.yml records that the one observed failure was a
                  manual daytime trigger, when the ERP is under business-hours
                  load. Worth one sentence before firing another. */}
              <p>Pull now? The ERP is slower during business hours, and this is the
                 one condition under which the pull has failed before.</p>
              <div className="options-confirm-actions">
                <button className="btn-toggle" onClick={() => setConfirming(false)}>Cancel</button>
                <button className="btn-toggle active" onClick={startRefresh}>Pull now</button>
              </div>
            </div>
          )}

          <button className="options-item options-item--danger" role="menuitem" onClick={signOutUser}>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
