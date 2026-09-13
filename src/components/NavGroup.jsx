import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

/**
 * One dropdown of related pages in the top bar.
 *
 * Nine flat links had outgrown the bar -- they wrapped on a laptop and
 * gave no sense of which tool answered which question. Grouping trades
 * one click for a header that fits and reads.
 *
 * The trigger shows as active when ANY page inside it is open, so the
 * bar still says where you are once the panel is closed. Without that,
 * grouping loses the one thing a flat nav did well.
 */
export default function NavGroup({ label, items, badges = {} }) {
  const ref = useRef(null);
  const { pathname } = useLocation();
  // The panel is open only for the route it was opened on, so
  // navigating closes it by derivation rather than by an effect that
  // sets state after the fact -- which is a cascading render, and the
  // linter is right to refuse it.
  const [openedAt, setOpenedAt] = useState(null);
  const open = openedAt === pathname;
  const setOpen = (next) => setOpenedAt(next ? pathname : null);

  // Close on a click anywhere else, and on Escape -- a panel you can
  // only dismiss by clicking the trigger again is a panel that gets
  // left open.
  useEffect(() => {
    if (!open) return undefined;
    // setOpenedAt, not the setOpen wrapper: the wrapper is a new
    // function every render, so depending on it would tear down and
    // re-add these listeners on each one. The setState function is
    // stable.
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpenedAt(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenedAt(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  const groupBadge = items.reduce((n, i) => n + (badges[i.to] || 0), 0);

  return (
    <div className="nav-group" ref={ref}>
      <button type="button"
              className={'nav-link nav-group-trigger' + (active ? ' active' : '') + (open ? ' is-open' : '')}
              aria-expanded={open} aria-haspopup="true"
              onClick={() => setOpen(!open)}>
        {label}
        {groupBadge > 0 && <span className="nav-badge">{groupBadge}</span>}
        <svg className="nav-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="nav-panel" role="menu">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} role="menuitem"
                     className={({ isActive }) => 'nav-panel-item' + (isActive ? ' active' : '')}>
              <span className="nav-panel-name">
                {i.label}
                {badges[i.to] > 0 && <span className="nav-badge">{badges[i.to]}</span>}
              </span>
              {/* One line saying what the page answers. The whole reason
                  a group is worth the extra click is that it can carry
                  this, where a flat bar could not. */}
              <span className="nav-panel-note">{i.note}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
