// page-investors.js — Investors view: grid, detail panel and its tabs.
function filterInvestors(query) {
  const q = query.trim().toLowerCase();
  const clearBtn = document.getElementById('inv-search-clear');
  const countEl  = document.getElementById('inv-search-count');
  const cards    = document.querySelectorAll('.inv-card');
  clearBtn.style.display = q ? 'flex' : 'none';
  let visible = 0;
  cards.forEach(card => {
    const inv = INVESTORS.find(i => i.id === card.dataset.id);
    if (!inv) return;
    const hay = [inv.name, inv.firm, inv.strategy, inv.category||''].join(' ').toLowerCase();
    const match = !q || hay.includes(q);
    card.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  let noRes = document.getElementById('inv-no-results');
  if (visible === 0 && q) {
    if (!noRes) { noRes = document.createElement('div'); noRes.id='inv-no-results'; noRes.className='inv-no-results'; document.getElementById('inv-grid').appendChild(noRes); }
    noRes.textContent = `No investors match "${query}"`;
  } else if (noRes) { noRes.remove(); }
  if (q) { countEl.style.display='block'; countEl.textContent=`${visible} of ${INVESTORS.length} investors`; }
  else countEl.style.display='none';
}
function clearInvestorSearch() {
  const input = document.getElementById('inv-search-input');
  input.value = ''; filterInvestors(''); input.focus();
}










/* ---- LOADING UI ---- */
function renderInvGrid() {
  const grid = document.getElementById('inv-grid');
  grid.innerHTML = '';
  INVESTORS.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'inv-card';
    card.dataset.id = inv.id;
    const top10 = (inv.holdings || []).slice(0, 10);
    const othPct = Math.max(
      0,
      100 - top10.reduce((s,h) => s + h.pct, 0)
    );
    const donutId = 'donut-' + inv.id;
    card.innerHTML = `
      <div class="inv-card-top">
        <div class="inv-card-info">
          <div class="inv-card-name">${inv.name}</div>
          <div class="inv-card-firm">${inv.firm}</div>
        </div>
        <div class="inv-card-badge">${(inv.strategy||'').split(' / ')[0]}</div>
      </div>
      <div class="inv-card-donut">
        <div class="donut-wrap">
          <canvas id="${donutId}"></canvas>
          <div class="donut-center">
            <span class="donut-center-pct">TOP 10</span>
            <span class="donut-center-tick">POSITIONS</span>
          </div>
        </div>
        <div class="donut-legend">
          ${top10.map((h,i) => `
            <div class="donut-leg-item">
              <span class="donut-leg-dot" style="background:${PALETTE[i]}"></span>
              <span class="donut-leg-name">${h.ticker}</span>
              <span class="donut-leg-pct">${h.pct.toFixed(1)}%</span>
            </div>`).join('')}
          ${othPct > 0.5 ? `<div class="donut-leg-item">
            <span class="donut-leg-dot" style="background:#d1cfc8"></span>
            <span class="donut-leg-name">Others</span>
            <span class="donut-leg-pct">${othPct.toFixed(1)}%</span>
          </div>` : ''}
        </div>
      </div>
      <div class="inv-card-footer">
        <div class="inv-card-aum">${fmtM(inv.aumRaw)}</div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          ${(()=>{
            const p = inv.portfolioPerfSinceFiling;
            const filingDate = inv.positionsAsOf || inv.filingDate || '';
            const daysAgo = filingDate ? Math.round((Date.now() - new Date(filingDate)) / 86400000) : null;
            const lagStr = daysAgo !== null ? daysAgo + 'd ago' : '';
            if (p === null || p === undefined) return '<div class="inv-card-q">' + lagStr + '</div>';
            const cls = p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat';
            const sign = p > 0 ? '+' : '';
            return '<span class="inv-card-perf ' + cls + '">' + sign + p.toFixed(1) + '% since filing</span>' +
                   '<div class="inv-card-q">' + lagStr + '</div>';
          })()}
        </div>
      </div>
    `;
    card.onclick = () => selectInvestor(inv.id);
    grid.appendChild(card);
  });

  // Populate compare selects
  ['cmp-a','cmp-b'].forEach((id, i) => {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    INVESTORS.forEach((inv, j) => {
      const opt = document.createElement('option');
      opt.value = inv.id; opt.textContent = inv.name;
      if (j === i) opt.selected = true;
      sel.appendChild(opt);
    });
    if (i === 1 && INVESTORS[1]) document.getElementById(id).value = INVESTORS[1].id;
  });

  requestAnimationFrame(() => INVESTORS.forEach(inv => drawDonut(inv)));
}

