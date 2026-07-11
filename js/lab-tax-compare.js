// lab-tax-compare.js
// Additive Portfolio-Lab features. Include AFTER page-lab.js in index.html:
//     <script src="page-lab.js"></script>
//     <script src="lab-tax-compare.js"></script>
//
// Adds, with NO server.py changes (everything runs client-side off /api/backtest):
//   (1) A "tax method" after-tax scenario: a 2nd line on the return chart and a
//       per-quarter tax block under each quarter's dollar-change table.
//   (2) A two-portfolio comparison panel (pick investors + Top-N for A and B,
//       like the Configure card) that reports CAGR, volatility and best years.
//
// The basket builder below mirrors runLab() INCLUDING the early-lock / filing-date
// logic, so comparison portfolios use the same locked baskets as the main backtest.

/* ============================================================================
 * 1. SHARED BASKET BUILDER  (mirrors runLab + the early-lock date changes)
 * ========================================================================== */
const LAB_BASKET_SIZE = 15;
const LAB_SETTLE_BUFFER_DAYS = 90;   // 45-day 13F deadline + slack for amendments

function lab_qkey(q) { const p = String(q).split(' '); return (+p[1]) * 4 + (+p[0][1]) - 1; }

function lab_quarterEndISO(label) {
  const m = { Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31' };
  const [q, y] = String(label).split(' ');
  return m[q] ? `${y}-${m[q]}` : null;
}

function lab_issuerKey(name) {
  let s = (name || '').toUpperCase();
  s = s.replace(/\b(CL(ASS)?|SER(IES)?|COM|COMMON|ADR|ADS|SPON(SORED)?|WT|WTS|RT|RTS|UNIT|UNITS|PFD|PREFERRED)\b.*$/, ' ');
  s = s.replace(/[.,&/()]/g, ' ');
  s = s.replace(/\b(INC|CORP|CORPORATION|CO|COS|COMPANIES|COMPANY|LTD|LIMITED|LLC|LP|PLC|NV|SA|AG|HLDG|HLDGS|HOLDING|HOLDINGS|GROUP|GRP|TR|TRUST|THE|NEW|REIT|INTL|INTERNATIONAL)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s || (name || '').toUpperCase().trim();
}

function lab_getTopN(history, invId, quarter, topN) {
  const qData = (history[invId] || []).find(q => q.quarter === quarter);
  if (!qData) return [];
  return (qData.holdings || [])
    .filter(h => h.name && !h.put_call && (h.value || 0) > 0)
    .slice(0, topN);
}

function lab_consensusForQuarter(history, ids, quarter, topN, minHolders) {
  const byIssuer = new Map();
  ids.forEach(id => {
    const inv = INVESTORS.find(i => i.id === id);
    lab_getTopN(history, id, quarter, topN).forEach(h => {
      const key = lab_issuerKey(h.name);
      if (!byIssuer.has(key)) byIssuer.set(key, { name: h.name, tickerCount: new Map(), holders: new Map() });
      const e = byIssuer.get(key);
      if (h.ticker && !h.ticker.startsWith('~')) e.tickerCount.set(h.ticker, (e.tickerCount.get(h.ticker) || 0) + 1);
      const prev = e.holders.get(id);
      if (prev) { prev.value += (h.value || 0); } else e.holders.set(id, { value: (h.value || 0) });
    });
  });
  const out = [];
  byIssuer.forEach((e, key) => {
    const holders = [...e.holders.values()];
    if (holders.length < minHolders) return;
    const ticker = [...e.tickerCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const totalVal = holders.reduce((s, h) => s + h.value, 0);
    out.push({ key, ticker, name: e.name, count: holders.length, totalVal });
  });
  out.sort((a, b) => (b.count - a.count) || (b.totalVal - a.totalVal));
  return out;
}

function lab_filersForQuarter(history, ids, quarter) {
  return ids.filter(id => (history[id] || []).some(q => q.quarter === quarter));
}

function lab_issuerCounts(history, ids, quarter, topN) {
  const seen = new Map();
  ids.forEach(id => lab_getTopN(history, id, quarter, topN).forEach(h => {
    const k = lab_issuerKey(h.name);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(id);
  }));
  const out = new Map();
  seen.forEach((s, k) => out.set(k, s.size));
  return out;
}

function lab_lockState(history, ids, filerIds, quarter, topN, minHolders) {
  const cons = lab_consensusForQuarter(history, filerIds, quarter, topN, minHolders);
  const inKeys = new Set(cons.slice(0, LAB_BASKET_SIZE).map(c => c.key));
  const cut = (cons.length >= LAB_BASKET_SIZE) ? cons[LAB_BASKET_SIZE - 1].count : minHolders;
  let cOutMax = 0;
  lab_issuerCounts(history, filerIds, quarter, topN).forEach((c, k) => { if (!inKeys.has(k) && c > cOutMax) cOutMax = c; });
  const R = ids.length - filerIds.length;          // adversarial: all not-yet-filed could file
  const margin = cut - cOutMax;
  const locked = R === 0 || R < margin;
  return { locked, R, margin, cut, cOutMax, consensus: cons.length };
}

function lab_quarterLockStatus(history, ids, quarter, topN, minHolders) {
  const qEnd = lab_quarterEndISO(quarter);
  const settled = qEnd && Date.now() > new Date(qEnd + 'T00:00:00').getTime() + LAB_SETTLE_BUFFER_DAYS * 864e5;
  const allFilers = lab_filersForQuarter(history, ids, quarter);
  const lastDate = allFilers
    .map(id => (history[id] || []).find(q => q.quarter === quarter)?.date)
    .filter(Boolean).sort().pop() || null;

  if (settled) {
    const st = lab_lockState(history, ids, allFilers, quarter, topN, minHolders);
    return { ...st, locked: true, settled: true, entryDate: lastDate, filed: allFilers.length, R: 0 };
  }
  const dates = [...new Set(allFilers
    .map(id => (history[id] || []).find(q => q.quarter === quarter)?.date).filter(Boolean))].sort();
  for (const d of dates) {
    const filers = ids.filter(id => {
      const qd = (history[id] || []).find(q => q.quarter === quarter);
      return qd && qd.date && qd.date <= d;
    });
    const st = lab_lockState(history, ids, filers, quarter, topN, minHolders);
    if (st.locked) return { ...st, locked: true, settled: false, entryDate: d, filed: filers.length };
  }
  const st = lab_lockState(history, ids, allFilers, quarter, topN, minHolders);
  return { ...st, locked: false, settled: false, entryDate: lastDate, filed: allFilers.length };
}

// Returns { baskets, quarterTopHoldings, minHolders } for a given investor set + Top-N.
function buildConsensusBaskets(history, selectedIds, topN) {
  const minHolders = selectedIds.length <= 1 ? 1 : 2;
  const qDateMap = {};
  selectedIds.forEach(id => (history[id] || []).forEach(q => {
    if (q.date && (!qDateMap[q.quarter] || q.date > qDateMap[q.quarter])) qDateMap[q.quarter] = q.date;
  }));
  const allQuarters = Object.entries(qDateMap).sort((a, b) => a[1].localeCompare(b[1])).map(([q]) => q);

  const quarterTopHoldings = allQuarters.map(quarter => {
    const lock = lab_quarterLockStatus(history, selectedIds, quarter, topN, minHolders);
    const investors = selectedIds
      .filter(id => (history[id] || []).some(q => q.quarter === quarter))
      .map(id => INVESTORS.find(i => i.id === id)?.name || id);
    const top = lab_consensusForQuarter(history, selectedIds, quarter, topN, minHolders).slice(0, LAB_BASKET_SIZE);
    return { quarter, entryDate: lock.entryDate, filed: lock.filed, investors, top, lock };
  });

  const baskets = quarterTopHoldings
    .filter(q => q.lock.locked && q.top.length > 0 && q.entryDate)
    .map(q => ({ quarter: q.quarter, entryDate: q.entryDate, investors: q.investors, tickers: q.top.map(c => c.ticker) }));

  return { baskets, quarterTopHoldings, minHolders };
}

/* ============================================================================
 * 2. TAX METHOD  — after-tax simulation from a backtest result's periods
 * ==========================================================================
 * Strategy modelled = "hold the overlap" (delta rebalancing): each quarter we
 * only SELL names that left the basket and BUY names that entered; names that
 * persist are left untouched so their gains stay unrealised (deferred). Tax is
 * charged only on realised gains, FIFO, at a flat savings-base rate (Spain has
 * no long/short split; FIFO is mandatory; the 2-month wash rule is flagged but
 * not enforced in v1). Cash from sales funds the new buys; any residual sits in
 * cash. This contrasts with the main line, which fully re-equal-weights every
 * quarter (max turnover, every gain realised) and ignores tax.
 */
const LAB_DEFAULT_TAX_RATE = 21;     // % flat savings-base approximation (Spain ~19–30% progressive)
let _taxLastRes = null;

function simulateTaxMethod(periods, ratePct) {
  const rate = (ratePct || 0) / 100;
  const START = 100000;
  if (!periods || !periods.length) return null;

  const holdings = new Map();        // ticker -> { shares, basis($) }   (full-sale only -> single lot is exact FIFO)
  let cash = 0;
  let taxCum = 0;
  const cum = [1];                   // growth-of-$1 after tax, aligned to [start, ...period.to]
  const perPeriod = [];              // { taxPaid, sold:[{ticker,gain,tax}], heldCount, endValue, endCum }

  const pricesStart = p => Object.fromEntries((p.constituents || []).map(c => [c.ticker, c.p0]));
  const pricesEnd   = p => Object.fromEntries((p.constituents || []).map(c => [c.ticker, c.p1]));

  // Initial buy: equal weight across the first period's priced names.
  const c0 = periods[0].constituents || [];
  if (c0.length) {
    const per = START / c0.length;
    c0.forEach(c => { if (c.p0 > 0) holdings.set(c.ticker, { shares: per / c.p0, basis: per }); });
  }

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const pe = pricesEnd(p);
    // Value at end of period i (held set == this quarter's basket) + idle cash.
    let endVal = cash;
    holdings.forEach((h, t) => { const px = pe[t]; if (Number.isFinite(px)) endVal += h.shares * px; });

    let taxPaid = 0; const sold = []; let bought = 0;
    const heldBefore = holdings.size;
    if (i + 1 < periods.length) {
      const nextSet = new Set((periods[i + 1].constituents || []).map(c => c.ticker));
      const psNext = pricesStart(periods[i + 1]);
      // SELL exits (held but not in next basket) -> realise FIFO gain, pay tax.
      [...holdings.keys()].forEach(t => {
        if (!nextSet.has(t)) {
          const h = holdings.get(t); const px = pe[t];
          if (Number.isFinite(px)) {
            const proceeds = h.shares * px;
            const gain = proceeds - h.basis;
            const tax = Math.max(0, gain) * rate;
            taxPaid += tax; taxCum += tax;
            cash += proceeds - tax;
            sold.push({ ticker: t, gain, tax });
          }
          holdings.delete(t);
        }
      });
      // BUY entries (in next basket, not currently held) equally from available cash.
      const entries = [...nextSet].filter(t => !holdings.has(t) && Number.isFinite(psNext[t]));
      if (entries.length && cash > 0) {
        const per = cash / entries.length;
        entries.forEach(t => { holdings.set(t, { shares: per / psNext[t], basis: per }); });
        cash -= per * entries.length;
        bought = entries.length;
      }
    }
    cum.push(endVal / START);
    perPeriod.push({ taxPaid, sold, bought, overlapHeld: heldBefore - sold.length, heldCount: holdings.size, endValue: endVal, endCum: endVal / START });
  }

  const final = cum[cum.length - 1];
  return { cum, perPeriod, taxCum, finalCum: final, startValue: START };
}

// Called at the END of renderBacktest(res). Adds the after-tax line + KPIs + per-quarter blocks.
function renderTaxScenario(res) {
  if (!res || !res.periods || res.periods.length < 1) return;
  _taxLastRes = res;
  const out = document.getElementById('bt-results');
  if (!out) return;

  // Inject a control bar (rate selector + after-tax KPIs) once, just under the KPI row.
  if (!document.getElementById('tax-bar')) {
    const bar = document.createElement('div');
    bar.id = 'tax-bar';
    bar.style.cssText = 'display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:6px 0 14px;padding:10px 12px;border:1px dashed var(--border);border-radius:var(--r);background:var(--surface)';
    out.insertBefore(bar, out.firstChild);
  }
  _taxRenderBar();
  _taxRenderLineAndBlocks();
}

function _taxRenderBar() {
  const bar = document.getElementById('tax-bar'); if (!bar) return;
  const res = _taxLastRes;
  const rate = +(document.getElementById('tax-rate')?.value || LAB_DEFAULT_TAX_RATE);
  const sim = simulateTaxMethod(res.periods, rate);
  if (!sim) return;
  const d0 = new Date(res.start_date), d1 = new Date(res.end_date);
  const years = Math.max((d1 - d0) / (365.25 * 864e5), 1e-9);
  const atCagr = sim.finalCum > 0 ? Math.pow(sim.finalCum, 1 / years) - 1 : null;
  const preCagr = (1 + res.cumulative_return) > 0 ? Math.pow(1 + res.cumulative_return, 1 / years) - 1 : null;
  const f = x => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%');
  const usd = x => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:7px">
      <span style="font-size:0.66rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3);font-weight:600">Tax method · rate</span>
      <input id="tax-rate" type="number" min="0" max="60" step="0.5" value="${rate}"
        style="width:62px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace"
        onchange="_taxRenderBar();_taxRenderLineAndBlocks()">
      <span style="font-size:0.7rem;color:var(--text-3)">%</span>
    </div>
    <div><div style="font-size:0.6rem;text-transform:uppercase;color:var(--text-3)">After-tax total</div>
      <div style="font-family:'DM Mono',monospace;font-weight:600;color:${sim.finalCum>=1?'var(--green)':'var(--red)'}">${f(sim.finalCum-1)}</div></div>
    <div><div style="font-size:0.6rem;text-transform:uppercase;color:var(--text-3)">After-tax CAGR</div>
      <div style="font-family:'DM Mono',monospace;font-weight:600">${f(atCagr)} <span style="color:var(--text-3);font-weight:400">vs ${f(preCagr)} pre-tax</span></div></div>
    <div><div style="font-size:0.6rem;text-transform:uppercase;color:var(--text-3)">Total tax paid</div>
      <div style="font-family:'DM Mono',monospace;font-weight:600;color:var(--red)">${usd(sim.taxCum)}</div></div>
    <div style="font-size:0.64rem;color:var(--text-3);max-width:260px;line-height:1.4">
      Delta-rebalanced (overlap held, gains deferred), FIFO, flat rate. Diff vs the blue line = lower turnover + tax drag.</div>`;
}

function _taxRenderLineAndBlocks() {
  const res = _taxLastRes; if (!res) return;
  const rate = +(document.getElementById('tax-rate')?.value || LAB_DEFAULT_TAX_RATE);
  const sim = simulateTaxMethod(res.periods, rate);
  if (!sim) return;

  // (a) add / refresh the after-tax dataset on the existing performance chart
  const addLine = () => {
    const ch = window._btPerfChart;
    if (!ch) return false;
    ch.data.datasets = ch.data.datasets.filter(d => d.label !== 'Tax method');
    ch.data.datasets.push({
      label: 'Tax method', data: sim.cum,
      borderColor: '#15803d', backgroundColor: 'rgba(21,128,61,0.06)',
      borderWidth: 2, pointRadius: 2, borderDash: [5, 3], fill: false, tension: 0.15
    });
    ch.options.plugins = ch.options.plugins || {};
    ch.options.plugins.legend = { display: true, labels: { font: { size: 10 }, boxWidth: 18 } };
    ch.data.datasets[0].label = ch.data.datasets[0].label || 'Pre-tax (full rebalance)';
    ch.update();
    return true;
  };
  if (!addLine()) setTimeout(addLine, 120);   // chart is built in a 50ms timeout inside renderBacktest

  // (b) per-quarter tax block appended under each quarter's dollar table
  const usd = (x, d = 2) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const details = document.querySelectorAll('#bt-results details');
  details.forEach((det, i) => {
    const pp = sim.perPeriod[i]; if (!pp) return;
    let box = det.querySelector('.tax-block');
    if (!box) {
      box = document.createElement('div');
      box.className = 'tax-block';
      box.style.cssText = 'margin-top:10px;padding:9px 11px;border-left:3px solid #15803d;background:rgba(21,128,61,0.05);border-radius:0 6px 6px 0';
      det.querySelector('div[style*="padding:10px 12px"]')?.appendChild(box) || det.appendChild(box);
    }
    const soldTxt = pp.sold.length
      ? pp.sold.map(s => `${s.ticker} (gain ${usd(s.gain, 0)} → tax ${usd(s.tax, 0)})`).join(', ')
      : 'nothing sold — full overlap held';
    box.innerHTML = `
      <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:#15803d;font-weight:700;margin-bottom:4px">Tax method this quarter (rate ${rate}%)</div>
      <div style="font-family:'DM Mono',monospace;font-size:0.78rem;line-height:1.7">
        Held through (gains deferred): <strong>${pp.overlapHeld}</strong> · sold: <strong>${pp.sold.length}</strong> · bought: <strong>${pp.bought}</strong><br>
        Rebalance sales: ${soldTxt}<br>
        Tax paid this quarter: <strong style="color:var(--red)">${usd(pp.taxPaid, 2)}</strong>
        · after-tax balance: <strong>${usd(pp.endValue, 2)}</strong></div>`;
  });
}

/* ============================================================================
 * 3. COMPARE TWO PORTFOLIOS
 * ========================================================================== */
const _cmpSel = { A: new Set(), B: new Set() };
let _cmpRunning = false;

function _cmpInvList(side) {
  return INVESTORS.map(inv => {
    const on = _cmpSel[side].has(inv.id);
    return `<label style="display:flex;align-items:center;gap:7px;padding:4px 8px;border-radius:8px;cursor:pointer;${on ? 'background:var(--surface-2,#eef2ff)' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="_cmpToggle('${side}','${inv.id}')">
      <span style="width:9px;height:9px;border-radius:50%;background:${inv.color || '#ccc'};flex:none"></span>
      <span style="font-size:0.8rem">${inv.name}</span></label>`;
  }).join('');
}

function _cmpToggle(side, id) {
  _cmpSel[side].has(id) ? _cmpSel[side].delete(id) : _cmpSel[side].add(id);
  const box = document.getElementById('cmp-list-' + side);
  if (box) box.innerHTML = _cmpInvList(side);
  const n = document.getElementById('cmp-count-' + side);
  if (n) n.textContent = _cmpSel[side].size;
}
function _cmpAll(side)  { INVESTORS.forEach(i => _cmpSel[side].add(i.id)); _cmpToggle(side, '__noop__'); }
function _cmpNone(side) { _cmpSel[side].clear(); _cmpToggle(side, '__noop__'); }

function _cmpSidePanel(side, label, defaultTopN) {
  return `<div style="flex:1;min-width:260px;border:1px solid var(--border);border-radius:var(--r);padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="font-size:0.95rem">Portfolio ${label}</strong>
      <span style="font-size:0.7rem;color:var(--text-3)"><span id="cmp-count-${side}">0</span> selected</span>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <button class="suggestion-chip" onclick="_cmpAll('${side}')">All</button>
      <button class="suggestion-chip" onclick="_cmpNone('${side}')">None</button>
    </div>
    <div id="cmp-list-${side}" style="max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:4px">${_cmpInvList(side)}</div>
    <div style="margin-top:8px;font-size:0.66rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3);font-weight:600">Top N holdings per investor</div>
    <input id="cmp-topn-${side}" type="number" min="1" value="${defaultTopN}" style="width:90px;margin-top:4px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-family:'DM Mono',monospace">
  </div>`;
}

function injectCompareUI() {
  const host = document.getElementById('lab-content');
  if (!host) return;
  if (document.getElementById('cmp-section')) return;          // already injected
  // default seeds: A = first 5, B = first 10
  if (!_cmpSel.A.size && !_cmpSel.B.size) {
    INVESTORS.slice(0, 5).forEach(i => _cmpSel.A.add(i.id));
    INVESTORS.slice(0, 10).forEach(i => _cmpSel.B.add(i.id));
  }
  const sec = document.createElement('section');
  sec.id = 'cmp-section';
  sec.style.cssText = 'max-width:1100px;margin:28px auto 0;padding:18px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg,#fff)';
  sec.innerHTML = `
    <h2 style="font-family:'DM Serif Display',serif;font-size:1.4rem;margin:0 0 4px">Compare two portfolios</h2>
    <div style="font-size:0.8rem;color:var(--text-2);margin-bottom:14px">
      Pick the investors and Top-N for each side, then compare CAGR, volatility and the best/worst years.
      Both use the same locked-basket timing as the main backtest.</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px">
      ${_cmpSidePanel('A', 'A', 10)}
      ${_cmpSidePanel('B', 'B', 10)}
    </div>
    <button class="lab-run-btn" style="width:auto;padding:10px 20px" onclick="runCompare()">Compare →</button>
    <div id="cmp-results" style="margin-top:18px"></div>`;
  host.insertAdjacentElement('afterend', sec);
  document.getElementById('cmp-count-A').textContent = _cmpSel.A.size;
  document.getElementById('cmp-count-B').textContent = _cmpSel.B.size;
}

function _cmpMetrics(res) {
  const periods = res.periods || [];
  const d0 = new Date(res.start_date), d1 = new Date(res.end_date);
  const years = Math.max((d1 - d0) / (365.25 * 864e5), 1e-9);
  const cagr = (1 + res.cumulative_return) > 0 ? Math.pow(1 + res.cumulative_return, 1 / years) - 1 : null;
  const rets = periods.map(p => p.basket_ret);
  const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(4);                 // annualised from quarterly
  // per calendar year compounded return (by the period's end date)
  const byYear = {};
  periods.forEach(p => { const y = String(p.to).slice(0, 4); byYear[y] = (byYear[y] ?? 1) * (1 + p.basket_ret); });
  const years_ = Object.entries(byYear).map(([y, g]) => ({ year: y, ret: g - 1 })).sort((a, b) => b.ret - a.ret);
  // max drawdown on the cumulative path
  let peak = 1, mdd = 0;
  [1, ...periods.map(p => p.cumulative)].forEach(v => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  return { cagr, vol, years: years_, mdd, span: years };
}

async function runCompare() {
  const out = document.getElementById('cmp-results');
  if (!out || _cmpRunning) return;
  const aIds = [..._cmpSel.A], bIds = [..._cmpSel.B];
  if (aIds.length === 0 || bIds.length === 0) { out.innerHTML = '<div class="empty"><p>Select at least one investor on each side.</p></div>'; return; }
  const aTopN = Math.max(1, +(document.getElementById('cmp-topn-A')?.value || 10));
  const bTopN = Math.max(1, +(document.getElementById('cmp-topn-B')?.value || 10));

  _cmpRunning = true;
  out.innerHTML = '<div class="lab-spinner" style="display:block">Building baskets and pricing both portfolios…</div>';
  try {
    const history = await loadFullHistory();
    const A = buildConsensusBaskets(history, aIds, aTopN);
    const B = buildConsensusBaskets(history, bIds, bTopN);
    if (A.baskets.length < 2 || B.baskets.length < 2) {
      out.innerHTML = '<div class="empty"><p>One side has fewer than two locked quarters. Widen its selection or raise Top-N.</p></div>';
      _cmpRunning = false; return;
    }
    const post = baskets => fetch('/api/backtest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baskets, includePartial: true })
    }).then(r => r.json());
    const [ra, rb] = await Promise.all([post(A.baskets), post(B.baskets)]);
    if (!ra.ok || !rb.ok) { out.innerHTML = `<div class="empty"><p>${ra.error || rb.error || 'Backtest failed.'}</p></div>`; _cmpRunning = false; return; }
    _cmpRender(ra, rb, aIds.length, bIds.length, aTopN, bTopN);
  } catch (e) {
    out.innerHTML = `<div class="empty"><p>Compare failed: ${e.message}</p></div>`;
  }
  _cmpRunning = false;
}

function _cmpRender(ra, rb, na, nb, ta, tb) {
  const out = document.getElementById('cmp-results');
  const ma = _cmpMetrics(ra), mb = _cmpMetrics(rb);
  const rate = +(document.getElementById('tax-rate')?.value || LAB_DEFAULT_TAX_RATE);
  const sa = simulateTaxMethod(ra.periods, rate), sb = simulateTaxMethod(rb.periods, rate);
  const atC = (sim, span) => sim && sim.finalCum > 0 ? Math.pow(sim.finalCum, 1 / span) - 1 : null;
  const pf = x => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%');
  const better = (a, b, hi = true) => a == null || b == null ? ['', ''] : (hi ? (a > b) : (a < b)) ? ['font-weight:700;color:var(--green)', ''] : ['', 'font-weight:700;color:var(--green)'];

  const [cA, cB] = better(ma.cagr, mb.cagr);
  const [vA, vB] = better(ma.vol, mb.vol, false);          // lower vol is better
  const [dA, dB] = better(ma.mdd, mb.mdd);                 // mdd are <=0; higher (closer to 0) better
  const topYears = m => m.years.slice(0, 3).map(y => `${y.year} (${pf(y.ret)})`).join(', ') || '—';
  const worstYear = m => { const w = m.years[m.years.length - 1]; return w ? `${w.year} (${pf(w.ret)})` : '—'; };

  const row = (lbl, a, b, sa2 = '', sb2 = '') =>
    `<tr><td style="padding:7px 10px;color:var(--text-2)">${lbl}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;${sa2}">${a}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;${sb2}">${b}</td></tr>`;

  out.innerHTML = `
    <div style="height:260px;position:relative;margin-bottom:16px"><canvas id="cmp-chart"></canvas></div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:7px 10px"></th>
        <th style="text-align:right;padding:7px 10px;color:#1549a8">Portfolio A<br><span style="font-weight:400;font-size:0.72rem;color:var(--text-3)">${na} inv · top ${ta}</span></th>
        <th style="text-align:right;padding:7px 10px;color:#b45309">Portfolio B<br><span style="font-weight:400;font-size:0.72rem;color:var(--text-3)">${nb} inv · top ${tb}</span></th>
      </tr></thead><tbody>
        ${row('Total return', pf(ra.cumulative_return), pf(rb.cumulative_return))}
        ${row('CAGR', pf(ma.cagr), pf(mb.cagr), cA, cB)}
        ${row('CAGR difference (A − B)', pf((ma.cagr ?? 0) - (mb.cagr ?? 0)), '', '', '')}
        ${row('Annualised volatility', pf(ma.vol), pf(mb.vol), vA, vB)}
        ${row('Max drawdown', pf(ma.mdd), pf(mb.mdd), dA, dB)}
        ${row('After-tax CAGR (' + rate + '%)', pf(atC(sa, ma.span)), pf(atC(sb, mb.span)))}
        ${row('Best years', topYears(ma), topYears(mb))}
        ${row('Worst year', worstYear(ma), worstYear(mb))}
        ${row('Quarters · coverage', ra.n_periods + ' · ' + (ra.coverage * 100).toFixed(0) + '%', rb.n_periods + ' · ' + (rb.coverage * 100).toFixed(0) + '%')}
      </tbody></table></div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-top:8px">Green = the better side per row (higher return, lower volatility, shallower drawdown). Volatility annualised from quarterly basket returns; best/worst years compounded within each calendar year.</div>`;

  setTimeout(() => {
    const ctx = document.getElementById('cmp-chart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (window._cmpChart) { try { window._cmpChart.destroy(); } catch (e) {} }
    const labels = [ra.start_date, ...ra.periods.map(p => p.to)];
    const labelsB = [rb.start_date, ...rb.periods.map(p => p.to)];
    const useLabels = labels.length >= labelsB.length ? labels : labelsB;
    window._cmpChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: useLabels,
        datasets: [
          { label: 'Portfolio A', data: [1, ...ra.periods.map(p => p.cumulative)], borderColor: '#1549a8', borderWidth: 2, pointRadius: 1.5, fill: false, tension: 0.15 },
          { label: 'Portfolio B', data: [1, ...rb.periods.map(p => p.cumulative)], borderColor: '#b45309', borderWidth: 2, pointRadius: 1.5, fill: false, tension: 0.15 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { font: { size: 11 } } },
          tooltip: { callbacks: { label: c => c.dataset.label + ': $' + c.parsed.y.toFixed(2) } } },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
          y: { ticks: { callback: v => '$' + Number(v).toFixed(2), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
  }, 50);
}

/* ============================================================================
 * 4. AUTO-WIRE   (no edits needed to initLabView / renderLabShell)
 * ========================================================================== */
(function () {
  // Inject the compare panel once the lab is on screen; survives re-renders
  // because it lives as a sibling AFTER #lab-content, not inside it.
  setInterval(() => {
    if (document.getElementById('lab-content') && !document.getElementById('cmp-section') && (INVESTORS || []).length) {
      try { injectCompareUI(); } catch (e) { /* not ready yet */ }
    }
  }, 700);
})();