// page-compare.js — Compare view.
function renderCompare() {
  const idA = document.getElementById('cmp-a').value;
  const idB = document.getElementById('cmp-b').value;
  const result = document.getElementById('cmp-result');
  if (!idA || !idB || idA === idB) {
    result.innerHTML = '<div class="empty"><p>' + (idA === idB ? 'Please select two different investors.' : 'Select two investors to compare portfolios') + '</p></div>';
    return;
  }
  const invA = INVESTORS.find(i => i.id === idA);
  const invB = INVESTORS.find(i => i.id === idB);
  if (!invA || !invB) return;

  const holdA = (invA.holdings || []).filter(h => !h.ticker.startsWith('~'));
  const holdB = (invB.holdings || []).filter(h => !h.ticker.startsWith('~'));
  const mapA  = {}; holdA.forEach(h => { mapA[h.ticker] = h; });
  const mapB  = {}; holdB.forEach(h => { mapB[h.ticker] = h; });

  // Shared, unique to each
  const shared   = holdA.filter(h => mapB[h.ticker]).sort((a,b) => b.pct - a.pct);
  const onlyA    = holdA.filter(h => !mapB[h.ticker]).sort((a,b) => b.pct - a.pct);
  const onlyB    = holdB.filter(h => !mapA[h.ticker]).sort((a,b) => b.pct - a.pct);

  // Sector breakdown
  const secA = {}, secB = {};
  holdA.forEach(h => { secA[h.sector||'Other'] = (secA[h.sector||'Other']||0) + h.pct; });
  holdB.forEach(h => { secB[h.sector||'Other'] = (secB[h.sector||'Other']||0) + h.pct; });
  const allSectors = [...new Set([...Object.keys(secA), ...Object.keys(secB)])].sort();

  // Overlap score: sum of min(pctA, pctB) for shared tickers
  const overlapScore = shared.reduce((s,h) => s + Math.min(h.pct, mapB[h.ticker].pct), 0).toFixed(1);

  // Performance comparison
  const perfA = invA.portfolioPerfSinceFiling;
  const perfB = invB.portfolioPerfSinceFiling;
  function perfBadge(p) {
    if (p === null || p === undefined) return '<span style="color:var(--text-3)">—</span>';
    const cls = p > 0.5 ? 'var(--green)' : p < -0.5 ? 'var(--red)' : 'var(--text-2)';
    return '<span style="color:' + cls + ';font-weight:600">' + (p>0?'+':'') + p.toFixed(1) + '%</span>';
  }

  function statCard(label, valA, valB) {
    return '<div style="background:var(--surface);border-radius:var(--r);padding:12px 16px;flex:1;min-width:120px">' +
      '<div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:6px">' + label + '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:12px">' +
        '<div><div style="font-size:0.65rem;color:var(--text-3);margin-bottom:2px">' + invA.name.split(' ')[0] + '</div><div style="font-weight:600;font-size:0.9rem">' + valA + '</div></div>' +
        '<div style="text-align:right"><div style="font-size:0.65rem;color:var(--text-3);margin-bottom:2px">' + invB.name.split(' ')[0] + '</div><div style="font-weight:600;font-size:0.9rem">' + valB + '</div></div>' +
      '</div></div>';
  }

  function posRow(h, other) {
    const otherH = other[h.ticker];
    const pctStr = h.pct.toFixed(1) + '%';
    const otherStr = otherH ? otherH.pct.toFixed(1) + '%' : '—';
    const diff = otherH ? (h.pct - otherH.pct).toFixed(1) : null;
    const diffStr = diff !== null ? '<span style="font-size:0.7rem;color:' + (diff>0?'var(--green)':diff<0?'var(--red)':'var(--text-3)') + '">' + (diff>0?'+':'') + diff + '%</span>' : '';
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-weight:600;color:var(--blue);font-size:0.8rem">' + h.ticker + '</td>' +
      '<td style="padding:5px 10px;font-size:0.75rem;color:var(--text-2)">' + h.name + '</td>' +
      '<td style="padding:5px 10px;font-size:0.75rem;color:var(--text-3)">' + (h.sector||'—') + '</td>' +
      '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-size:0.8rem;text-align:right">' + pctStr + '</td>' +
      '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-size:0.8rem;text-align:right;color:var(--text-3)">' + otherStr + '</td>' +
      '<td style="padding:5px 10px;text-align:right">' + diffStr + '</td>' +
    '</tr>';
  }

  function sectionTable(title, items, mapOther, labelA, labelB, color) {
    if (!items.length) return '';
    const rows = items.slice(0,20).map(h => posRow(h, mapOther)).join('');
    return '<div style="margin-bottom:1.5rem">' +
      '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;color:' + color + ';font-weight:600;margin-bottom:8px">' + title + ' (' + items.length + ')</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
          '<th style="padding:5px 10px;text-align:left;font-size:0.68rem;color:var(--text-3)">Ticker</th>' +
          '<th style="padding:5px 10px;text-align:left;font-size:0.68rem;color:var(--text-3)">Company</th>' +
          '<th style="padding:5px 10px;text-align:left;font-size:0.68rem;color:var(--text-3)">Sector</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">' + labelA + '</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">' + labelB + '</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">Diff</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      (items.length > 20 ? '<div style="font-size:0.7rem;color:var(--text-3);margin-top:4px">Showing top 20 of ' + items.length + '</div>' : '') +
    '</div>';
  }

  const nameA = invA.name.split(' ')[0];
  const nameB = invB.name.split(' ')[0];

  result.innerHTML =
    // Stats row
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:1.5rem">' +
      statCard('AUM', fmtM(invA.aumRaw), fmtM(invB.aumRaw)) +
      statCard('Positions', holdA.length, holdB.length) +
      statCard('Filing date', invA.filingDate||'—', invB.filingDate||'—') +
      statCard('Perf since filing', perfBadge(perfA), perfBadge(perfB)) +
      '<div style="background:var(--surface);border-radius:var(--r);padding:12px 16px;flex:1;min-width:120px">' +
        '<div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:6px">Portfolio Overlap</div>' +
        '<div style="font-weight:600;font-size:1.1rem">' + overlapScore + '%</div>' +
        '<div style="font-size:0.7rem;color:var(--text-3)">' + shared.length + ' shared positions</div>' +
      '</div>' +
    '</div>' +

    // Sector comparison
    '<div style="margin-bottom:1.5rem">' +
      '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600;margin-bottom:8px">Sector Allocation</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
          '<th style="padding:5px 10px;text-align:left;font-size:0.68rem;color:var(--text-3)">Sector</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">' + nameA + '</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">' + nameB + '</th>' +
          '<th style="padding:5px 10px;text-align:right;font-size:0.68rem;color:var(--text-3)">Diff</th>' +
        '</tr></thead><tbody>' +
        allSectors.map(function(s) {
          const a = secA[s]||0, b = secB[s]||0, d = (a-b).toFixed(1);
          const dColor = d>0?'var(--green)':d<0?'var(--red)':'var(--text-3)';
          return '<tr style="border-bottom:1px solid var(--border)">' +
            '<td style="padding:5px 10px;font-size:0.8rem">' + s + '</td>' +
            '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-size:0.8rem;text-align:right">' + (a?a.toFixed(1)+'%':'—') + '</td>' +
            '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-size:0.8rem;text-align:right">' + (b?b.toFixed(1)+'%':'—') + '</td>' +
            '<td style="padding:5px 10px;font-family:DM Mono,monospace;font-size:0.8rem;text-align:right;color:' + dColor + '">' + (d>0?'+':'') + d + '%</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</div>' +

    // Shared positions
    sectionTable('Shared Positions', shared, mapB, nameA + ' weight', nameB + ' weight', 'var(--blue)') +

    // Unique to A
    sectionTable('Only ' + invA.name, onlyA, {}, nameA + ' weight', nameB + ' (not held)', 'var(--green)') +

    // Unique to B
    sectionTable('Only ' + invB.name, onlyB, {}, nameB + ' weight', nameA + ' (not held)', 'var(--amber)');
}
