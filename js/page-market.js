// page-market.js — Market View + New Positions Radar.
let _mvSection = 'flow'; // active sub-section

function switchMvSection(name) {
  _mvSection = name;
  document.querySelectorAll('.mv-section').forEach(s => s.classList.toggle('active', s.dataset.mv === name));
  document.querySelectorAll('.mv-tab').forEach(t => t.classList.toggle('active', t.dataset.mv === name));
}

function aggregateMarketData() {
  const sectorMap = {};
  const prevSectorMap = {};
  const companyMap = {};
  const prevCompanyMap = {};
  let totalValue = 0;
  let prevTotalValue = 0;

  INVESTORS.forEach(inv => {
    (inv.holdings || []).forEach(h => {
      const sector = h.sector || 'Other';
      totalValue += h.value || 0;
      if (!sectorMap[sector]) sectorMap[sector] = { sector, value:0, investors:new Set(), positions:0 };
      sectorMap[sector].value += h.value || 0;
      sectorMap[sector].positions += 1;
      sectorMap[sector].investors.add(inv.name);

      const key = h.ticker || h.name;
      if (!companyMap[key]) companyMap[key] = { ticker:h.ticker, name:h.name, sector, value:0, investors:new Set(), positions:0 };
      companyMap[key].value += h.value || 0;
      companyMap[key].positions += 1;
      companyMap[key].investors.add(inv.name);
    });

    (inv.holdingsPrev || []).forEach(h => {
      const sector = h.sector || 'Other';
      prevTotalValue += h.value || 0;
      if (!prevSectorMap[sector]) prevSectorMap[sector] = { sector, value:0 };
      prevSectorMap[sector].value += h.value || 0;

      const key = h.ticker || h.name;
      if (!prevCompanyMap[key]) prevCompanyMap[key] = { ticker:h.ticker, name:h.name, value:0 };
      prevCompanyMap[key].value += h.value || 0;
    });
  });

  const sectors = Object.values(sectorMap).map(s => {
    const prev = prevSectorMap[s.sector];
    const pct = totalValue ? s.value / totalValue * 100 : 0;
    const prevPct = prevTotalValue && prev ? prev.value / prevTotalValue * 100 : 0;
    return { ...s, pct, prevPct, change: prev ? pct - prevPct : null, investorCount:s.investors.size };
  }).sort((a,b)=>b.value-a.value);

  const companies = Object.values(companyMap).map(c => {
    const prev = prevCompanyMap[c.ticker || c.name];
    const pct = totalValue ? c.value / totalValue * 100 : 0;
    const prevPct = prevTotalValue && prev ? prev.value / prevTotalValue * 100 : 0;
    return { ...c, pct, prevPct, change: prev ? pct - prevPct : null, investorCount:c.investors.size };
  }).sort((a,b)=>b.value-a.value);

  const risingCompanies = companies.filter(c => c.change !== null).sort((a,b)=>b.change-a.change).slice(0,5);
  const fallingCompanies = companies.filter(c => c.change !== null).sort((a,b)=>a.change-b.change).slice(0,5);

  return { sectors, companies, risingCompanies, fallingCompanies, totalValue, prevTotalValue };
}

function trendBadge(change) {
  if (change === null || Number.isNaN(change)) return '<span class="market-trend chg-new">NEW</span>';
  const cls = change > 0.05 ? 'chg-up' : change < -0.05 ? 'chg-dn' : 'chg-flat';
  const sign = change > 0 ? '+' : '';
  return `<span class="market-trend ${cls}">${sign}${change.toFixed(1)}pp</span>`;
}

function renderMarketRows(items, maxValue, type='sector') {
  return items.map(item => {
    const label = type === 'sector' ? item.sector : item.ticker;
    const sub = type === 'sector'
      ? `${item.investorCount} investors · ${item.positions} positions`
      : `${item.name} · ${item.sector}`;
    const chips = type === 'company'
      ? `<div class="company-investors">${[...item.investors].slice(0,4).map(n=>`<span class="investor-chip">${n.split(' ').pop()}</span>`).join('')}${item.investorCount>4?`<span class="investor-chip">+${item.investorCount-4}</span>`:''}</div>`
      : '';
    return `<div class="market-row">
      <div><div class="market-name">${label}</div><div class="market-meta">${sub}</div>${chips}</div>
      <div class="market-bar"><div class="market-fill" style="width:${Math.min(100, item.value / maxValue * 100)}%"></div></div>
      <div class="market-num">${item.pct.toFixed(1)}%</div>
      ${trendBadge(item.change)}
    </div>`;
  }).join('');
}