function drawDonut(inv) {
  const id = 'donut-' + inv.id;
  const el = document.getElementById(id);
  if (!el) return;
  if (donutCharts[id]) donutCharts[id].destroy();

  const top10 = (inv.holdings || []).slice(0, 10);
  const rest = Math.max(0, 100 - top10.reduce((s,h) => s + h.pct, 0));
  const data = [...top10.map(h => h.pct), rest > 0.5 ? rest : 0];
  const colors = [...top10.map((_,i) => PALETTE[i % PALETTE.length]), '#d1cfc8'];

  donutCharts[id] = new Chart(el, {
    type:'doughnut',
    data:{ datasets:[{ data, backgroundColor:colors, borderWidth:1.5, borderColor:'#ffffff', hoverBorderWidth:2 }] },
    options:{ responsive:false, cutout:'65%', plugins:{ legend:{display:false}, tooltip:{enabled:false} }, animation:{duration:400} }
  });
}

function selectInvestor(id) {
  currentTab = 'bubble';
  currentInvestor = INVESTORS.find(i => i.id === id);
  document.querySelectorAll('.inv-card').forEach(c => c.classList.toggle('active', c.dataset.id===id));
  renderDetailPanel();
  enrichInvestor(id);          // lazily fetch prices/fundamentals for this investor
}

// Fetch price + fundamentals for ONE investor on demand. The server does not
// enrich at startup (that caused OOM), so we fill the price columns here when
// an investor is actually opened. Silent on failure — the 13F table stays valid.
async function enrichInvestor(id) {
  const inv = INVESTORS.find(i => i.id === id);
  if (!inv || inv._enriched) return;              // already done this session
  try {
    const res = await fetch('/api/enrich/' + encodeURIComponent(id));
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;

    inv.holdings = data.holdings;                  // now carry priceAtFiling/currentPrice/etc.
    inv.portfolioPerfSinceFiling = data.portfolioPerfSinceFiling;
    inv._enriched = true;

    // If the user is still looking at this investor, re-render so the
    // Current Price / Since Filing / Mkt Cap / P/E columns populate.
    if (currentInvestor && currentInvestor.id === id) {
      renderTab();
    }
  } catch (e) {
    /* silent — un-enriched table is still correct */
  }
}


