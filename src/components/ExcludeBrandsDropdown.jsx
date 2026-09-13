import { useEffect, useRef, useState } from 'react';

/** Browsable multi-select "exclude brands" dropdown -- a full checkbox list
 * rather than a type-to-guess search box, since you can't type a brand name
 * you don't already know. The optional filter narrows the list but never
 * requires typing to find anything. */
export default function ExcludeBrandsDropdown({ all, excluded, onToggle }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const label = excluded.size > 0 ? `${excluded.size} excluded` : 'Exclude brands';
  const q = filter.trim().toLowerCase();
  const visible = q ? all.filter((b) => b.toLowerCase().includes(q)) : all;

  return (
    <div className="exclude-dropdown" ref={ref}>
      <div className={'exclude-dropdown-trigger' + (open ? ' open' : '')} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <span>{label}</span>
        <svg className="exclude-dropdown-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5l4 4 4-4" />
        </svg>
      </div>
      {open && (
        <div className="exclude-dropdown-menu" onClick={(e) => e.stopPropagation()}>
          <input
            type="text" className="exclude-dropdown-filter" value={filter}
            onChange={(e) => setFilter(e.target.value)} placeholder="Filter brands&hellip;" autoFocus
          />
          <div className="exclude-dropdown-list">
            {visible.length === 0 && <div className="exclude-suggest-empty">No matching brand</div>}
            {visible.map((brand) => {
              const sel = excluded.has(brand);
              return (
                <div key={brand} className={'exclude-dropdown-item' + (sel ? ' selected' : '')} onClick={() => onToggle(brand)}>
                  <input type="checkbox" readOnly checked={sel} />
                  <span>{brand}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
