import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import FreshnessBadge from './FreshnessBadge.jsx';
import OptionsMenu from './OptionsMenu.jsx';
import NavGroup from './NavGroup.jsx';
import { useWidth } from '../app/WidthProvider.jsx';
import { getForecastSnapshots } from '../lib/api.js';

// Grouped, not flat. Nine links wrapped on a laptop and said nothing
// about which tool answered which question.
//
// Overview is deliberately absent: it is the home page, and the mark
// links to it. A nav item for the page the logo already reaches is a
// second control for one destination.
const NAV = [
  {
    label: 'Forecast',
    items: [
      { to: '/demand-glance', label: 'Demand Glance', note: 'What to order, right now' },
      { to: '/demand-forecast', label: 'Demand Forecast', note: 'Whole catalogue, horizon of your choosing' },
      { to: '/forecast', label: 'Forecast Analytics', note: 'Run and sign a brand review' },
      { to: '/forecast-accuracy', label: 'Forecast Accuracy', note: 'How the model actually scored' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/sales', label: 'Sales Analytics', note: 'Value, margin and returns' },
      { to: '/sales-extended', label: 'Sales Extended', note: 'Units, over the full record' },
      { to: '/stock-analysis', label: 'Stock Analysis', note: 'Health, ageing and stock-outs' },
      { to: '/brand-analytics', label: 'Brand Analytics', note: 'One brand, or four against each other' },
      { to: '/basket', label: 'Baskets', note: 'What sells together' },
      { to: '/stock-placement', label: 'UAE Stock Placement', note: 'Movers to bring to Motor City' },
    ],
  },
  { to: '/requests', label: 'Requests', note: 'Raised, not yet ordered' },
];

export default function Layout() {
  const { wide } = useWidth();
  // Open-draft count, shown as a badge. Editing happens on Forecast
  // Analytics, so a half-finished review is otherwise invisible unless
  // you navigate back to that exact brand -- which is how a draft goes
  // stale for a month unnoticed. Failure is silent on purpose: a
  // navigation badge is not worth an error state.
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { snapshots } = await getForecastSnapshots();
        if (!cancelled) setDraftCount(snapshots.filter((s) => s.status === 'draft').length);
      } catch { /* badge is decorative; a failure here must not break the shell */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // The badge now surfaces through whichever group owns that page, so
  // the count is still visible with the panel shut.
  const badges = { '/forecast-accuracy': draftCount };

  return (
    // One class on the shell rather than per page: the measure is
    // inherited by every .container inside it, which is the same
    // mechanism .page--wide already uses.
    <div className={'app-shell' + (wide ? ' app-shell--wide' : '')}>
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="topbar-left">
            <Link to="/" className="mark" title="Overview">
              RUNWAY <span className="accent">IQ</span>
            </Link>
            <nav className="nav-links" aria-label="Sections">
              {NAV.map((n) => (n.items ? (
                <NavGroup key={n.label} label={n.label} items={n.items} badges={badges} />
              ) : (
                <NavLink key={n.to} to={n.to}
                         className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                  {n.label}
                </NavLink>
              )))}
            </nav>
          </div>
          <div className="topbar-right">
            <FreshnessBadge />
            <OptionsMenu />
          </div>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