function renderDetailPanel() {
  if (!currentInvestor) return;
  const inv = currentInvestor;
  const panel = document.getElementById('detail-panel');
  const totalVal = (inv.holdings||[]).reduce((s,h)=>s+h.value,0);
  panel.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="detail-name">${inv.name}</div>
        <div class="detail-firm-line">${inv.firm} · ${inv.strategy}</div>
        <div class="detail-metas">
          <div class="detail-meta-item">Portfolio value <strong>${fmtM(totalVal)}</strong></div>
          <div class="detail-meta-item">Positions <strong>${(inv.holdings||[]).length}</strong></div>
          <div class="detail-meta-item">Last filing date <strong>${inv.lastFilingDate || inv.filingDate || inv.latestQ}</strong></div>
          <div class="detail-meta-item">AUM <strong>${fmtM(inv.aumRaw)}</strong></div>
        </div>
      </div>
    </div>
    <div class="detail-tabs">
      <button class="dtab ${currentTab==='bubble'?'active':''}" onclick="switchTab('bubble')">Bubble Chart</button>
      <button class="dtab ${currentTab==='list'?'active':''}" onclick="switchTab('list')">All Positions</button>
      <button class="dtab ${currentTab==='changes'?'active':''}" onclick="switchTab('changes')">QoQ Changes</button>
      <button class="dtab ${currentTab==='history'?'active':''}" onclick="switchTab('history')">📈 History</button>
    </div>
    <div class="detail-body" id="detail-body"></div>
  `;
  renderTab();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.dtab').forEach(t => {
    const m = (t.getAttribute('onclick')||'').match(/'(\w+)'/);
    t.classList.toggle('active', m ? m[1] === tab : false);
  });
  renderTab();
}

function renderTab() {
  const body = document.getElementById('detail-body');
  if (!body) return;
  if (currentTab==='bubble') renderBubble(body);
  else if (currentTab==='list') renderList(body);
  else if (currentTab==='changes') renderChanges(body);
  else if (currentTab==='history') renderHistory(body);
}


function renderHistory(container) {
  const inv = currentInvestor;
  const history = inv.holdingsHistory || [];

  // Build quarter list: current quarter first, then history
  const allQuarters = [
    { quarter: inv.latestQ, date: inv.filingDate, holdings: inv.holdings || [] },
    ...history
  ];

  if (allQuarters.length < 2) {
    container.innerHTML = '<div class="empty"><p>Not enough historical data available yet.</p></div>';
    return;
  }

  // Get all tickers that appear in any quarter, sorted by current weight
  const currentHoldings = inv.holdings || [];
  const topTickers = currentHoldings.slice(0, 20).map(h => h.ticker);

  // Also include tickers that were held in past but not now (exited positions)
  const allTickers = new Set(topTickers);
  history.forEach(q => {
    (q.holdings || []).slice(0, 30).forEach(h => allTickers.add(h.ticker));
  });

  // Build a map: ticker → [{quarter, pct, value}]
  const tickerData = {};
  [...allTickers].forEach(t => { tickerData[t] = {}; });

  allQuarters.forEach(q => {
    (q.holdings || []).forEach(h => {
      if (tickerData[h.ticker] !== undefined) {
        tickerData[h.ticker][q.quarter] = { pct: h.pct, value: h.value };
      }
    });
  });

  const quarters = allQuarters.map(q => q.quarter);
  const displayTickers = [...allTickers].filter(t => !t.startsWith('~')).slice(0, 20);

  // Simple table: rows = tickers, cols = quarters
  const colHeaders = quarters.map(q => `<th style="text-align:right;padding:6px 12px;font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--text-2)">${q}</th>`).join('');

  const rows = displayTickers.map(ticker => {
    const name = (currentHoldings.find(h=>h.ticker===ticker) || history.flatMap(q=>q.holdings||[]).find(h=>h.ticker===ticker) || {}).name || ticker;
    const cells = quarters.map(q => {
      const d = tickerData[ticker][q];
      if (!d) return '<td style="text-align:right;padding:6px 12px;color:var(--text-3);font-size:0.78rem">—</td>';
      // Color by whether position grew, shrank, or is new vs previous quarter
      const qIdx = quarters.indexOf(q);
      const prevQ = quarters[qIdx + 1];
      const prevD = prevQ ? tickerData[ticker][prevQ] : null;
      let color = 'var(--text-1)';
      let arrow = '';
      if (prevD) {
        if (d.pct > prevD.pct + 0.2) { color='var(--green)'; arrow='↑'; }
        else if (d.pct < prevD.pct - 0.2) { color='var(--red)'; arrow='↓'; }
      } else if (qIdx === 0) {
        // newest quarter, no prev to compare — neutral
      } else {
        color = 'var(--amber)'; arrow = 'NEW';
      }
      return `<td style="text-align:right;padding:6px 12px;font-family:'DM Mono',monospace;font-size:0.78rem;color:${color}">${arrow ? '<span style="font-size:0.65rem;margin-right:2px">'+ arrow +'</span>' : ''}${d.pct.toFixed(1)}%</td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 12px;font-size:0.8rem;white-space:nowrap">
        <span style="font-family:'DM Mono',monospace;font-weight:600;color:var(--blue);margin-right:6px">${ticker}</span>
        <span style="color:var(--text-3);font-size:0.72rem">${name}</span>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 12px;font-size:0.72rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em">Position</th>
            ${colHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:0.68rem;color:var(--text-3);margin-top:12px;padding:0 12px">
        Shows top 20 current positions + any that appeared in past quarters. ↑↓ = grew/shrank vs prior quarter.
      </p>
    </div>
  `;
}

function renderBubble(container) {
  const inv = currentInvestor;
  const holdings = [...(inv.holdings||[])].filter(h => !h.ticker.startsWith('~'));
  const prevHoldings = inv.holdingsPrev || [];

  // ── Sector colour map (stable across investors) ──
  const SECTOR_PALETTE = {
    'Technology':              '#2563eb',
    'Financial Services':      '#16a34a',
    'Healthcare':              '#dc2626',
    'Consumer Cyclical':       '#d97706',
    'Communication Services':  '#7c3aed',
    'Industrials':             '#475569',
    'Consumer Defensive':      '#0891b2',
    'Energy':                  '#b45309',
    'Basic Materials':         '#65a30d',
    'Real Estate':             '#be185d',
    'Utilities':               '#0d9488',
  };
  const FALLBACK_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316','#a855f7'];

  function sectorColor(name, idx) {
    return SECTOR_PALETTE[name] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  }

  // Short labels for bubbles
  const SHORT = {
    'Technology':'Tech','Financial Services':'Finance','Healthcare':'Health',
    'Consumer Cyclical':'Cons. Cycl.','Communication Services':'Comm. Svcs',
    'Industrials':'Industrials','Consumer Defensive':'Cons. Def.',
    'Energy':'Energy','Basic Materials':'Materials','Real Estate':'Real Est.',
    'Utilities':'Utilities',
  };

  // ── Aggregate current holdings by sector ──
  const sectorMap = {};
  holdings.forEach(h => {
    const sec = h.sector || 'Other';
    if (!sectorMap[sec]) sectorMap[sec] = { sector: sec, value: 0, pct: 0, count: 0, holdings: [] };
    sectorMap[sec].value += h.value;
    sectorMap[sec].pct += h.pct;
    sectorMap[sec].count++;
    sectorMap[sec].holdings.push(h);
  });

  // ── Aggregate previous quarter by sector ──
  const prevSectorMap = {};
  prevHoldings.forEach(h => {
    const sec = h.sector || 'Other';
    if (!prevSectorMap[sec]) prevSectorMap[sec] = { pct: 0, value: 0 };
    prevSectorMap[sec].pct += h.pct;
    prevSectorMap[sec].value += h.value;
  });

  const sectors = Object.values(sectorMap).sort((a, b) => b.pct - a.pct);
  sectors.forEach(s => s.holdings.sort((a, b) => b.pct - a.pct));

  // ── Circle-packing layout ──
  // Place largest first at center, then greedily pack smaller circles
  const maxR = 55, minR = 14;
  const maxPct = sectors[0]?.pct || 1;
  function radius(pct) { return Math.max(minR, Math.sqrt(pct / maxPct) * maxR); }

  const placed = [];
  const cx = 50, cy = 50;
  sectors.forEach((s, i) => {
    const r = radius(s.pct);
    if (i === 0) { placed.push({ x: cx, y: cy, r, s }); return; }
    // Try angles around existing circles to find closest fit to center
    let bestX = cx, bestY = cy, bestDist = Infinity;
    for (let ref = 0; ref < placed.length; ref++) {
      for (let a = 0; a < 36; a++) {
        const angle = (a / 36) * Math.PI * 2;
        const tx = placed[ref].x + Math.cos(angle) * (placed[ref].r + r + 2);
        const ty = placed[ref].y + Math.sin(angle) * (placed[ref].r + r + 2);
        // Check overlap with all placed
        let overlap = false;
        for (const p of placed) {
          const dx = tx - p.x, dy = ty - p.y;
          if (Math.sqrt(dx*dx + dy*dy) < p.r + r + 1.5) { overlap = true; break; }
        }
        if (!overlap) {
          const dist = Math.sqrt((tx-cx)*(tx-cx)+(ty-cy)*(ty-cy));
          if (dist < bestDist) { bestDist = dist; bestX = tx; bestY = ty; }
        }
      }
    }
    placed.push({ x: bestX, y: bestY, r, s });
  });

  // Normalize coordinates to 0-100 range with padding
  const pad = 8;
  const xs = placed.map(p => [p.x - p.r, p.x + p.r]).flat();
  const ys = placed.map(p => [p.y - p.r, p.y + p.r]).flat();
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
  const scale = Math.min((100 - 2*pad) / xSpan, (100 - 2*pad) / ySpan);
  const xOff = 50 - ((xMin + xMax) / 2) * scale + (1 - scale) * 50;
  const yOff = 50 - ((yMin + yMax) / 2) * scale + (1 - scale) * 50;

  const data = placed.map((p, i) => ({
    x: p.x * scale + xOff,
    y: p.y * scale + yOff,
    r: p.r * scale,
    label: SHORT[p.s.sector] || p.s.sector,
    s: p.s,
  }));

  // ── Render HTML ──
  container.innerHTML = `
    <div class="bubble-wrap">
      <div class="bubble-area">
        <canvas id="bigBubble" role="img" aria-label="Sector breakdown of ${inv.name} portfolio"></canvas>
        <div class="btip" id="btip">
          <div class="btip-ticker" id="bt-tick"></div>
          <div class="btip-name" id="bt-name"></div>
          <div class="btip-row"><span>Weight</span><span class="btip-val" id="bt-pct"></span></div>
          <div class="btip-row"><span>Value</span><span class="btip-val" id="bt-val"></span></div>
          <div class="btip-row"><span>Positions</span><span class="btip-val" id="bt-sec"></span></div>
          <div class="btip-row" id="bt-chg-row" style="display:none"><span>QoQ Δ</span><span class="btip-val" id="bt-chg"></span></div>
          <div class="btip-row" id="bt-top-row"><span>Top</span><span class="btip-val" id="bt-top" style="font-size:0.72rem"></span></div>
        </div>
      </div>
      <div class="bubble-legend">
        <div class="bl-title">SECTOR BREAKDOWN</div>
        <div id="bl-items"></div>
      </div>
    </div>`;

  // ── Legend ──
  const legendEl = document.getElementById('bl-items');
  sectors.forEach((s, i) => {
    const prev = prevSectorMap[s.sector];
    let badge = '';
    if (prev) {
      const c = pctChg(s.pct, prev.pct);
      const sign = c > 0 ? '+' : '';
      badge = `<span class="bl-chg ${c > 0 ? 'chg-up' : c < 0 ? 'chg-dn' : 'chg-flat'}">${sign}${c}%</span>`;
    }
    const col = sectorColor(s.sector, i);
    const topTickers = s.holdings.slice(0, 3).map(h => h.ticker).join(', ');
    legendEl.innerHTML += `<div class="bl-item">
      <span class="bl-dot" style="background:${col}"></span>
      <span class="bl-name" style="flex:1">${SHORT[s.sector] || s.sector}</span>
      <span class="bl-pct">${s.pct.toFixed(1)}%</span>
      ${badge}
    </div>`;
  });

  // ── Chart.js ──
  const colors = data.map((d, i) => sectorColor(d.s.sector, i));
  const ctx = document.getElementById('bigBubble');
  new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverBorderWidth: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: 20 },
      scales: { x: { display: false, min: 0, max: 100 }, y: { display: false, min: 0, max: 100 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (tCtx) => {
            const tip = document.getElementById('btip');
            if (tCtx.tooltip.opacity === 0) { tip.style.opacity = '0'; return; }
            const dp = tCtx.tooltip.dataPoints?.[0]; if (!dp) return;
            const s = dp.raw.s;
            document.getElementById('bt-tick').textContent = s.sector;
            document.getElementById('bt-name').textContent = s.count + ' positions';
            document.getElementById('bt-pct').textContent = s.pct.toFixed(1) + '%';
            document.getElementById('bt-val').textContent = fmtM(s.value);
            document.getElementById('bt-sec').textContent = s.count;
            const topStr = s.holdings.slice(0, 5).map(h => h.ticker + ' ' + h.pct.toFixed(1) + '%').join(', ');
            document.getElementById('bt-top').textContent = topStr;
            const prev = prevSectorMap[s.sector];
            const cr = document.getElementById('bt-chg-row');
            if (prev) {
              const c = pctChg(s.pct, prev.pct);
              document.getElementById('bt-chg').textContent = (c > 0 ? '+' : '') + c + '%';
              cr.style.display = 'flex';
            } else { cr.style.display = 'none'; }
            tip.style.left = (tCtx.tooltip.caretX + 18) + 'px';
            tip.style.top = (tCtx.tooltip.caretY - 10) + 'px';
            tip.style.opacity = '1';
          }
        }
      }
    },
    plugins: [{
      id: 'sectorLabels',
      afterDatasetsDraw(chart) {
        const x = chart.ctx;
        chart.data.datasets[0].data.forEach((d, i) => {
          const meta = chart.getDatasetMeta(0);
          const el = meta.data[i]; if (!el) return;
          const { x: px, y: py } = el.getCenterPoint();
          const r = el.options.radius;
          x.save();
          // Label
          const fontSize = Math.max(9, Math.min(r * 0.32, 14));
          x.fillStyle = '#fff';
          x.font = `600 ${fontSize}px "DM Sans", sans-serif`;
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          // Split label if bubble big enough
          if (r > 28) {
            x.fillText(d.label, px, py - fontSize * 0.55);
            x.font = `400 ${Math.max(8, fontSize * 0.78)}px "DM Sans", sans-serif`;
            x.fillStyle = 'rgba(255,255,255,0.85)';
            x.fillText(d.s.pct.toFixed(1) + '%', px, py + fontSize * 0.55);
          } else {
            x.fillText(d.label, px, py);
          }
          x.restore();
        });
      }
    }]
  });
}

function renderList(container) {
  const inv = currentInvestor;
  const prevMap = {};
  (inv.holdingsPrev||[]).forEach(h => prevMap[h.ticker]=h);
  const sorted = [...(inv.holdings||[])].filter(h=>!h.ticker.startsWith('~')).sort((a,b)=>sortDir*(a[sortCol]<b[sortCol]?-1:1));
  container.innerHTML = `<table class="pos-table">
    <thead><tr>
      <th onclick="resort('ticker')">Ticker</th><th onclick="resort('name')">Company</th>
      <th onclick="resort('sector')">Sector</th><th>Type</th><th onclick="resort('value')">Value</th>
      <th onclick="resort('shares')">Shares</th><th onclick="resort('pct')">Weight</th><th>QoQ Δ</th>
      <th onclick="resort('perfSinceFiling')">Since Filing</th><th>Current Price</th>
      <th>Mkt Cap</th><th>Fwd P/E</th><th>P/E</th><th>EV/EBITDA</th><th>Rev Growth</th><th>52w High</th><th>Analyst Target</th>
    </tr></thead>
    <tbody>${sorted.map(h=>{
      const prev=prevMap[h.ticker];
      let badge=`<span class="chg-badge chg-new">NEW</span>`;
      if(prev){const c=(h.pct-prev.pct);const s=c>0?'+':'';const abs=Math.abs(c);badge=`<span class="chg-badge ${c>0.1?'chg-up':c<-0.1?'chg-dn':'chg-flat'}">${s}${abs.toFixed(1)}pp</span>`;}
      const perf = h.perfSinceFiling;
      const perfCls = perf === null || perf === undefined ? '' : perf > 0.5 ? 'up' : perf < -0.5 ? 'down' : '';
      const perfStr = perf === null || perf === undefined ? '<span style="color:var(--text-3)">—</span>'
        : '<span class="perf-col ' + perfCls + '">' + (perf > 0 ? '+' : '') + perf.toFixed(1) + '%</span>';
      const priceStr = h.currentPrice
        ? '$' + h.currentPrice.toFixed(2) + (h.priceAtFiling ? '<span style="color:var(--text-3);font-size:0.7rem;margin-left:4px">vs $' + h.priceAtFiling.toFixed(2) + '</span>' : '')
        : '<span style="color:var(--text-3)">—</span>';
      const typeCell = h.putCall
        ? `<span style="font-size:0.7rem;font-weight:700;padding:2px 6px;border-radius:3px;background:${h.putCall==='PUT'?'#fee2e2':'#dcfce7'};color:${h.putCall==='PUT'?'#991b1b':'#166534'}">${h.putCall}</span>`
        : '<span style="font-size:0.7rem;color:var(--text-3)">SHS</span>';
      const rowBg = h.putCall==='PUT'?'background:#fff8f8;':h.putCall==='CALL'?'background:#f8fff8;':'';
      return `<tr style="${rowBg}">
        <td class="tc">${h.ticker}</td><td>${h.name}</td>
        <td style="font-size:0.75rem;color:var(--text-2)">${h.sector||'—'}</td>
        <td>${typeCell}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.8rem">${fmtM(h.value)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--text-2)">${h.shares.toLocaleString()}</td>
        <td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:${Math.min(100,h.pct/sorted[0].pct*100)}%"></div></div><span class="pct-n">${h.pct.toFixed(1)}%</span></div></td>
        <td>${badge}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.8rem">${perfStr}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.75rem">${priceStr}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-2)">${h.marketCap ? fmtMktCap(h.marketCap) : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-2)">${h.forwardPE != null ? h.forwardPE.toFixed(1)+'x' : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-2)">${h.trailingPE != null ? h.trailingPE.toFixed(1)+'x' : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-2)">${h.evToEbitda != null ? h.evToEbitda.toFixed(1)+'x' : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;${h.revenueGrowth!=null?(h.revenueGrowth>0?'color:var(--green)':'color:var(--red)'):'color:var(--text-2)'}">${h.revenueGrowth != null ? (h.revenueGrowth>0?'+':'')+(h.revenueGrowth*100).toFixed(1)+'%' : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-2)">${h.pctFrom52wHigh != null ? (h.pctFrom52wHigh>0?'+':'')+h.pctFrom52wHigh+'%' : '—'}</td>
        <td style="font-family:'DM Mono',monospace;font-size:0.72rem;color:${h.analystUpside!=null&&h.analystUpside>0?'var(--green)':'var(--text-2)'}">${h.targetPrice != null ? '$'+h.targetPrice.toFixed(0)+(h.analystUpside!=null?' ('+(h.analystUpside>0?'+':'')+h.analystUpside+'%)':'') : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function resort(col) {
  if(sortCol===col) sortDir*=-1; else{sortCol=col;sortDir=-1;}
  renderList(document.getElementById('detail-body'));
}

function renderChanges(container) {
  const inv = currentInvestor;
  const prevMap = {};
  (inv.holdingsPrev||[]).forEach(h => prevMap[h.ticker]=h);
  const newPos=(inv.holdings||[]).filter(h=>!prevMap[h.ticker]);
  const exits=(inv.holdingsPrev||[]).filter(h=>!(inv.holdings||[]).find(p=>p.ticker===h.ticker));
  const increased=(inv.holdings||[]).filter(h=>prevMap[h.ticker]&&h.pct>prevMap[h.ticker].pct).sort((a,b)=>(b.pct-prevMap[b.ticker].pct)-(a.pct-prevMap[a.ticker].pct));
  const decreased=(inv.holdings||[]).filter(h=>prevMap[h.ticker]&&h.pct<prevMap[h.ticker].pct).sort((a,b)=>(prevMap[a.ticker].pct-a.pct)-(prevMap[b.ticker].pct-b.pct));
  const totP=(inv.holdingsPrev||[]).reduce((s,h)=>s+h.value,0);
  const totC=(inv.holdings||[]).reduce((s,h)=>s+h.value,0);
  const pgC=pctChg(totC,totP);
  const sec=(lbl,items,fn)=>items.length?`<div class="chg-section-lbl">${lbl}</div><div class="chg-grid">${items.map(fn).join('')}</div>`:'';
  container.innerHTML = `
    <div class="cmp-cards">
      <div class="cmp-card"><div class="cmp-card-lbl">New</div><div class="cmp-card-n" style="color:var(--amber)">${newPos.length}</div></div>
      <div class="cmp-card"><div class="cmp-card-lbl">Exited</div><div class="cmp-card-n" style="color:var(--red)">${exits.length}</div></div>
      <div class="cmp-card"><div class="cmp-card-lbl">Portfolio Δ</div><div class="cmp-card-n" style="color:${pgC>=0?'var(--green)':'var(--red)'}">${pgC>=0?'+':''}${pgC}%</div></div>
    </div>
    ${sec('New Positions',newPos,h=>`<div class="chg-row"><div class="chg-row-l"><div class="chg-ticker">${h.ticker}</div><div class="chg-name">${h.name}</div></div><div class="chg-row-r"><div class="chg-val" style="color:var(--amber)">${h.pct.toFixed(1)}%</div><div style="font-size:0.68rem;color:var(--text-3)">${fmtM(h.value)}</div></div></div>`)}
    ${sec('Exited',exits,h=>`<div class="chg-row"><div class="chg-row-l"><div class="chg-ticker">${h.ticker}</div><div class="chg-name">${h.name}</div></div><div class="chg-row-r"><div class="chg-val" style="color:var(--red)">Exited</div><div style="font-size:0.68rem;color:var(--text-3)">was ${h.pct.toFixed(1)}%</div></div></div>`)}
    ${sec('Increased',increased,h=>{const p=prevMap[h.ticker];const c=pctChg(h.pct,p.pct);return`<div class="chg-row"><div class="chg-row-l"><div class="chg-ticker">${h.ticker}</div><div class="chg-name">${p.pct.toFixed(1)}% → ${h.pct.toFixed(1)}%</div></div><div class="chg-row-r"><div class="chg-val" style="color:var(--green)">+${c}%</div><div style="font-size:0.68rem;color:var(--text-3)">${fmtM(h.value)}</div></div></div>`;})}
    ${sec('Reduced',decreased,h=>{const p=prevMap[h.ticker];const c=pctChg(h.pct,p.pct);return`<div class="chg-row"><div class="chg-row-l"><div class="chg-ticker">${h.ticker}</div><div class="chg-name">${p.pct.toFixed(1)}% → ${h.pct.toFixed(1)}%</div></div><div class="chg-row-r"><div class="chg-val" style="color:var(--red)">${c}%</div><div style="font-size:0.68rem;color:var(--text-3)">${fmtM(h.value)}</div></div></div>`;})}`
}