function renderMarketView() {
  const container = document.getElementById('market-result');
  if (!container) return;
  const m = aggregateMarketData();
  if (!m.totalValue) {
    container.innerHTML = '<div class="empty"><p>No holdings data available yet.</p></div>';
    return;
  }

  /* ── KPI calculations ── */
  const totalInvestors = INVESTORS.length;
  const allHoldings = INVESTORS.flatMap(inv => (inv.holdings||[]).map(h=>({...h, invId:inv.id, invName:inv.name})));
  const allPrev = INVESTORS.flatMap(inv => (inv.holdingsPrev||[]).map(h=>({...h, invId:inv.id, invName:inv.name})));

  // Unique tickers held
  const uniqueTickers = new Set(allHoldings.map(h=>h.ticker)).size;

  // Most crowded stock (most investors holding it)
  const tickerInvCount = {};
  allHoldings.forEach(h => { tickerInvCount[h.ticker] = (tickerInvCount[h.ticker]||new Set()); tickerInvCount[h.ticker].add(h.invId); });
  const mostCrowded = Object.entries(tickerInvCount).sort((a,b)=>b[1].size-a[1].size)[0];

  // New positions this quarter (in current but not prev) across all investors
  const prevTickers = new Set(allPrev.map(h=>h.invId+'_'+h.ticker));
  const newEntries = allHoldings.filter(h => !prevTickers.has(h.invId+'_'+h.ticker));
  const newTickerCount = {};
  newEntries.forEach(h => { newTickerCount[h.ticker] = (newTickerCount[h.ticker]||0)+1; });
  const topNewEntry = Object.entries(newTickerCount).sort((a,b)=>b[1]-a[1])[0];

  // Smart money net flow top mover
  const companyMap = {};
  const prevCompanyMap = {};
  INVESTORS.forEach(inv => {
    (inv.holdings||[]).forEach(h => {
      if(!companyMap[h.ticker]) companyMap[h.ticker]={ticker:h.ticker,name:h.name,sector:h.sector||'Other',value:0,investors:new Set(),pctSum:0};
      companyMap[h.ticker].value += h.value||0;
      companyMap[h.ticker].pctSum += h.pct||0;
      companyMap[h.ticker].investors.add(inv.name);
    });
    (inv.holdingsPrev||[]).forEach(h => {
      if(!prevCompanyMap[h.ticker]) prevCompanyMap[h.ticker]={value:0,pctSum:0};
      prevCompanyMap[h.ticker].value += h.value||0;
      prevCompanyMap[h.ticker].pctSum += h.pct||0;
    });
  });
  const companies = Object.values(companyMap).map(c => {
    const prev = prevCompanyMap[c.ticker];
    const avgPct = c.pctSum / (c.investors.size||1);
    const prevAvgPct = prev ? prev.pctSum / Math.max(1, INVESTORS.filter(i=>(i.holdingsPrev||[]).find(h=>h.ticker===c.ticker)).length) : 0;
    const flow = prev ? c.value - prev.value : c.value;
    return { ...c, avgPct, prevAvgPct, flow, investorCount: c.investors.size,
             investorNames: [...c.investors] };
  }).sort((a,b)=>b.value-a.value);

  const topFlow = [...companies].filter(c=>prevCompanyMap[c.ticker]).sort((a,b)=>b.flow-a.flow)[0];

  /* ── Crowding scores ── */
  // Score = (# investors holding / total) * 50 + (avg weight / max avg weight) * 50
  const maxAvgPct = Math.max(...companies.map(c=>c.avgPct), 1);
  const crowdScores = companies.map(c => ({
    ...c,
    crowdScore: Math.round((c.investorCount / totalInvestors)*50 + (c.avgPct / maxAvgPct)*50)
  })).sort((a,b)=>b.crowdScore-a.crowdScore);

  /* ── New positions radar ── */
  const newByTicker = {};
  INVESTORS.forEach(inv => {
    const prevSet = new Set((inv.holdingsPrev||[]).map(h=>h.ticker));
    const invStrategy = (inv.strategy||'').split(' / ')[0];
    (inv.holdings||[]).filter(h=>!h.putCall).forEach(h => {
      if(!prevSet.has(h.ticker)) {
        if(!newByTicker[h.ticker]) newByTicker[h.ticker]={ticker:h.ticker,name:h.name,sector:h.sector||'Other',count:0,buyers:[],buyerStrategies:[],buyerIds:new Set(),totalValue:0};
        // Deduplicate by investor id — large funds file sub-managers separately
        if(!newByTicker[h.ticker].buyerIds.has(inv.id)) {
          newByTicker[h.ticker].buyerIds.add(inv.id);
          newByTicker[h.ticker].count++;
          newByTicker[h.ticker].buyers.push(inv.name);
          newByTicker[h.ticker].buyerStrategies.push(invStrategy);
        }
        newByTicker[h.ticker].totalValue += h.value||0;
      }
    });
  });
  const radarItems = Object.values(newByTicker).filter(r=>r.count>=2).sort((a,b)=>b.count-a.count||b.totalValue-a.totalValue);

  /* ── Sector rotation ── */
  const sectorMap={}, prevSectorMap={};
  let totalVal=0, prevTotalVal=0;
  INVESTORS.forEach(inv => {
    (inv.holdings||[]).forEach(h => {
      const s=h.sector||'Other'; totalVal+=h.value||0;
      if(!sectorMap[s]) sectorMap[s]={sector:s,value:0,investorCount:new Set(),positions:0};
      sectorMap[s].value+=h.value||0; sectorMap[s].positions++;
      sectorMap[s].investorCount.add(inv.id);
    });
    (inv.holdingsPrev||[]).forEach(h => {
      const s=h.sector||'Other'; prevTotalVal+=h.value||0;
      if(!prevSectorMap[s]) prevSectorMap[s]={value:0};
      prevSectorMap[s].value+=h.value||0;
    });
  });
  const sectors = Object.values(sectorMap).map(s => {
    const prev=prevSectorMap[s.sector];
    const pct=totalVal?s.value/totalVal*100:0;
    const prevPct=prevTotalVal&&prev?prev.value/prevTotalVal*100:0;
    return{...s,pct,prevPct,change:prev?pct-prevPct:null,investorCount:s.investorCount.size};
  }).sort((a,b)=>b.value-a.value);

  /* ── Heatmap: top 30 stocks × top 12 investors by AUM ── */
  const top30 = companies.slice(0,30);
  const top12inv = [...INVESTORS].sort((a,b)=>(b.aumRaw||0)-(a.aumRaw||0)).slice(0,12);

  /* ── Render ── */
  container.innerHTML = `
    <div style="padding:1.5rem 2rem;border-bottom:1px solid var(--border)">
      <div class="detail-name">Market View</div>
      <div class="detail-firm-line">Combined intelligence across ${totalInvestors} investors · ${fmtM(m.totalValue)} tracked 13F value</div>
    </div>
    <div style="padding:1.75rem 2rem;">

      <!-- KPI STRIP -->
      <div class="mv-kpi-strip">
        <div class="mv-kpi">
          <div class="mv-kpi-label">Unique positions</div>
          <div class="mv-kpi-value">${uniqueTickers}</div>
          <div class="mv-kpi-sub">across all investors</div>
        </div>
        <div class="mv-kpi">
          <div class="mv-kpi-label">Most crowded</div>
          <div class="mv-kpi-value" style="color:var(--blue)">${mostCrowded?mostCrowded[0]:'—'}</div>
          <div class="mv-kpi-sub">${mostCrowded?mostCrowded[1].size+' of '+totalInvestors+' investors':''}</div>
        </div>
        <div class="mv-kpi">
          <div class="mv-kpi-label">Top smart money flow</div>
          <div class="mv-kpi-value" style="color:var(--green)">${topFlow?topFlow.ticker:'—'}</div>
          <div class="mv-kpi-sub">${topFlow?'+'+fmtM(topFlow.flow)+' net inflow':''}</div>
        </div>
        <div class="mv-kpi">
          <div class="mv-kpi-label">New position alerts</div>
          <div class="mv-kpi-value" style="color:var(--amber)">${radarItems.length}</div>
          <div class="mv-kpi-sub">stocks with 2+ new buyers</div>
        </div>
        <div class="mv-kpi">
          <div class="mv-kpi-label">Top new entry</div>
          <div class="mv-kpi-value" style="color:var(--blue)">${topNewEntry?topNewEntry[0]:'—'}</div>
          <div class="mv-kpi-sub">${topNewEntry?topNewEntry[1]+' new investors':''}</div>
        </div>
        <div class="mv-kpi">
          <div class="mv-kpi-label">Sector in-flow</div>
          <div class="mv-kpi-value">${sectors.filter(s=>s.change!==null).sort((a,b)=>b.change-a.change)[0]?.sector||'—'}</div>
          <div class="mv-kpi-sub">${sectors.filter(s=>s.change!==null).sort((a,b)=>b.change-a.change)[0]?('+'+sectors.filter(s=>s.change!==null).sort((a,b)=>b.change-a.change)[0].change.toFixed(1)+'pp QoQ'):'No prior data'}</div>
        </div>
      </div>

      <!-- MARKET CHARTS -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:1.75rem">
        <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:16px">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600;margin-bottom:12px">Sector Allocation Across Quarters</div>
          <canvas id="mv-sector-chart" height="200"></canvas>
        </div>
        <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:16px">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600;margin-bottom:12px">Most Popular Stocks (investors holding)</div>
          <canvas id="mv-popular-chart" height="200"></canvas>
        </div>
      </div>

      <!-- SUB-SECTION TABS -->
      <div class="mv-tabs">
        <button class="mv-tab active" data-mv="flow" onclick="switchMvSection('flow')">💰 Smart Money Flow</button>
        <button class="mv-tab" data-mv="crowd" onclick="switchMvSection('crowd')">🎯 Crowding Score</button>
        <button class="mv-tab" data-mv="consensus" onclick="switchMvSection('consensus')">🤝 Consensus vs Contrarian</button>
        <button class="mv-tab" data-mv="rotation" onclick="switchMvSection('rotation')">🔄 Sector Rotation</button>
        <button class="mv-tab" data-mv="radar" onclick="switchMvSection('radar')">📡 New Positions Radar</button>
        <button class="mv-tab" data-mv="heatmap" onclick="switchMvSection('heatmap')">🗺 Conviction Heatmap</button>
      </div>

      <!-- ① SMART MONEY FLOW -->
      <div class="mv-section active" data-mv="flow">
        <div class="flow-grid">
          <div class="flow-card">
            <div class="flow-card-head">
              <div class="flow-card-title">Biggest net inflows</div>
              <div class="flow-card-sub">Stocks where combined smart money value increased the most QoQ</div>
            </div>
            ${[...companies].filter(c=>prevCompanyMap[c.ticker]&&c.flow>0).sort((a,b)=>b.flow-a.flow).slice(0,12).map((c,i)=>{
              const maxFlow = [...companies].filter(x=>x.flow>0).sort((a,b)=>b.flow-a.flow)[0]?.flow||1;
              return `<div class="flow-row">
                <span class="flow-rank">${i+1}</span>
                <span class="flow-ticker">${c.ticker}</span>
                <div style="flex:1;min-width:0">
                  <div class="flow-name">${c.name}</div>
                  <div class="flow-investors">${c.investorNames.slice(0,3).map(n=>`<span class="flow-chip">${n.split(' ').pop()}</span>`).join('')}${c.investorCount>3?`<span class="flow-chip">+${c.investorCount-3}</span>`:''}</div>
                </div>
                <div class="flow-bar-wrap">
                  <div class="flow-bar-bg"><div class="flow-bar-fill" style="width:${Math.min(100,c.flow/maxFlow*100)}%;background:var(--green)"></div></div>
                </div>
                <span class="flow-val" style="color:var(--green)">+${fmtM(c.flow)}</span>
              </div>`;
            }).join('')}
          </div>
          <div class="flow-card">
            <div class="flow-card-head">
              <div class="flow-card-title">Biggest net outflows</div>
              <div class="flow-card-sub">Stocks where combined smart money value decreased the most QoQ</div>
            </div>
            ${[...companies].filter(c=>prevCompanyMap[c.ticker]&&c.flow<0).sort((a,b)=>a.flow-b.flow).slice(0,12).map((c,i)=>{
              const maxOut = Math.abs([...companies].filter(x=>x.flow<0).sort((a,b)=>a.flow-b.flow)[0]?.flow||1);
              return `<div class="flow-row">
                <span class="flow-rank">${i+1}</span>
                <span class="flow-ticker">${c.ticker}</span>
                <div style="flex:1;min-width:0">
                  <div class="flow-name">${c.name}</div>
                  <div class="flow-investors">${c.investorNames.slice(0,3).map(n=>`<span class="flow-chip">${n.split(' ').pop()}</span>`).join('')}${c.investorCount>3?`<span class="flow-chip">+${c.investorCount-3}</span>`:''}</div>
                </div>
                <div class="flow-bar-wrap">
                  <div class="flow-bar-bg"><div class="flow-bar-fill" style="width:${Math.min(100,Math.abs(c.flow)/maxOut*100)}%;background:var(--red)"></div></div>
                </div>
                <span class="flow-val" style="color:var(--red)">${fmtM(c.flow)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- ② CROWDING SCORE -->
      <div class="mv-section" data-mv="crowd">
        <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:1.25rem;line-height:1.6">
          Crowding score (0–100) combines ownership breadth (how many of the ${totalInvestors} investors hold it)
          and conviction weight (average portfolio allocation among holders).
          High scores signal positions that could face amplified selling pressure if sentiment shifts.
        </p>
        <div class="crowd-grid">
          ${crowdScores.slice(0,24).map(c=>{
            const level = c.crowdScore>=70?'high':c.crowdScore>=45?'med':'low';
            const color = level==='high'?'var(--red)':level==='med'?'var(--amber)':'var(--green)';
            return `<div class="crowd-card crowd-${level}">
              <div style="display:flex;align-items:flex-start;justify-content:space-between">
                <div>
                  <div class="crowd-ticker">${c.ticker}</div>
                  <div class="crowd-name">${c.name}</div>
                </div>
                <span class="crowd-label ${level}">${level==='high'?'High crowd':level==='med'?'Moderate':'Low crowd'}</span>
              </div>
              <div class="crowd-score-wrap">
                <div class="crowd-score-bar"><div class="crowd-score-fill" style="width:${c.crowdScore}%;background:${color}"></div></div>
                <div class="crowd-score-num" style="color:${color}">${c.crowdScore}</div>
              </div>
              <div class="crowd-meta">
                <div class="crowd-meta-item">Holders <strong>${c.investorCount}/${totalInvestors}</strong></div>
                <div class="crowd-meta-item">Avg weight <strong>${c.avgPct.toFixed(1)}%</strong></div>
                <div class="crowd-meta-item">Total value <strong>${fmtM(c.value)}</strong></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ③ CONSENSUS vs CONTRARIAN -->
      <div class="mv-section" data-mv="consensus">
        <div class="con-grid">
          <div class="con-card">
            <div class="con-head">
              <div class="con-title">Consensus positions</div>
              <div class="con-sub">Held by the most investors simultaneously — strong conviction signal</div>
            </div>
            ${companies.filter(c=>c.investorCount>=3).sort((a,b)=>b.investorCount-a.investorCount||b.value-a.value).slice(0,15).map((c,i)=>`
              <div class="con-row">
                <span class="con-num">${i+1}</span>
                <span class="con-ticker">${c.ticker}</span>
                <div class="con-info">
                  <div class="con-name">${c.name}</div>
                  <div class="con-holders">${c.investorCount} investors · ${c.sector}</div>
                  <div class="con-chips">${c.investorNames.slice(0,4).map(n=>`<span class="flow-chip">${n.split(' ')[0]}</span>`).join('')}${c.investorCount>4?`<span class="flow-chip">+${c.investorCount-4}</span>`:''}</div>
                </div>
                <div style="text-align:right">
                  <div class="con-weight" style="color:var(--blue)">${c.avgPct.toFixed(1)}%</div>
                  <div class="con-val">${fmtM(c.value)}</div>
                </div>
              </div>`).join('')}
          </div>
          <div class="con-card">
            <div class="con-head">
              <div class="con-title">Contrarian / unique bets</div>
              <div class="con-sub">High-conviction positions held by only 1–2 investors — where the edge is</div>
            </div>
            ${companies.filter(c=>c.investorCount<=2&&c.avgPct>=2).sort((a,b)=>b.avgPct-a.avgPct).slice(0,15).map((c,i)=>`
              <div class="con-row">
                <span class="con-num">${i+1}</span>
                <span class="con-ticker">${c.ticker}</span>
                <div class="con-info">
                  <div class="con-name">${c.name}</div>
                  <div class="con-holders">${c.investorCount} investor · ${c.sector}</div>
                  <div class="con-chips">${c.investorNames.map(n=>`<span class="flow-chip">${n.split(' ')[0]}</span>`).join('')}</div>
                </div>
                <div style="text-align:right">
                  <div class="con-weight" style="color:var(--amber)">${c.avgPct.toFixed(1)}%</div>
                  <div class="con-val">${fmtM(c.value)}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ④ SECTOR ROTATION -->
      <div class="mv-section" data-mv="rotation">
        <div class="rotation-grid">
          <div class="rotation-card">
            <div class="rotation-title">Sectors gaining allocation QoQ</div>
            ${sectors.filter(s=>s.change!==null&&s.change>0).sort((a,b)=>b.change-a.change).map(s=>{
              const maxChg = sectors.filter(x=>x.change>0).sort((a,b)=>b.change-a.change)[0]?.change||1;
              return `<div class="rotation-row">
                <div style="flex:1">
                  <div class="rotation-sector">${s.sector}</div>
                  <div class="rotation-sub">${s.investorCount} investors · ${s.positions} positions</div>
                </div>
                <span class="rotation-arrow">↑</span>
                <div class="rotation-bar-wrap">
                  <div class="rotation-bar-bg"><div class="rotation-bar-fill" style="width:${Math.min(100,s.change/maxChg*100)}%;background:var(--green)"></div></div>
                </div>
                <span class="rotation-pct">${s.pct.toFixed(1)}%</span>
                <span class="rotation-delta chg-up">+${s.change.toFixed(1)}pp</span>
              </div>`;
            }).join('')}
          </div>
          <div class="rotation-card">
            <div class="rotation-title">Sectors losing allocation QoQ</div>
            ${sectors.filter(s=>s.change!==null&&s.change<0).sort((a,b)=>a.change-b.change).map(s=>{
              const maxChg = Math.abs(sectors.filter(x=>x.change<0).sort((a,b)=>a.change-b.change)[0]?.change||1);
              return `<div class="rotation-row">
                <div style="flex:1">
                  <div class="rotation-sector">${s.sector}</div>
                  <div class="rotation-sub">${s.investorCount} investors · ${s.positions} positions</div>
                </div>
                <span class="rotation-arrow">↓</span>
                <div class="rotation-bar-wrap">
                  <div class="rotation-bar-bg"><div class="rotation-bar-fill" style="width:${Math.min(100,Math.abs(s.change)/maxChg*100)}%;background:var(--red)"></div></div>
                </div>
                <span class="rotation-pct">${s.pct.toFixed(1)}%</span>
                <span class="rotation-delta chg-dn">${s.change.toFixed(1)}pp</span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="rotation-card" style="margin-top:12px">
          <div class="rotation-title">Full sector allocation</div>
          ${sectors.map(s=>{
            const maxVal = sectors[0]?.value||1;
            const chgBadge = s.change===null?'<span class="rotation-delta chg-flat" style="font-size:0.65rem">NO PREV</span>'
              :s.change>0.05?`<span class="rotation-delta chg-up">+${s.change.toFixed(1)}pp</span>`
              :s.change<-0.05?`<span class="rotation-delta chg-dn">${s.change.toFixed(1)}pp</span>`
              :`<span class="rotation-delta chg-flat">${s.change.toFixed(1)}pp</span>`;
            return `<div class="rotation-row">
              <div style="flex:1">
                <div class="rotation-sector">${s.sector}</div>
                <div class="rotation-sub">${s.investorCount} investors · ${s.positions} pos · ${fmtM(s.value)}</div>
              </div>
              <div class="rotation-bar-wrap" style="width:200px">
                <div class="rotation-bar-bg"><div class="rotation-bar-fill" style="width:${Math.min(100,s.value/maxVal*100)}%;background:var(--blue)"></div></div>
              </div>
              <span class="rotation-pct">${s.pct.toFixed(1)}%</span>
              ${chgBadge}
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ⑤ NEW POSITIONS RADAR -->
      <div class="mv-section" data-mv="radar">
        <p class="radar-intro">
          Stocks that appeared as <strong>new positions</strong> in multiple 13F filings this quarter simultaneously.
          When 2+ independent investors initiate the same position in the same quarter, it's often a strong forward-looking signal.
        </p>
        ${(()=>{
          if (radarItems.length === 0) return '<div class="empty"><p>No stocks with 2+ simultaneous new entries found.</p></div>';
          window._radarItems = radarItems;
          const radarSectors = {}, radarStrategies = {};
          radarItems.forEach(r => {
            radarSectors[r.sector] = (radarSectors[r.sector]||0) + 1;
            (r.buyerStrategies||[]).forEach(s => { radarStrategies[s] = (radarStrategies[s]||0) + 1; });
          });
          const sectorList   = Object.entries(radarSectors).sort((a,b)=>b[1]-a[1]);
          const strategyList = Object.entries(radarStrategies).sort((a,b)=>b[1]-a[1]);
          const cards = radarItems.map(r=>{
            const strength = r.count>=4?'strong':'notable';
            const label    = r.count>=4?'STRONG SIGNAL':'NOTABLE';
            const strategies = Array.from(new Set(r.buyerStrategies||[])).join(', ');
            var cardMktCap = 0;
            var invHolding = INVESTORS.flatMap(function(i){return i.holdings||[];}).find(function(h){return h.ticker===r.ticker;});
            if (invHolding && invHolding.marketCap) cardMktCap = invHolding.marketCap;
            return '<div class="radar-card"' +
              ' data-sector="' + r.sector + '"' +
              ' data-count="' + r.count + '"' +
              ' data-value="' + r.totalValue + '"' +
              ' data-strategies="' + (r.buyerStrategies||[]).join(',') + '"' +
              ' data-ticker="' + r.ticker + '"' +
              ' data-name="' + r.name.toLowerCase() + '"' +
              ' data-mktcap="' + cardMktCap + '">' +
              '<span class="radar-signal signal-' + strength + '">' + label + '</span>' +
              '<div class="radar-ticker">' + r.ticker + '</div>' +
              '<div class="radar-name">' + r.name + ' · ' + r.sector + '</div>' +
              '<div style="font-size:0.68rem;color:var(--text-3);margin-top:2px">' + strategies + '</div>' +
              '<div class="radar-count">' + r.count + '<span style="font-size:0.85rem;font-family:DM Sans,sans-serif;color:var(--text-2)"> new buyers</span></div>' +
              '<div class="radar-buyers">' + r.buyers.map(n=>'<span class="radar-chip">'+n.split(' ')[0]+'</span>').join('') + '</div>' +
              '<div class="radar-total">Combined new value: ' + fmtM(r.totalValue) + '</div>' +
              '</div>';
          }).join('');
          return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:1.25rem;align-items:flex-end">' +
            '<div style="flex:1;min-width:180px"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:4px">Search</div>' +
            '<input id="radar-search" type="text" placeholder="Ticker or company…" oninput="applyRadarFilters()" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;background:var(--white);color:var(--text-1);outline:none"></div>' +
            '<div><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:4px">Min investors</div>' +
            '<div style="display:flex;gap:4px">' +
            [2,3,4,5].map(n=>'<button class="radar-filter-pill '+(n===2?'active ':'')+ '" data-min-count="'+n+'" onclick="setRadarMinCount(this)">'+n+'+</button>').join('') +
            '</div></div>' +
            '<div><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:4px">Min value</div>' +
            '<div style="display:flex;gap:4px">' +
            [['Any',0],['$50M',50],['$200M',200],['$500M',500]].map(([lbl,val])=>'<button class="radar-filter-pill '+(val===0?'active ':'')+ '" data-min-value="'+val+'" onclick="setRadarMinValue(this)">'+lbl+'</button>').join('') +
            '</div></div>' +
            '<div><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:4px">Market Cap</div>' +
            '<div style="display:flex;gap:4px">' +
            [['All','all'],['Mega >$200B','mega'],['Large $10-200B','large'],['Mid $2-10B','mid'],['Small <$2B','small']].map(([lbl,val])=>'<button class="radar-filter-pill '+(val==='all'?'active ':'')+ '" data-mktcap="'+val+'" onclick="setRadarMktCap(this)">'+lbl+'</button>').join('') +
            '</div></div></div>' +
            '<div class="radar-filters" style="margin-bottom:8px"><span class="radar-filter-label">Sector:</span>' +
            '<button class="radar-filter-pill active" data-sector="All" onclick="filterRadar(this)">All <span class="radar-count-badge">' + radarItems.length + '</span></button>' +
            sectorList.map(([s,n])=>'<button class="radar-filter-pill" data-sector="'+s+'" onclick="filterRadar(this)">'+s+' <span class="radar-count-badge">'+n+'</span></button>').join('') +
            '</div>' +
            '<div class="radar-filters" style="margin-bottom:1.25rem"><span class="radar-filter-label">Style:</span>' +
            '<button class="radar-filter-pill active" data-strategy="All" onclick="filterRadarStrategy(this)">All</button>' +
            strategyList.map(([s,n])=>'<button class="radar-filter-pill" data-strategy="'+s+'" onclick="filterRadarStrategy(this)">'+s+' <span class="radar-count-badge">'+n+'</span></button>').join('') +
            '</div>' +
            '<div id="radar-result-count" style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px"></div>' +
            '<div class="radar-grid" id="radar-grid">' + cards + '</div>';
        })()}
      </div>

      <!-- ⑥ CONVICTION HEATMAP -->
      <div class="mv-section" data-mv="heatmap">
        <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:1.25rem;line-height:1.6">
          Portfolio weight of each stock (columns) for each investor (rows).
          Darker blue = higher conviction. Grey = not held.
        </p>
        <div class="heatmap-wrap">
          <table class="heatmap-table">
            <thead><tr>
              <th class="row-header">Investor</th>
              ${top30.map(c=>`<th title="${c.name}">${c.ticker}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${top12inv.map(inv=>{
                const holdMap = {};
                (inv.holdings||[]).forEach(h=>holdMap[h.ticker]=h.pct);
                const maxPct = Math.max(...Object.values(holdMap), 1);
                return `<tr>
                  <td class="row-label" title="${inv.firm}">${inv.name.split(' ').pop()}</td>
                  ${top30.map(c=>{
                    const pct = holdMap[c.ticker];
                    if(!pct) return `<td><div class="hm-cell hm-empty">—</div></td>`;
                    const intensity = Math.round((pct/maxPct)*100);
                    const alpha = 0.12 + (intensity/100)*0.78;
                    const textColor = alpha > 0.5 ? '#fff' : '#1549a8';
                    return `<td title="${inv.name}: ${c.ticker} ${pct.toFixed(1)}%">
                      <div class="hm-cell" style="background:rgba(21,73,168,${alpha.toFixed(2)});color:${textColor}">
                        ${pct.toFixed(0)}
                      </div>
                    </td>`;
                  }).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;

  // Restore active tab state
  switchMvSection(_mvSection);
  // Draw charts after innerHTML is set so canvas elements exist in DOM
  setTimeout(renderMvCharts, 0);
}


function renderMvCharts() {
  if (typeof Chart === 'undefined') return;

  if (!window._mvCharts) window._mvCharts = {};
  Object.keys(window._mvCharts).forEach(function(k) {
    try { window._mvCharts[k].destroy(); } catch(e) {}
    delete window._mvCharts[k];
  });

  var SECTOR_COLORS = {
    'Technology':'#1549a8','Health Care':'#166534','Financials':'#92400e',
    'Consumer Discr.':'#7c3aed','Communication':'#0891b2','Industrials':'#b45309',
    'Energy':'#dc2626','Consumer Staples':'#16a34a','Materials':'#6b7280',
    'Real Estate':'#db2777','ETF':'#64748b','Other':'#d1d5db'
  };
  var sectorNames = Object.keys(SECTOR_COLORS);
  var allInvestors = INVESTORS || [];
  if (!allInvestors.length) return;

  // ── Collect all quarters with dates, sort chronologically ───────────────
  var qDateMap = {};
  allInvestors.forEach(function(inv) {
    if (inv.latestQ && inv.filingDate) qDateMap[inv.latestQ] = inv.filingDate;
    (inv.holdingsHistory || []).forEach(function(q) {
      if (q.quarter && q.date) qDateMap[q.quarter] = q.date;
    });
  });
  var allSortedQs = Object.keys(qDateMap).sort(function(a, b) {
    return qDateMap[a].localeCompare(qDateMap[b]);
  });

  // Chart shows only the 4 most recent quarters — data fetching is unaffected
  var sortedQs = allSortedQs.slice(-4);
  if (!sortedQs.length) return;

  // ── Sector % of total AUM per quarter ──────────────────────────────────
  var sectorSeries = {};
  sectorNames.forEach(function(s) { sectorSeries[s] = []; });

  sortedQs.forEach(function(qLabel) {
    var totals = {};
    sectorNames.forEach(function(s) { totals[s] = 0; });
    var grandTotal = 0;

    allInvestors.forEach(function(inv) {
      var holdings = null;
      if (inv.latestQ === qLabel) {
        holdings = inv.holdings || [];
      } else {
        (inv.holdingsHistory || []).forEach(function(q) {
          if (q.quarter === qLabel) holdings = q.holdings || [];
        });
      }
      if (!holdings) return;
      holdings.forEach(function(h) {
        var s = h.sector || 'Other';
        var v = h.value || 0;
        grandTotal += v;
        if (totals.hasOwnProperty(s)) totals[s] += v;
        else totals['Other'] += v;
      });
    });

    sectorNames.forEach(function(s) {
      sectorSeries[s].push(grandTotal > 0 ? Math.round(totals[s] / grandTotal * 1000) / 10 : 0);
    });
  });

  var activeSectors = sectorNames.filter(function(s) {
    return sectorSeries[s].some(function(v) { return v > 0; });
  });

  var sectorEl = document.getElementById('mv-sector-chart');
  if (sectorEl) {
    window._mvCharts['sector'] = new Chart(sectorEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: sortedQs,
        datasets: activeSectors.map(function(s) {
          return {
            label: s,
            data: sectorSeries[s],
            borderColor: SECTOR_COLORS[s],
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3
          };
        })
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 7 } },
          tooltip: { callbacks: { label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + ctx.parsed.y + '%'; } } }
        },
        scales: {
          y: { ticks: { callback: function(v) { return v + '%'; }, font: { size: 10 } }, grid: { color: '#f0ede8' } },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }

  // ── Top 15 most-held stocks ─────────────────────────────────────────────
  var tickerCount = {};
  var tickerName  = {};
  allInvestors.forEach(function(inv) {
    (inv.holdings || []).forEach(function(h) {
      if (h.ticker && h.ticker.charAt(0) !== '~') {
        tickerCount[h.ticker] = (tickerCount[h.ticker] || 0) + 1;
        if (!tickerName[h.ticker]) tickerName[h.ticker] = h.name || h.ticker;
      }
    });
  });
  var top15 = Object.keys(tickerCount)
    .map(function(t) { return [t, tickerCount[t]]; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 15);

  var PALETTE = ['#1549a8','#166534','#991b1b','#92400e','#7c3aed',
                 '#0891b2','#b45309','#dc2626','#16a34a','#6b7280',
                 '#db2777','#64748b','#0d9488','#9333ea','#ea580c'];
  var totalInv = allInvestors.length;

  var popularEl = document.getElementById('mv-popular-chart');
  if (popularEl) {
    window._mvCharts['popular'] = new Chart(popularEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top15.map(function(x) { return x[0]; }),
        datasets: [{
          label: 'Investors holding',
          data: top15.map(function(x) { return x[1]; }),
          backgroundColor: top15.map(function(_, i) { return PALETTE[i % PALETTE.length]; }),
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function(ctx) { return ctx[0].label + ' — ' + (tickerName[ctx[0].label] || ''); },
              label: function(ctx) { return ' Held by ' + ctx.parsed.y + ' of ' + totalInv + ' investors'; }
            }
          }
        },
        scales: {
          y: {
            ticks: { stepSize: 1, font: { size: 10 } },
            grid: { color: '#f0ede8' },
            title: { display: true, text: '# investors', font: { size: 10 }, color: '#9e9b93' }
          },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }
}


window._radarFilters = { sector: 'All', strategy: 'All', minCount: 2, minValue: 0, search: '', mktCap: 'all' };

function applyRadarFilters() {
  var f = window._radarFilters;
  f.search = (document.getElementById('radar-search')||{value:''}).value.toLowerCase().trim();
  var visible = 0;
  document.querySelectorAll('#radar-grid .radar-card').forEach(function(card) {
    var sectorOk  = f.sector   === 'All' || card.dataset.sector === f.sector;
    var stratOk   = f.strategy === 'All' || (card.dataset.strategies||'').split(',').indexOf(f.strategy) !== -1;
    var countOk   = parseInt(card.dataset.count||0) >= f.minCount;
    var valueOk   = parseFloat(card.dataset.value||0) >= f.minValue;
    var searchOk  = !f.search  || (card.dataset.ticker||'').toLowerCase().indexOf(f.search) !== -1
                                || (card.dataset.name||'').indexOf(f.search) !== -1;
    var mktCapOk  = true;
    if (f.mktCap && f.mktCap !== 'all') {
      var mc = parseFloat(card.dataset.mktcap||0);
      if (f.mktCap === 'mega')  mktCapOk = mc >= 200e9;
      if (f.mktCap === 'large') mktCapOk = mc >= 10e9  && mc < 200e9;
      if (f.mktCap === 'mid')   mktCapOk = mc >= 2e9   && mc < 10e9;
      if (f.mktCap === 'small') mktCapOk = mc > 0      && mc < 2e9;
    }
    var show = sectorOk && stratOk && countOk && valueOk && searchOk && mktCapOk;
    card.classList.toggle('radar-hidden', !show);
    if (show) visible++;
  });
  var rc = document.getElementById('radar-result-count');
  if (rc) rc.textContent = visible + ' signal' + (visible !== 1 ? 's' : '') + ' matching filters';
}

function setRadarMktCap(btn) {
  document.querySelectorAll('.radar-filter-pill[data-mktcap]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  window._radarFilters.mktCap = btn.dataset.mktcap;
  applyRadarFilters();
}

function filterRadar(btn) {
  document.querySelectorAll('.radar-filter-pill[data-sector]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  window._radarFilters.sector = btn.dataset.sector;
  applyRadarFilters();
}

function filterRadarStrategy(btn) {
  document.querySelectorAll('.radar-filter-pill[data-strategy]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  window._radarFilters.strategy = btn.dataset.strategy;
  applyRadarFilters();
}

function setRadarMinCount(btn) {
  document.querySelectorAll('.radar-filter-pill[data-min-count]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  window._radarFilters.minCount = parseInt(btn.dataset.minCount);
  applyRadarFilters();
}

function setRadarMinValue(btn) {
  document.querySelectorAll('.radar-filter-pill[data-min-value]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  window._radarFilters.minValue = parseFloat(btn.dataset.minValue);
  applyRadarFilters();
}
