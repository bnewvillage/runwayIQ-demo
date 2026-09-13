// Shared search-query matcher. Grammar:
//   ",," = AND (each comma group must match)   "//" = OR within a group
//   "--term" = exclude. Double separators avoid colliding with single "-"/"/".
// Priority reads left-to-right, RIGHTMOST wins: after the positive AND/OR
// requirement is met, the last-written matching term (include or exclude)
// decides - "boot,,--kids" drops kids boots, "--kids,,boot" keeps them.
// Empty query matches everything.
export function matchQuery(value, query) {
  const groups = query.toLowerCase().split(',,')
    .map((g) => g.split('//').map((t) => t.trim()).filter(Boolean))
    .filter((g) => g.length);
  if (!groups.length) return true;
  const v = value.toLowerCase();
  const terms = [];
  for (const group of groups) {
    let hasPositive = false, positiveMatched = false;
    for (const t of group) {
      if (t.startsWith('--')) {
        const term = t.slice(2).trim();
        if (term) terms.push({ term, neg: true });
      } else {
        hasPositive = true;
        terms.push({ term: t, neg: false });
        if (v.includes(t)) positiveMatched = true;
      }
    }
    if (hasPositive && !positiveMatched) return false;
  }
  for (let i = terms.length - 1; i >= 0; i--) {
    if (v.includes(terms[i].term)) return !terms[i].neg;
  }
  return true;
}
