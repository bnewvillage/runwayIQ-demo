import { useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard affordance, built to be dropped in wherever a value
 * is worth lifting out of the page -- item codes today, anything else
 * later. Deliberately generic: it takes the text and an optional label
 * rather than knowing what an item code is, so new pages can reuse it
 * without this growing per-page special cases.
 *
 * Renders inline and stops click propagation, since the values it sits
 * next to are usually inside rows or headers that are themselves
 * clickable (expanding a brand card, sorting a column) -- copying should
 * never also trigger whatever the surrounding element does.
 */
export default function CopyButton({ text, title = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(e) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context and can be blocked outright.
      // Fall back to a throwaway textarea + execCommand so the button
      // still works on http:// dev servers and locked-down browsers
      // rather than silently doing nothing.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      className={'copy-btn' + (copied ? ' copied' : '') + (className ? ' ' + className : '')}
      onClick={copy}
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
    >
      {copied ? (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 6.4 4.7 8.6 9.5 3.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1"
             strokeLinejoin="round" aria-hidden="true">
          <rect x="4.1" y="4.1" width="6.2" height="6.2" rx="1.1" />
          <path d="M8.1 2.3a1.1 1.1 0 0 0-.7-.6H3a1.1 1.1 0 0 0-1.1 1.1v4.4c0 .3.2.6.5.7" />
        </svg>
      )}
    </button>
  );
}
