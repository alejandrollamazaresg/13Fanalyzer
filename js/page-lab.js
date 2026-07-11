// page-lab.js — Portfolio Lab: consensus baskets, backtester, optimizer.
let _labSelected = new Set();   // investor ids
let _labTopN = 10;              // top N holdings per investor per quarter
let _btBaskets = [];            // [{quarter, tickers[]}] for the consensus backtest
let _btRunning = false;
let _labResults = null;

async function initLabView() {
  const container = document.getElementById('lab-content');
  if (!INVESTORS.length) { container.innerHTML = '<div class="empty"><p>No investor data loaded yet.</p></div>'; return; }
  if (_labSelected.size === 0) {
    // Default: first 5 investors
    INVESTORS.slice(0, 5).forEach(inv => _labSelected.add(inv.id));
  }
  renderLabShell(container);
}

function renderLabShell(container) {
  const invList = INVESTORS.map(inv => `
    <div class="lab-inv-item ${_labSelected.has(inv.id)?'selected':''}" data-id="${inv.id}" onclick="toggleLabInv('${inv.id}')">
      <div class="lab-inv-dot" style="background:${inv.color||'#ccc'}"></div>
      <span class="lab-inv-name">${inv.name}</span>
      <span class="lab-inv-check">✓</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="lab-layout">
      <div class="lab-sidebar">
        <div class="lab-sidebar-title">Configure</div>
        <div class="lab-section-lbl">Select Investors <span style="color:var(--text-3);font-weight:400">(${_labSelected.size} selected)</span></div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button onclick="labSelectAll()" style="font-size:0.72rem;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--white);cursor:pointer;color:var(--text-2)">All</button>
          <button onclick="labSelectNone()" style="font-size:0.72rem;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--white);cursor:pointer;color:var(--text-2)">None</button>
        </div>
        <div class="lab-inv-list" id="lab-inv-list">${invList}</div>

        <div class="lab-section-lbl">Top N Holdings per investor</div>
        <div class="lab-topn-wrap">
          <span class="lab-topn-lbl">Use top</span>
          <input class="lab-topn-input" id="lab-topn" type="number" min="1" max="50" value="${_labTopN}" oninput="_labTopN=Math.max(1,parseInt(this.value)||10)">
          <span class="lab-topn-lbl">positions</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;line-height:1.5">
          Only the largest N holdings per investor per quarter are included when calculating common holdings and returns.
        </div>

        <button class="lab-run-btn" onclick="runLab()">Run Analysis →</button>
      </div>

      <div class="lab-main" id="lab-main">
        <div class="empty" style="padding:4rem 2rem;border:1px solid var(--border);border-radius:var(--rl);background:var(--white)">
          <p>Select investors and click <strong>Run Analysis</strong></p>
        </div>
      </div>
    </div>
  `;
}

function toggleLabInv(id) {
  if (_labSelected.has(id)) _labSelected.delete(id);
  else _labSelected.add(id);
  const item = document.querySelector(`.lab-inv-item[data-id="${id}"]`);
  if (item) item.classList.toggle('selected', _labSelected.has(id));
  // Update count
  const sidebar = document.querySelector('.lab-sidebar-title');
  const countEl = document.querySelector('.lab-section-lbl');
  document.querySelector('.lab-section-lbl').innerHTML =
    `Select Investors <span style="color:var(--text-3);font-weight:400">(${_labSelected.size} selected)</span>`;
}

function labSelectAll()  { INVESTORS.forEach(i => _labSelected.add(i.id));  rerenderLabList(); }
function labSelectNone() { _labSelected.clear(); rerenderLabList(); }
function rerenderLabList() {
  document.querySelectorAll('.lab-inv-item').forEach(el => {
    el.classList.toggle('selected', _labSelected.has(el.dataset.id));
  });
  document.querySelector('.lab-section-lbl').innerHTML =
    `Select Investors <span style="color:var(--text-3);font-weight:400">(${_labSelected.size} selected)</span>`;
}

async function runLab() {
  if (_labSelected.size === 0) { alert('Select at least one investor.'); return; }
  const mainEl = document.getElementById('lab-main');
  mainEl.innerHTML = '<div class="lab-spinner" style="display:block">Loading full history and computing…</div>';

  const history = await loadFullHistory();
  if (!history) { mainEl.innerHTML = '<div class="empty"><p>Could not load history.</p></div>'; return; }

  const topN = Math.max(1, parseInt(document.getElementById('lab-topn')?.value || _labTopN) || _labTopN);
  _labTopN = topN;

  const selectedInvs = INVESTORS.filter(inv => _labSelected.has(inv.id));
  const selectedIds  = selectedInvs.map(i => i.id);

  // A stock is "consensus" if at least this many of the selected investors hold
  // it. We no longer require EVERY investor to hold it (strict intersection was
  // far too restrictive — three managers rarely share a name in all top-N lists).
  const minHolders = selectedIds.length <= 1 ? 1 : 2;

  // ── Issuer identity ─────────────────────────────────────────────────────────
  // Key holdings by a normalised COMPANY NAME, not by ticker. This collapses
  // dual-class shares — GOOG and GOOGL are both "Alphabet Inc" — into a single
  // issuer, and it is robust to mis-resolved tickers in the underlying data.
  function issuerKey(name) {
    let s = (name || '').toUpperCase();
    // Drop everything from a share-class / security-type marker onward.
    s = s.replace(/\b(CL(ASS)?|SER(IES)?|COM|COMMON|ADR|ADS|SPON(SORED)?|WT|WTS|RT|RTS|UNIT|UNITS|PFD|PREFERRED)\b.*$/, ' ');
    s = s.replace(/[.,&/()]/g, ' ');
    // Strip trailing corporate suffixes / filler words.
    s = s.replace(/\b(INC|CORP|CORPORATION|CO|COS|COMPANIES|COMPANY|LTD|LIMITED|LLC|LP|PLC|NV|SA|AG|HLDG|HLDGS|HOLDING|HOLDINGS|GROUP|GRP|TR|TRUST|THE|NEW|REIT|INTL|INTERNATIONAL)\b/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s || (name || '').toUpperCase().trim();
  }

  // Top-N stock positions for an investor in a quarter (options dropped).
  function getTopN(invId, quarter) {
    const qData = (history[invId] || []).find(q => q.quarter === quarter);
    if (!qData) return [];
    return (qData.holdings || [])
      .filter(h => h.name && !h.put_call && (h.value || 0) > 0)
      .slice(0, topN);
  }

  // ── Unified quarter list (oldest → newest) ───────────────────────────────────
  const qDateMap = {};
  // Use the latest filing date among selected investors for each reported
  // quarter. That is the first date when the full selected-investor consensus
  // basket is actually observable, so the backtest can avoid quarter-end
  // look-ahead bias.
  selectedIds.forEach(id => (history[id] || []).forEach(q => {
    if (q.date && (!qDateMap[q.quarter] || q.date > qDateMap[q.quarter])) qDateMap[q.quarter] = q.date;
  }));
  const allQuarters = Object.entries(qDateMap)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([q, d]) => ({ quarter: q, date: d }));
  if (allQuarters.length === 0) { mainEl.innerHTML = '<div class="empty"><p>No quarters found for the selection.</p></div>'; return; }
  const latestQ = allQuarters[allQuarters.length - 1].quarter;

  // ── Consensus holdings for one quarter ───────────────────────────────────────
  function consensusForQuarter(quarter, ids = selectedIds) {
    const byIssuer = new Map();
      ids.forEach(id => {   // key → { name, tickerCount:Map, holders:Map }
        const inv = INVESTORS.find(i => i.id === id);
        getTopN(id, quarter).forEach(h => {
          const key = issuerKey(h.name);
          if (!byIssuer.has(key)) byIssuer.set(key, { name: h.name, tickerCount: new Map(), holders: new Map() });
          const e = byIssuer.get(key);
          if (h.ticker && !h.ticker.startsWith('~')) e.tickerCount.set(h.ticker, (e.tickerCount.get(h.ticker) || 0) + 1);
          // One entry per investor; if an investor holds two share classes, merge them.
          const prev = e.holders.get(id);
          if (prev) { prev.value += (h.value || 0); prev.pct += (h.pct || 0); }
          else e.holders.set(id, { invName: inv?.name || id, invColor: inv?.color || '#ccc', value: (h.value || 0), pct: (h.pct || 0) });
        });
      });
    const out = [];
    byIssuer.forEach((e, key) => {
      const holders = [...e.holders.values()];
      if (holders.length < minHolders) return;
      const ticker  = [...e.tickerCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
      const totalVal = holders.reduce((s, h) => s + h.value, 0);
      const avgPct   = holders.reduce((s, h) => s + h.pct, 0) / holders.length;
      out.push({ key, ticker, name: e.name, holders, count: holders.length, totalVal, avgPct });
    });
    out.sort((a, b) => (b.count - a.count) || (b.totalVal - a.totalVal));
    return out;
  }
  // ── EARLY-LOCK: freeze a quarter's top-15 once the not-yet-filed investors
  //    can no longer change the set. ─────────────────────────────────────────
  const SETTLE_BUFFER_DAYS = 90;   // 45-day 13F deadline + slack for amendments
  const BASKET_SIZE = 15;

  function quarterEndISO(label) {                 // 'Q1 2025' -> '2025-03-31'
    const m = { Q1:'03-31', Q2:'06-30', Q3:'09-30', Q4:'12-31' };
    const [q, y] = String(label).split(' ');
    return m[q] ? `${y}-${m[q]}` : null;
  }

  // Investors from `pool` that filed `quarter` (optionally only on/before asOf).
  function filersForQuarter(quarter, pool = selectedIds, asOf = null) {
    return pool.filter(id => {
      const qd = (history[id] || []).find(q => q.quarter === quarter);
      return qd && (!asOf || (qd.date && qd.date <= asOf));
    });
  }

  // Holder COUNT per issuer over EVERY name (incl. sub-threshold count-1 names).
  function issuerCountsForQuarter(quarter, ids = selectedIds) {
    const seen = new Map();
    ids.forEach(id => getTopN(id, quarter).forEach(h => {
      const k = issuerKey(h.name);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(id);
    }));
    const out = new Map();
    seen.forEach((s, k) => out.set(k, s.size));
    return out;
  }

  // Is the top-15 set frozen, given exactly `filerIds` have filed so far?
  function lockState(quarter, filerIds) {
    const cons   = consensusForQuarter(quarter, filerIds);   // count desc, value desc
    const inKeys = new Set(cons.slice(0, BASKET_SIZE).map(c => c.key));

    // Count a name must reach to alter the set: rank-15 count if the basket is
    // full, else just the min-holders threshold (room to add).
    const cut = (cons.length >= BASKET_SIZE) ? cons[BASKET_SIZE - 1].count : minHolders;

    // Strongest contender outside the top-15 (rank-16 / a count-1 name / new name).
    let cOutMax = 0;
    issuerCountsForQuarter(quarter, filerIds).forEach((c, k) => {
      if (!inKeys.has(k) && c > cOutMax) cOutMax = c;
    });

    const R      = selectedIds.length - filerIds.length;   // adversarial: all not-yet-filed could file
    const margin = cut - cOutMax;                           // your gap (25 - 15 = 10)
    const locked = R === 0 || R < margin;                  // strict: a count tie is broken by value
    return { locked, R, margin, cut, cOutMax, consensus: cons.length };
  }

  function quarterLockStatus(quarter) {
    const qEnd    = quarterEndISO(quarter);
    const settled = qEnd &&
      Date.now() > new Date(qEnd + 'T00:00:00').getTime() + SETTLE_BUFFER_DAYS * 864e5;

    const allFilers = filersForQuarter(quarter);
    const lastDate  = allFilers
      .map(id => (history[id] || []).find(q => q.quarter === quarter)?.date)
      .filter(Boolean).sort().pop() || null;

    // Settled (past the deadline buffer): nothing more is coming. Locked, and
    // entry stays the last filing date so historical backtests are unchanged.
    if (settled) {
      const st = lockState(quarter, allFilers);
      return {  ...st, locked: true, settled: true, entryDate: lastDate, filed: allFilers.length, R: 0 };
    }

    // Live quarter: walk filings oldest->newest, lock at the FIRST date where the
    // remaining investors can't change the top-15. That date is the entry (the
    // earliest the frozen basket was observable — no drift as stragglers arrive).
    const dates = [...new Set(allFilers
      .map(id => (history[id] || []).find(q => q.quarter === quarter)?.date)
      .filter(Boolean))].sort();

    for (const d of dates) {
      const filers = filersForQuarter(quarter, selectedIds, d);
      const st = lockState(quarter, filers);
      if (st.locked) {
        return { ...st, locked: true, settled: false, entryDate: d, filed: filers.length};
      }
    }

    // Not yet lockable -> provisional.
    const st = lockState(quarter, allFilers);
    return { ...st, locked: false, settled: false, entryDate: lastDate, filed: allFilers.length};
  }
  const consensus = consensusForQuarter(latestQ);

  // How many of the selected investors actually filed for the latest quarter
  // (so "held by N of M" is honest about coverage).
  const filedLatest = selectedIds.filter(id => (history[id] || []).some(q => q.quarter === latestQ)).length;

  // ── Consensus count over time — a real, computable trend (no fake prices) ────
  const trend = allQuarters.map(q => ({ quarter: q.quarter, n: consensusForQuarter(q.quarter).length }));
  function filedCountForQuarter(quarter) {
    return selectedIds.filter(id =>
      (history[id] || []).some(q => q.quarter === quarter)
    ).length;
  }

  function latestFilingDateForQuarter(quarter) {
    let latest = null;
    selectedIds.forEach(id => {
      const qData = (history[id] || []).find(q => q.quarter === quarter);
      if (qData?.date && (!latest || qData.date > latest)) latest = qData.date;
    });
    return latest;
  }

  // Selected investors who actually filed for this quarter — i.e. the managers
  // whose holdings went into this quarter's consensus basket.
  function investorsForQuarter(quarter) {
    return selectedIds
      .filter(id => (history[id] || []).some(q => q.quarter === quarter))
      .map(id => INVESTORS.find(i => i.id === id)?.name || id);
  }

  const quarterTopHoldings = allQuarters.map(q => {
    const lock = quarterLockStatus(q.quarter);
    return {
      quarter:   q.quarter,
      entryDate: lock.entryDate,                          // <-- lock date, not raw max filing date
      filed:     lock.filed,
      investors: investorsForQuarter(q.quarter),
      top:       consensusForQuarter(q.quarter).slice(0, BASKET_SIZE),
      lock,
    };
  });



  // The backtest uses EXACTLY the baskets shown in the table below, so "what
  // you see is what you backtest". Quarters with no holdings are skipped.
  // entryDate is Option A timing: the latest filing date among the selected
  // investors for that reported quarter.
  _btBaskets = quarterTopHoldings
    .filter(q => q.lock.locked && q.top.length > 0 && q.entryDate)   // <-- was: q.filed > 0
    .map(q => ({ quarter: q.quarter, entryDate: q.entryDate,
                investors: q.investors, tickers: q.top.map(c => c.ticker) }));

  console.log('Lock debug:', quarterTopHoldings.map(q => ({
    q: q.quarter,
    filed: q.lock.filed,
    locked: q.lock.locked,
    settled: q.lock.settled,
    R: q.lock.R,
    margin: q.lock.margin,
  })));
  console.log('Baskets passing filter:', _btBaskets.length);

  const heldByAll = consensus.filter(c => c.count >= filedLatest).length;
  const maxCommon = Math.max(...consensus.map(c => c.totalVal), 1);

  // ── Render ───────────────────────────────────────────────────────────────────
  mainEl.innerHTML = `
    <!-- CONSENSUS HOLDINGS CARD -->
    <div class="lab-card">
      <div class="lab-card-head">
        <div>
          <div class="lab-card-title">Consensus Holdings — ${latestQ}</div>
          <div class="lab-card-sub">Stocks held by at least ${minHolders} of the ${selectedIds.length} selected investors, inside each one's top ${topN} positions. Dual-class shares (e.g. GOOG + GOOGL) are merged into one issuer.</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'DM Serif Display',serif;font-size:2rem;color:var(--blue);line-height:1">${consensus.length}</div>
          <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3)">${heldByAll} held by all ${filedLatest}</div>
        </div>
      </div>
      <div class="lab-card-body">
        ${consensus.length === 0
          ? `<div class="empty"><p>No stock is held by ${minHolders}+ of the selected investors in their top ${topN} for ${latestQ}. Try increasing Top N or selecting investors with more similar styles.</p></div>`
          : `<div class="consensus-table-wrap">
              <table class="consensus-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Ticker</th>
                    <th>Company</th>
                    <th>Holders</th>
                    <th>Combined Value</th>
                    <th>Avg Weight</th>
                    <th>Investors</th>
                  </tr>
                </thead>
                <tbody>
                  ${consensus.map((c, i) => `
                    <tr>
                      <td class="rank-cell">${i + 1}</td>
                      <td class="ticker-cell" title="${c.name}">${c.ticker}</td>
                      <td class="company-cell" title="${c.name}">${c.name}</td>
                      <td class="holders-cell">${c.count}/${filedLatest}</td>
                      <td class="value-cell">${fmtM(c.totalVal)}</td>
                      <td class="weight-cell">${c.avgPct.toFixed(1)}%</td>
                      <td>
                        <div class="investor-chip-row">
                          ${c.holders
                            .sort((a, b) => b.pct - a.pct)
                            .map(h => `
                              <span
                                class="common-chip"
                                title="${h.invName}: ${h.pct.toFixed(1)}%, ${fmtM(h.value)}"
                                style="border-left:2px solid ${h.invColor}">
                                ${h.invName.split(' ')[0]} ${h.pct.toFixed(1)}%
                              </span>
                            `).join('')}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    </div>

    <!-- CONSENSUS OVER TIME CARD -->
    <div class="lab-card">
      <div class="lab-card-head">
        <div>
          <div class="lab-card-title">Consensus Over Time</div>
          <div class="lab-card-sub">Number of stocks held by ${minHolders}+ of the selected investors each quarter — a measure of how much these managers' ideas overlap.</div>
        </div>
      </div>
      <div class="lab-card-body">
        ${trend.filter(t => t.n > 0).length < 2
          ? `<div class="empty"><p>Not enough overlapping quarters to chart a trend.</p></div>`
          : `<div class="bt-chart-wrap" style="height:220px;position:relative">
               <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600;margin-bottom:8px">Shared Stocks per Quarter</div>
               <canvas id="bt-chart" height="160"></canvas>
             </div>`
        }
             <div style="margin-top:1rem">
                <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600;margin-bottom:8px">
                  Top 15 shared holdings by quarter
                </div>

                <div class="quarter-table-wrap">
                  <table class="quarter-table">
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th>Filed</th>
                        <th>Top shared holdings</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${quarterTopHoldings.filter(q => q.filed > 0).map(q => `
                        <tr>
                          <td class="quarter-cell">${q.quarter}</td>
                          <td class="filed-cell">${q.filed}</td>
                          <td>
                            <div class="quarter-tickers">
                              ${q.top.length === 0
                                ? `<span class="quarter-empty">No holdings met the ${minHolders}+ investor threshold.</span>`
                                : q.top.map((c, i) => `
                                  <span
                                    class="quarter-ticker-chip"
                                    title="#${i + 1} ${c.name} — ${c.count}/${q.filed} holders, ${fmtM(c.totalVal)} combined, ${c.avgPct.toFixed(1)}% avg weight">
                                    <span class="qt-rank">${i + 1}</span>
                                    <span class="qt-label">${(!c.ticker || c.ticker === '—' || String(c.ticker).startsWith('~')) ? c.name : c.ticker}</span>
                                    <span class="qt-count">${c.count}/${q.filed}</span>
                                  </span>
                                `).join('')}
                            </div>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
        <div style="margin-top:1rem;padding:0.85rem 1rem;background:var(--surface);border-radius:var(--r);font-size:0.74rem;color:var(--text-2);line-height:1.6">
          <strong>Equal-weight backtest of the top-15 consensus.</strong> Each quarter the portfolio holds that quarter's top-15 consensus names in equal weight, but it now starts only on the latest 13F filing date among the selected investors for that reported quarter. It then rebalances on the latest filing date for the next reported quarter. Returns use yfinance <em>split/dividend-adjusted</em> closes, held filing-date to next filing-date — not 13F value ÷ shares. Names with no usable price (de-listed, foreign lines, CUSIP-only "~" tickers) are dropped from that quarter and the survivors re-equal-weighted; coverage is shown so nothing is hidden.
        </div>

        <!-- ── EQUAL-WEIGHT CONSENSUS BACKTEST ── -->
        <div style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
              <div class="lab-card-title" style="font-size:0.98rem">Equal-Weight Top-15 Backtest</div>
              <div class="lab-card-sub">Holds the 15 names above each quarter, equal weight, starting on the latest filing date among the selected investors. Prices fetched live from yfinance.</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <label style="font-size:0.72rem;color:var(--text-2);display:flex;align-items:center;gap:5px">
                <input type="checkbox" id="bt-partial"> include current (partial) quarter
              </label>
              <button class="lab-run-btn" style="width:auto;margin:0;padding:8px 16px;font-size:0.85rem" onclick="runConsensusBacktest()">Run backtest →</button>
            </div>
          </div>
          <div id="bt-results" style="margin-top:1rem"></div>

          <div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1.25rem">
            <div class="lab-card-title" style="font-size:0.98rem">CAGR Optimizer</div>
            <div class="lab-card-sub">Searches investor combinations × top-N over the selected pool to maximise CAGR. Bounded search (not exhaustive) with a built-in out-of-sample check — read the caveat in the results before trusting a winner.</div>
            <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-top:12px">
              <label style="font-size:0.68rem;color:var(--text-2)">Min investors<br><input class="lab-topn-input" id="opt-min-inv" type="number" min="1" value="5"></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Top-N min<br><input class="lab-topn-input" id="opt-topn-min" type="number" min="1" value="${_labTopN}"></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Top-N max<br><input class="lab-topn-input" id="opt-topn-max" type="number" min="1" value="${Math.max(_labTopN, 50)}"></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Top-N step<br><input class="lab-topn-input" id="opt-topn-step" type="number" min="1" value="10"></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Method<br><select class="lab-topn-input" id="opt-method"><option value="greedy">greedy</option><option value="random">random</option></select></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Out-of-sample %<br><input class="lab-topn-input" id="opt-oos" type="number" min="0" max="80" value="30"></label>
              <label style="font-size:0.68rem;color:var(--text-2)">Budget (max evals)<br><input class="lab-topn-input" id="opt-budget" type="number" min="20" value="800"></label>
              <button class="lab-run-btn" style="width:auto;margin:0;padding:8px 16px;font-size:0.85rem" onclick="runOptimizer()">Optimize CAGR →</button>
            </div>
            <div id="opt-results" style="margin-top:1rem"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Draw the consensus-count trend line.
  if (trend.filter(t => t.n > 0).length >= 2) {
    setTimeout(() => {
      const ctx = document.getElementById('bt-chart');
      if (!ctx) return;
      if (window._btChart) { try { window._btChart.destroy(); } catch (e) {} }
      const maxN = Math.max(...trend.map(t => t.n), 1);
      window._btChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: trend.map(t => t.quarter),
          datasets: [{
            data: trend.map(t => t.n),
            backgroundColor: '#1549a8',
            borderRadius: 2,
            maxBarThickness: 14
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' shared stock' + (ctx.parsed.y === 1 ? '' : 's') } }
          },
          scales: {
            x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
            y: { beginAtZero: true, suggestedMax: maxN + 1, ticks: { stepSize: 1, precision: 0 }, grid: { color: 'rgba(0,0,0,0.04)' } }
          }
        }
      });
    }, 50);
  }
}

