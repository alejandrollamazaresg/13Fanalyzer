// page-search.js — Stock Search view.
function normalizeSearchText(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9. ]/g, '').trim();
}

function buildStockSuggestions() {
  const el = document.getElementById('stock-suggestions');
  if (!el) return;
  const counts = {};
  INVESTORS.forEach(inv => (inv.holdings || []).forEach(h => {
    const key = h.ticker || h.name;
    if (!key) return;
    if (!counts[key]) counts[key] = { ticker:h.ticker, name:h.name, owners:new Set(), value:0 };
    counts[key].owners.add(inv.id);
    counts[key].value += h.value || 0;
  }));
  const top = Object.values(counts)
    .sort((a,b)=>b.owners.size-a.owners.size || b.value-a.value)
    .slice(0,8);
  el.innerHTML = top.map(x => `<button class="suggestion-chip" onclick="quickStockSearch('${(x.ticker || x.name).replace(/'/g,"\\'")}')">${x.ticker || x.name}</button>`).join('');
}

function quickStockSearch(q) {
  const input = document.getElementById('stock-search-input');
  input.value = q;
  runStockSearch();
}

function getHoldingChange(holding, investor) {
  const prev = (investor.holdingsPrev || []).find(p =>
    (p.ticker && holding.ticker && p.ticker === holding.ticker) ||
    normalizeSearchText(p.name) === normalizeSearchText(holding.name)
  );
  if (!prev) return { label:'NEW', cls:'chg-new', raw:null };
  const change = holding.pct - prev.pct;
  const sign = change > 0 ? '+' : '';
  const cls = change > 0.05 ? 'chg-up' : change < -0.05 ? 'chg-dn' : 'chg-flat';
  return { label:`${sign}${change.toFixed(2)}pp`, cls, raw:change };
}

function runStockSearch() {
  const input = document.getElementById('stock-search-input');
  const container = document.getElementById('stock-search-results');
  if (!input || !container) return;

  const qRaw = input.value.trim();
  const q = normalizeSearchText(qRaw);
  if (!q) {
    container.innerHTML = '<div class="empty"><p>Enter a stock ticker or company name to search.</p></div>';
    return;
  }

  // Matching is strict and ticker-first:
  //   1. If the query is an EXACT ticker that someone holds, return only those
  //      holders. So "V" means Visa — never every company whose name starts
  //      with "v", and "MCO" never matches EMCOR / AMCOR / KIMCO / PIMCO / CMCO.
  //   2. Only if the query is not a held ticker do we treat it as a company
  //      name search, and even then we match at WORD STARTS only (so "moody"
  //      finds "Moody's Corp" but "mco" still can't match "Emcor").
  let matches = [];
  INVESTORS.forEach(inv => {
    (inv.holdings || []).forEach(h => {
      if (normalizeSearchText(h.ticker) === q) {
        matches.push({ investor:inv, holding:h, exactTicker:true });
      }
    });
  });

  if (!matches.length && q.length >= 2) {
    const nameRe = new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    INVESTORS.forEach(inv => {
      (inv.holdings || []).forEach(h => {
        if (nameRe.test(normalizeSearchText(h.name))) {
          matches.push({ investor:inv, holding:h, exactTicker:false });
        }
      });
    });
  }

  if (!matches.length) {
    container.innerHTML = `<div class="empty"><p>No investors currently hold “${qRaw}” in the loaded 13F data.</p></div>`;
    return;
  }

  // Collapse multiple line items from the SAME investor (duplicate filings,
  // share classes, option legs) into ONE holder, so an investor is never
  // listed twice. Portfolio weight and position value are summed across them.
  const byInvestor = new Map();
  matches.forEach(({ investor, holding, exactTicker }) => {
    let e = byInvestor.get(investor.id);
    if (!e) {
      e = { investor, value:0, pct:0, lineItems:0, exactTicker:false, tickers:new Set(), names:new Set() };
      byInvestor.set(investor.id, e);
    }
    e.value += holding.value || 0;
    e.pct   += holding.pct || 0;
    e.lineItems += 1;
    e.exactTicker = e.exactTicker || exactTicker;
    if (holding.ticker) e.tickers.add(normalizeSearchText(holding.ticker));
    if (holding.name)   e.names.add(normalizeSearchText(holding.name));
  });

  const holders = [...byInvestor.values()].sort((a,b) => {
    if (a.exactTicker !== b.exactTicker) return a.exactTicker ? -1 : 1;
    return b.pct - a.pct;
  });

  // QoQ change on the aggregated position: sum prior-quarter weight for the
  // same ticker(s)/name(s), then compare to this quarter's summed weight.
  function holderChange(h) {
    const prev = (h.investor.holdingsPrev || []).filter(p => {
      const pt = normalizeSearchText(p.ticker);
      const pn = normalizeSearchText(p.name);
      return (pt && h.tickers.has(pt)) || (pn && h.names.has(pn));
    });
    if (!prev.length) return { label:'NEW', cls:'chg-new' };
    const prevPct = prev.reduce((s,p)=>s+(p.pct||0),0);
    const change = h.pct - prevPct;
    const sign = change > 0 ? '+' : '';
    const cls = change > 0.05 ? 'chg-up' : change < -0.05 ? 'chg-dn' : 'chg-flat';
    return { label:`${sign}${change.toFixed(2)}pp`, cls };
  }

  const totalInvestors = INVESTORS.length || 1;
  const holderCount = holders.length;
  const totalValue = holders.reduce((s,h)=>s+h.value,0);
  const avgWeight = holders.reduce((s,h)=>s+h.pct,0) / holderCount;
  const topMatch = matches.find(m => m.investor.id === holders[0].investor.id);
  const mainTicker = (topMatch && topMatch.holding.ticker) || qRaw.toUpperCase();
  const mainName = (topMatch && topMatch.holding.name) || '';

  container.innerHTML = `
    <div class="search-summary">
      <div class="search-stat"><div class="search-stat-lbl">Stock</div><div class="search-stat-main">${mainTicker}</div><div class="search-stat-sub">${mainName}</div></div>
      <div class="search-stat"><div class="search-stat-lbl">Holders</div><div class="search-stat-main">${holderCount}/${totalInvestors}</div><div class="search-stat-sub">${(holderCount/totalInvestors*100).toFixed(0)}% of tracked investors</div></div>
      <div class="search-stat"><div class="search-stat-lbl">Combined value</div><div class="search-stat-main">${fmtM(totalValue)}</div><div class="search-stat-sub">Across ${holderCount} holders</div></div>
      <div class="search-stat"><div class="search-stat-lbl">Average weight</div><div class="search-stat-main">${avgWeight.toFixed(1)}%</div><div class="search-stat-sub">Among holders only</div></div>
    </div>
    <div class="search-results-title">Investors holding ${mainTicker}</div>
    ${holders.map(h => {
      const chg = holderChange(h);
      return `<div class="holder-card">
        <div><div class="holder-name">${h.investor.name}</div><div class="holder-firm">${h.investor.firm}</div></div>
        <div><div class="holder-metric-lbl">Portfolio weight</div><div class="holder-metric-val">${h.pct.toFixed(2)}%</div></div>
        <div><div class="holder-metric-lbl">Position value</div><div class="holder-metric-val">${fmtM(h.value)}</div></div>
        <div><div class="holder-metric-lbl">QoQ change</div><div class="holder-metric-val"><span class="chg-badge ${chg.cls}">${chg.label}</span></div></div>
      </div>`;
    }).join('')}
  `;
}

/* ═══════════════════════════════════════════════
   ENHANCED MARKET VIEW FUNCTIONS
═══════════════════════════════════════════════ */
