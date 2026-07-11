// page-history.js — History view (full holdings history).
let _fullHistory = null;   // { investor_id: [{quarter, date, aum, holdings}] }
let _histLoading = false;

async function loadFullHistory() {
  if (_fullHistory) return _fullHistory;
  if (_histLoading) {
    // Wait for ongoing load
    await new Promise(r => { const id = setInterval(()=>{ if(_fullHistory||!_histLoading){clearInterval(id);r();} },100); });
    return _fullHistory;
  }
  _histLoading = true;
  try {
    const resp = await fetch('/api/history_all');
    if (!resp.ok) throw new Error('history API failed');
    _fullHistory = await resp.json();
  } catch(e) {
    console.error('loadFullHistory error', e);
    _fullHistory = {};
  }
  _histLoading = false;
  return _fullHistory;
}

// ═══════════════════════════════════════════════════════════════
//  HISTORY VIEW
// ═══════════════════════════════════════════════════════════════
let _histInvestorId = null;
let _histMode = 'pct';   // 'pct' | 'value'
let _histSort = { col: 'cur', dir: -1 };

async function initHistoryView() {
  const container = document.getElementById('history-content');
  container.innerHTML = '<div class="empty"><p>Loading full history…</p></div>';

  const history = await loadFullHistory();
  if (!history || !Object.keys(history).length) {
    container.innerHTML = '<div class="empty"><p>No history data available. Make sure ingest.py has been run.</p></div>';
    return;
  }

  if (!_histInvestorId) _histInvestorId = INVESTORS[0]?.id || Object.keys(history)[0];
  renderHistoryView(history);
}

function renderHistoryView(history) {
  const container = document.getElementById('history-content');

  const invOptions = INVESTORS.map(inv =>
    `<option value="${inv.id}" ${inv.id===_histInvestorId?'selected':''}>${inv.name}</option>`
  ).join('');

  container.innerHTML = `
    <div class="hist-controls">
      <div class="hist-select-wrap">
        <span class="hist-select-lbl">Investor</span>
        <select class="hist-sel" id="hist-inv-sel" onchange="onHistInvChange(this.value)">
          ${invOptions}
        </select>
      </div>
      <div class="hist-select-wrap">
        <span class="hist-select-lbl">Display</span>
        <div class="hist-mode-pills">
          <button class="hist-mode-pill ${_histMode==='pct'?'active':''}" onclick="setHistMode('pct')">% Weight</button>
          <button class="hist-mode-pill ${_histMode==='value'?'active':''}" onclick="setHistMode('value')">$ Value</button>
          <button class="hist-mode-pill ${_histMode==='shares'?'active':''}" onclick="setHistMode('shares')">Shares</button>
        </div>
      </div>
    </div>
    <div id="hist-table-container"></div>
  `;

  renderHistoryTable(history);
}