/* ═══════════════════════════════════════════════
   EQUAL-WEIGHT CONSENSUS BACKTEST (top-15, quarterly rebalance)
   Sends the exact baskets shown in the table to /api/backtest, which
   prices them with yfinance (adjusted closes) and returns an auditable
   per-quarter breakdown. Nothing here reconstructs price from 13F value.
   Timing uses the latest filing date in each quarter's selected-investor set,
   not the quarter-end date.
═══════════════════════════════════════════════ */
let _btResult = null;

function _btFmtPct(x) {
  if (x === null || x === undefined || isNaN(x)) return '—';
  const v = x * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

async function runConsensusBacktest() {
  const out = document.getElementById('bt-results');
  if (!out) return;
  if (_btRunning) return;
  if (!_btBaskets || _btBaskets.length < 2) {
    out.innerHTML = '<div class="empty"><p>Need at least two quarters of top-15 baskets. Run the analysis above first, or widen the investor selection.</p></div>';
    return;
  }
  _btRunning = true;
  const includePartial = !!(document.getElementById('bt-partial') && document.getElementById('bt-partial').checked);
  out.innerHTML = '<div class="lab-spinner" style="display:block">Fetching split/dividend-adjusted prices from yfinance and computing returns… the first run can take a minute (results are cached afterwards).</div>';

  let res;
  try {
    const resp = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baskets: _btBaskets, includePartial })
    });
    res = await resp.json();
  } catch (e) {
    _btRunning = false;
    out.innerHTML = `<div class="empty"><p>Backtest request failed: ${e.message}. Make sure server.py is running and yfinance is installed.</p></div>`;
    return;
  }
  _btRunning = false;

  if (!res || !res.ok) {
    out.innerHTML = `<div class="empty"><p>${(res && res.error) || 'Backtest failed.'}</p></div>`;
    return;
  }
  _btResult = res;
  renderBacktest(res);
}

