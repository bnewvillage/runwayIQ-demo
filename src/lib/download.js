/**
 * Browser file download. Page-agnostic on purpose: this is a DOM
 * mechanism, not Demand Glance's or Forecast Analytics' business logic,
 * and it previously lived in demand-glance/demandGlanceData.js with the
 * forecast page reaching across pages to import it.
 */
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