function renderHistoryTable(history) {
  const container = document.getElementById('hist-table-container');
  if (!container) return;

  const inv = INVESTORS.find(i => i.id === _histInvestorId);
  const quarters = history[_histInvestorId] || [];

  if (!quarters.length) {
    container.innerHTML = '<div class="empty"><p>No history found for this investor.</p></div>';
    return;
  }

  // quarters is newest-first, so [0] = latest
  // Build ticker universe: union of all tickers across all quarters
  const tickerMeta = {};   // ticker → { name, sector }
  quarters.forEach(q => {
    (q.holdings || []).forEach(h => {
      if (!h.ticker || h.ticker.startsWith('~')) return;
      if (!tickerMeta[h.ticker]) tickerMeta[h.ticker] = { name: h.name || h.ticker, sector: h.sector || '' };
    });
  });

  // Sort tickers by their most recent weight
  const latestMap = {};
  (quarters[0].holdings || []).forEach(h => { if (h.ticker) latestMap[h.ticker] = h; });
  const allTickers = Object.keys(tickerMeta).sort((a, b) => {
    const av = (latestMap[a]?.pct || 0);
    const bv = (latestMap[b]?.pct || 0);
    return bv - av;
  });

  // Build map: ticker → { quarter_label → holding }
  const dataMap = {};
  allTickers.forEach(t => { dataMap[t] = {}; });
  quarters.forEach(q => {
    (q.holdings || []).forEach(h => {
      if (h.ticker && dataMap[h.ticker] !== undefined) {
        dataMap[h.ticker][q.quarter] = h;
      }
    });
  });

  const qLabels = quarters.map(q => q.quarter);
  const qDates  = quarters.map(q => q.date);

  // AUM row
  const aumCells = quarters.map(q =>
    `<td class="hist-qcol" style="color:var(--text-2);font-size:0.72rem;background:var(--surface)">${fmtM(q.aum)}</td>`
  ).join('');

  const rows = allTickers.map(ticker => {
    const meta = tickerMeta[ticker];
    const cells = qLabels.map((ql, qi) => {
      const h = dataMap[ticker][ql];
      if (!h) return `<td class="hist-qcol"><span class="hist-cell-empty">—</span></td>`;

      let val, display;
      if (_histMode === 'pct') {
        val = h.pct;
        // Color by intensity
        const intensity = Math.min(1, val / 20);
        const r = Math.round(21 + intensity * (220-21));
        const g = Math.round(73 + intensity * (30-73));
        const b2 = Math.round(168 + intensity * (50-168));
        const bg = `rgba(${r},${g},${b2},${(0.08 + intensity*0.55).toFixed(2)})`;
        const fg = intensity > 0.45 ? '#fff' : 'var(--blue)';
        display = `<span class="hist-cell-val" style="background:${bg};color:${fg}">${val.toFixed(1)}%</span>`;
      } else if (_histMode === 'value') {
        val = h.value;
        display = `<span class="hist-cell-val" style="color:var(--text-1)">${fmtM(val)}</span>`;
      } else {
        val = h.shares;
        display = `<span class="hist-cell-val" style="color:var(--text-1)">${val >= 1e6 ? (val/1e6).toFixed(1)+'M' : val >= 1000 ? Math.round(val/1000)+'K' : val}</span>`;
      }
      return `<td class="hist-qcol">${display}</td>`;
    }).join('');

    return `<tr>
      <td class="sticky-col" style="min-width:180px">
        <span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--blue);font-size:0.8rem;margin-right:6px">${ticker}</span>
        <span style="color:var(--text-3);font-size:0.7rem">${(meta.name||'').substring(0,22)}</span>
        <div style="font-size:0.62rem;color:var(--text-3)">${meta.sector||''}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  const qHeaders = qLabels.map((ql, i) =>
    `<th class="hist-qcol" title="${qDates[i]}">${ql}</th>`
  ).join('');

  container.innerHTML = `
    <div style="font-size:0.78rem;color:var(--text-2);margin-bottom:0.75rem">
      <strong style="color:var(--text-1)">${inv?.name||_histInvestorId}</strong>
      · ${quarters.length} quarters · ${allTickers.length} unique positions
    </div>
    <div class="hist-table-wrap">
      <table class="hist-table">
        <thead>
          <tr>
            <th class="sticky-col" style="min-width:180px">Position</th>
            ${qHeaders}
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td class="sticky-col" style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);padding:5px 10px;background:var(--surface)">AUM</td>
            ${aumCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:0.68rem;color:var(--text-3);margin-top:8px">
      Showing all ${allTickers.length} unique tickers across ${quarters.length} quarters. Columns sorted newest → oldest.
      Pre-2013 filings not available (SEC used text format before XML standardisation).
    </p>
  `;
}

function onHistInvChange(id) {
  _histInvestorId = id;
  loadFullHistory().then(h => renderHistoryTable(h));
}

function setHistMode(mode) {
  _histMode = mode;
  document.querySelectorAll('.hist-mode-pill').forEach(p => {
    p.classList.toggle('active', p.textContent.toLowerCase().includes(
      mode === 'pct' ? '%' : mode === 'value' ? '$' : 'shares'
    ));
  });
  loadFullHistory().then(h => renderHistoryTable(h));
}


// ═══════════════════════════════════════════════════════════════
//  PORTFOLIO LAB
// ═══════════════════════════════════════════════════════════════