function renderBacktest(res) {
  const out = document.getElementById('bt-results');
  if (!out) return;
  const periods = res.periods || [];

  // Annualised return (CAGR) from the cumulative growth and the elapsed span.
  const d0 = new Date(res.start_date), d1 = new Date(res.end_date);
  const years = Math.max((d1 - d0) / (365.25 * 864e5), 1e-9);
  const growth = 1 + res.cumulative_return;
  const cagr = growth > 0 ? Math.pow(growth, 1 / years) - 1 : null;
  const retCls = res.cumulative_return >= 0 ? 'var(--green)' : 'var(--red)';

  const kpi = (lbl, val, color) =>
    `<div style="flex:1;min-width:120px">
       <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3)">${lbl}</div>
       <div style="font-family:'DM Serif Display',serif;font-size:1.5rem;line-height:1.1;${color ? 'color:' + color : ''}">${val}</div>
     </div>`;

  const START = 100000;


  const safeMoney = (x, digits = 2) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return '—';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  };

  const safeRet = x => {
    const n = Number(x);
    if (!Number.isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  };







 const fmtUsd = (x, dec = 2) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return '—';

  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
};
  const srcLabel = (c) => {
    const s0 = c.src0 || 'market', s1 = c.src1 || 'market';
    if (s0 === 'market' && s1 === 'market') return { txt: 'market', col: 'var(--text-3)' };
    if (s0 === 'implied' && s1 === 'implied') return { txt: '13F mark', col: '#b45309' };
    return { txt: 'mixed', col: '#b45309' };
  };

  const rows = periods.map((p, i) => {
    const prevCum  = i === 0 ? 1 : periods[i - 1].cumulative;
    const startVal = START * prevCum;
    const endVal   = START * p.cumulative;
    const pnl      = endVal - startVal;
    const N        = p.constituents.length;
    const perName  = N ? startVal / N : 0;
    const investors = p.investors || [];

    const cons = p.constituents.map(c => {
      const sl = srcLabel(c);
      const nameStart = perName;
      const nameChg   = perName * c.ret;
      const nameEnd   = nameStart + nameChg;
      return `<tr>
         <td class="ticker-cell">${c.ticker}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace">${safeFixed(c.p0, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace">${safeFixed(c.p1, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace;color:${c.ret >= 0 ? 'var(--green)' : 'var(--red)'}">${_btFmtPct(c.ret)}</td>
         <td style="text-align:center"><span style="font-size:0.6rem;color:${sl.col};border:1px solid ${sl.col}55;border-radius:4px;padding:1px 5px">${sl.txt}</span></td>
         <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--text-3)">${fmtUsd(nameStart, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:${nameChg >= 0 ? 'var(--green)' : 'var(--red)'}">${(nameChg >= 0 ? '+' : '') + fmtUsd(nameChg, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace">${fmtUsd(nameEnd, 2)}</td>
       </tr>`;
    }).join('');

    // TOTAL row — the per-stock changes sum exactly to the quarter's change,
    // and the end values sum to the quarter's ending balance.
    const totalsRow = N ? `<tr style="border-top:2px solid var(--text-3);font-weight:700">
         <td>TOTAL · ${N} name${N === 1 ? '' : 's'}</td>
         <td></td><td></td>
         <td style="text-align:right;font-family:'DM Mono',monospace;color:${p.basket_ret >= 0 ? 'var(--green)' : 'var(--red)'}">${_btFmtPct(p.basket_ret)}</td>
         <td></td>
         <td style="text-align:right;font-family:'DM Mono',monospace">${fmtUsd(startVal, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace;color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${(pnl >= 0 ? '+' : '') + fmtUsd(pnl, 2)}</td>
         <td style="text-align:right;font-family:'DM Mono',monospace">${fmtUsd(endVal, 2)}</td>
       </tr>` : '';

    const droppedNote = p.dropped.length
      ? `<div style="font-size:0.68rem;color:var(--text-3);margin-top:8px">Dropped (no market price and no 13F mark): ${p.dropped.join(', ')}</div>` : '';

    const implausible = p.dropped_implausible || [];
    const implausibleNote = implausible.length
      ? `<div style="font-size:0.68rem;color:#b45309;margin-top:6px">Excluded as data artifacts (13F mark + split/identity issue → implausible move): ${implausible.map(d => `${d.ticker} (${safeFixed(d.p0, 2)}→${safeFixed(d.p1, 2)}, ${_btFmtPct(d.ret)})`).join(', ')}</div>` : '';

    const investorChips = investors.length
      ? investors.map(n => `<span style="font-size:0.64rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:2px 8px;white-space:nowrap">${n}</span>`).join(' ')
      : '<span style="font-size:0.68rem;color:var(--text-3)">(investor list unavailable — re-run the analysis above to capture it)</span>';

    return `
      <details style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;overflow:hidden">
        <summary style="cursor:pointer;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:12px;list-style:none">
          <span style="font-weight:600">${p.from_quarter} → ${p.to_quarter}${p.partial ? ' (partial)' : ''}</span>
          <span style="display:flex;gap:16px;align-items:center;font-family:'DM Mono',monospace;font-size:0.82rem">
            <span style="color:var(--text-3)">${p.n_priced}/${p.n_in} priced${p.n_implied ? ' · ' + p.n_implied + ' 13F' : ''}</span>
            <span style="color:${p.basket_ret >= 0 ? 'var(--green)' : 'var(--red)'};min-width:62px;text-align:right">${_btFmtPct(p.basket_ret)}</span>
            <span title="dollar P&L this quarter on a $100k start" style="min-width:96px;text-align:right;color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${(pnl >= 0 ? '+' : '') + fmtUsd(pnl, 0)}</span>
          </span>
        </summary>
        <div style="padding:10px 12px;background:var(--surface)">

          <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600;margin-bottom:5px">Investors used this quarter (${investors.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">${investorChips}</div>

          <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600;margin-bottom:5px">Dollar path (start $100,000)</div>
          <div style="font-family:'DM Mono',monospace;font-size:0.8rem;margin-bottom:12px;line-height:1.7">
            Start of quarter: <strong>${fmtUsd(startVal, 2)}</strong><br>
            Split equally across ${N} priced name${N === 1 ? '' : 's'} = <strong>${fmtUsd(perName, 2)}</strong> each<br>
            Quarter return <strong style="color:${p.basket_ret >= 0 ? 'var(--green)' : 'var(--red)'}">${_btFmtPct(p.basket_ret)}</strong>
              → P&amp;L <strong style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${(pnl >= 0 ? '+' : '') + fmtUsd(pnl, 2)}</strong><br>
            End of quarter: <strong>${fmtUsd(endVal, 2)}</strong>
          </div>

          <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600;margin-bottom:5px">
            Per-name calculation — held ${p.from} → ${p.to}
          </div>
          <div style="overflow-x:auto">
          <table class="consensus-table" style="width:100%;min-width:600px">
            <thead><tr>
              <th>Ticker</th>
              <th style="text-align:right">Entry</th>
              <th style="text-align:right">Exit</th>
              <th style="text-align:right">Return</th>
              <th style="text-align:center">Src</th>
              <th style="text-align:right">Start $</th>
              <th style="text-align:right">Change $</th>
              <th style="text-align:right">End $</th>
            </tr></thead>
            <tbody>${cons || '<tr><td colspan="8" style="color:var(--text-3)">No priceable names this quarter.</td></tr>'}</tbody>
            ${totalsRow ? `<tfoot>${totalsRow}</tfoot>` : ''}
          </table>
          </div>

          <div style="font-size:0.7rem;color:var(--text-2);margin-top:8px;line-height:1.6">
            Each name gets an equal slice of the ${fmtUsd(startVal, 0)} held this quarter (Start $). Its <strong>Change $</strong> = slice × (Exit ÷ Entry − 1). The per-stock changes add up to the quarter's <strong style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${(pnl >= 0 ? '+' : '') + fmtUsd(pnl, 2)}</strong> (TOTAL row), moving your balance from ${fmtUsd(startVal, 2)} to ${fmtUsd(endVal, 2)}. A "13F mark" price = median (value ÷ shares) across that quarter's holders, used only where no market price exists.
          </div>
          ${droppedNote}
          ${implausibleNote}
        </div>
      </details>`;
  }).join('');

  out.innerHTML = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px">
      ${kpi('Total return', _btFmtPct(res.cumulative_return), retCls)}
      ${kpi('Annualised (CAGR)', cagr === null ? '—' : _btFmtPct(cagr), retCls)}
      ${kpi('$100,000 grew to', fmtUsd(START * growth, 0), retCls)}
      ${kpi('Net P&L', (res.cumulative_return >= 0 ? '+' : '') + fmtUsd(START * res.cumulative_return, 0), retCls)}
      ${kpi('Quarters', String(res.n_periods), null)}
      ${kpi('Avg coverage', (res.coverage * 100).toFixed(0) + '%', null)}
    </div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:10px">
      ${res.start_date} → ${res.end_date} · equal weight · rebalanced on latest 13F filing date per reported quarter · adjusted closes${res.n_implied ? ' · ' + res.n_implied + ' name-legs priced from 13F marks where no market price existed' : ''}. ${res.coverage < 0.9 ? 'Coverage below 100% means some names had no price either way and were dropped that quarter — see the breakdown.' : ''}
    </div>
    <div style="height:240px;position:relative;margin-bottom:16px">
      <canvas id="bt-perf-chart"></canvas>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);font-weight:600">Per-quarter breakdown — click a row for the investors used, the dollar path, and every name's price &amp; return</div>
      <div style="display:flex;gap:6px">
        <button class="suggestion-chip" onclick="btDownloadXlsx()">Download Excel</button>
        <button class="suggestion-chip" onclick="btDownloadCsv()">Download CSV</button>
      </div>
    </div>
    ${rows}
  `;

  // Cumulative growth-of-$1 line.
  setTimeout(() => {
    const ctx = document.getElementById('bt-perf-chart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (window._btPerfChart) { try { window._btPerfChart.destroy(); } catch (e) {} }
    const labels = [res.start_date, ...periods.map(p => p.to)];
    const data   = [1, ...periods.map(p => p.cumulative)];
    window._btPerfChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{
        data, borderColor: '#1549a8', backgroundColor: 'rgba(21,73,168,0.08)',
        borderWidth: 2, pointRadius: 2, fill: true, tension: 0.15
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => '$' + c.parsed.y.toFixed(3) + '  (' + _btFmtPct(c.parsed.y - 1) + ')' } }
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
          y: { ticks: { callback: v => '$' + Number(v).toFixed(2), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } }
        }
      }
    });
  }, 50);
  try { renderTaxScenario(res); } catch (e) { console.warn('tax scenario:', e); }
}

function btDownloadCsv() {
  if (!_btResult) return;
  const START = 100000;
  const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const periods = _btResult.periods || [];
  const lines = [['quarter_from','quarter_to','held_from','held_to','investors_used',
                  'ticker','entry_price','exit_price','return','price_source',
                  'dollars_start','dollars_change','dollars_end','basket_return',
                  'quarter_start_value','quarter_end_value','cumulative_growth']];
  periods.forEach((p, i) => {
    const prevCum  = i === 0 ? 1 : periods[i - 1].cumulative;
    const startVal = START * prevCum;
    const endVal   = START * p.cumulative;
    const N        = p.constituents.length;
    const perName  = N ? startVal / N : 0;
    const invs     = (p.investors || []).join('; ');
    if (!p.constituents.length) {
      lines.push([p.from_quarter, p.to_quarter, p.from, p.to, invs,
                  '', '', '', '', '', '', '', '', p.basket_ret,
                  startVal.toFixed(2), endVal.toFixed(2), p.cumulative]);
    }
    p.constituents.forEach(c => {
      const src = (c.src0 === 'implied' || c.src1 === 'implied')
        ? ((c.src0 === 'implied' && c.src1 === 'implied') ? '13F' : 'mixed') : 'market';
      const chg = perName * c.ret;
      lines.push([p.from_quarter, p.to_quarter, p.from, p.to, invs,
                  c.ticker, c.p0, c.p1, c.ret, src,
                  perName.toFixed(2), chg.toFixed(2), (perName + chg).toFixed(2), p.basket_ret,
                  startVal.toFixed(2), endVal.toFixed(2), p.cumulative]);
    });
  });
  const csv = lines.map(r => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'consensus_backtest.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

async function btDownloadXlsx() {
  if (!_btResult) return;
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const resp = await fetch('/api/backtest/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_btResult)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert('Excel export failed: ' + (err.error || resp.statusText));
      return;
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'consensus_backtest.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('Excel export failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Excel'; }
  }
}

// ── CAGR Optimizer ──────────────────────────────────────────────────────────
let _optResults = [];

async function runOptimizer() {
  const ids = [..._labSelected];
  if (ids.length < 2) { alert('Select at least 2 investors as the candidate pool.'); return; }
  const names = {};
  INVESTORS.forEach(i => { if (_labSelected.has(i.id)) names[i.id] = i.name; });
  const num = (id, d) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? d : v; };
  const body = {
    investorIds: ids, investorNames: names,
    minInvestors: Math.max(1, num('opt-min-inv', 5)),
    topnMin:  Math.max(1, num('opt-topn-min', 10)),
    topnMax:  Math.max(1, num('opt-topn-max', 50)),
    topnStep: Math.max(1, num('opt-topn-step', 10)),
    method:   document.getElementById('opt-method')?.value || 'greedy',
    budget:   Math.max(20, num('opt-budget', 800)),
    oosFraction: Math.min(0.8, Math.max(0, num('opt-oos', 30) / 100)),
    includePartial: !!document.getElementById('bt-partial')?.checked,
  };
  const el = document.getElementById('opt-results');
  el.innerHTML = '<div class="lab-spinner" style="display:block">Searching combinations… the first run also warms the price cache, so it can take a while.</div>';
  try {
    const res = await fetch('/api/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    if (!res.ok) { el.innerHTML = '<div class="empty"><p>' + (res.error || 'Optimizer failed.') + '</p></div>'; return; }
    renderOptimizer(res);
  } catch (e) {
    el.innerHTML = '<div class="empty"><p>Optimizer error: ' + e + '</p></div>';
  }
}

function renderOptimizer(res) {
  _optResults = res.results || [];
  const pct = x => (x == null ? '—' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'));
  const hasOOS = res.test_quarters > 0;
  const rows = _optResults.map((r, i) => {
    const gap = (r.train_cagr != null && r.test_cagr != null) ? (r.train_cagr - r.test_cagr) : null;
    const oosStyle = (gap != null && gap > 0.05) ? ' style="text-align:right;color:var(--red)"' : ' style="text-align:right"';
    return `<tr>
      <td>${i + 1}</td>
      <td style="text-align:center">${r.topn}</td>
      <td style="text-align:center">${r.n_investors}</td>
      <td style="text-align:right;font-weight:600;color:${r.train_cagr >= 0 ? 'var(--green)' : 'var(--red)'}">${pct(r.train_cagr)}</td>
      <td${oosStyle}>${pct(r.test_cagr)}</td>
      <td style="text-align:right;color:var(--red)">${pct(r.max_drawdown)}</td>
      <td style="text-align:center">${r.quarters}</td>
      <td style="font-size:0.64rem;color:var(--text-2);max-width:320px">${r.investors.join(', ')}</td>
      <td style="text-align:center"><button class="suggestion-chip" onclick="applyOptimizerResult(${i})">Apply</button></td>
    </tr>`;
  }).join('');
  document.getElementById('opt-results').innerHTML = `
    <div style="font-size:0.72rem;color:var(--text-3);margin:8px 0">
      ${res.evaluations} combinations evaluated (${res.method}) from a pool of ${res.pool_size} · top-N ∈ {${res.topn_values.join(', ')}} · minimum ${res.min_investors} investors ·
      ${hasOOS ? 'trained on first ' + res.train_quarters + ' quarters, tested on last ' + res.test_quarters : 'no out-of-sample split'}
    </div>
    <div style="font-size:0.72rem;color:#b45309;margin-bottom:10px;line-height:1.5">⚠︎ ${res.note}</div>
    <div style="overflow-x:auto"><table class="consensus-table" style="width:100%;min-width:680px">
      <thead><tr>
        <th>#</th><th style="text-align:center">Top-N</th><th style="text-align:center">Investors</th>
        <th style="text-align:right">Train CAGR</th><th style="text-align:right">Test CAGR (OOS)</th>
        <th style="text-align:right">Max DD</th><th style="text-align:center">Qtrs</th>
        <th>Investor set</th><th></th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="9" style="color:var(--text-3)">No qualifying combinations found.</td></tr>'}</tbody>
    </table></div>`;
}

async function applyOptimizerResult(i) {
  const r = _optResults[i];
  if (!r) return;
  _labSelected = new Set(r.investor_ids);
  _labTopN = r.topn;
  rerenderLabList();
  await runLab();                       // rebuilds the consensus baskets for this set
  const tn = document.getElementById('lab-topn'); if (tn) tn.value = r.topn;
  runConsensusBacktest();               // then re-run the full backtest (exact timing)
  document.getElementById('lab-main')?.scrollIntoView({ behavior: 'smooth' });
}