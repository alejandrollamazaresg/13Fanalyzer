// core.js — shared state, utilities, data load, view router, bootstrap.
const PALETTE = ['#1549a8','#6d28d9','#0d7d5f','#9f3a00','#b45309','#be185d','#065f46','#1d4ed8','#4c1d95','#0369a1','#9a3412','#15803d','#a21caf'];
let INVESTORS = [];
let currentInvestor = null;
let currentTab = 'bubble';
let sortCol = 'pct'; let sortDir = -1;
const donutCharts = {};

function fmtM(v) {
  if (!v && v !== 0) return '—';
  return v >= 1000
    ? '$' + (v / 1000).toFixed(1) + 'B'
    : '$' + Math.round(v) + 'M';
}
function safeFixed(x, digits = 2) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}



function pctChg(curr, prev) { if (!prev) return null; return ((curr - prev) / prev * 100).toFixed(1); }

function fmtMktCap(v) {
  if (v == null || v === 0) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6)  return '$' + (v / 1e6).toFixed(1) + 'M';
  return '$' + Number(v).toLocaleString();
}

/* ---- INVESTOR SEARCH ---- */
async function initApp() {
  // Show investor names while loading
  const loadingItems = document.getElementById('loading-items');

  try {
    const resp = await fetch('/api/data');
    if (!resp.ok) throw new Error('Server not responding');
    INVESTORS = await resp.json();
    if (!INVESTORS.length) throw new Error('No data returned');
  } catch(e) {
    document.getElementById('loading-screen').innerHTML = `
      <div style="text-align:center;color:var(--red)">
        <div style="font-size:1.5rem;margin-bottom:0.5rem">⚠</div>
        <div style="font-family:'DM Serif Display',serif;font-size:1.1rem;margin-bottom:0.5rem">Could not connect to server</div>
        <div style="font-size:0.83rem;color:var(--text-2);max-width:320px">
          Make sure <code style="background:var(--surface);padding:2px 5px;border-radius:4px">server.py</code> is running.<br><br>
          Open a terminal and run:<br>
          <code style="background:var(--surface);padding:4px 8px;border-radius:4px;display:inline-block;margin-top:6px">python server.py</code>
        </div>
      </div>`;
    return;
  }

  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Update hero stats. Use the newest actual filing date across all loaded investors,
  // not the first investor in the array. This keeps the headline at 2026 when
  // at least one current 2026 filing has loaded.
  const totalAum = INVESTORS.reduce((s,i) => s + (i.aumRaw||0), 0);
  const filingDates = INVESTORS
    .map(i => i.lastFilingDate || i.filingDate || '')
    .filter(Boolean)
    .sort((a,b) => new Date(b) - new Date(a));
  const newestFilingDate = filingDates[0] || '';
  const newestFilingYear = newestFilingDate ? newestFilingDate.slice(0,4) : '—';

  document.getElementById('stat-investors').textContent = INVESTORS.length;
  document.getElementById('stat-aum').textContent = fmtM(totalAum);
  document.getElementById('stat-q').textContent = newestFilingYear;
  document.getElementById('nav-meta').textContent = newestFilingDate ? ('SEC EDGAR · latest filing ' + newestFilingDate) : 'SEC EDGAR · Live';
  document.getElementById('live-dot').style.background = '#22c55e';

  renderInvGrid();
  buildStockSuggestions();
}

function hardRefresh() {
  if (!confirm('Force re-fetch all 13F data from SEC? This may take 30–60 seconds.')) return;
  // Delete cache by calling refresh endpoint for each investor
  document.getElementById('nav-meta').textContent = 'Refreshing…';
  document.getElementById('live-dot').style.background = '#f59e0b';
  Promise.all(INVESTORS.map(inv => fetch(`/api/refresh/${inv.id}`)))
    .then(() => location.reload());
}

/* ---- INVESTOR CARDS ---- */
function switchView(view) {
  ['investors','search','market','compare','history','lab'].forEach(v => {
    const el = document.getElementById('view-'+v);
    if (el) el.style.display = v===view ? '' : 'none';
  });
  document.querySelectorAll('.nav-pill').forEach(p=>{
    const label = p.textContent.toLowerCase().trim();
    p.classList.toggle('active',
      (view==='investors' && label.includes('investor')) ||
      (view==='search' && label.includes('search')) ||
      (view==='market' && label.includes('market')) ||
      (view==='compare' && label.includes('compare')) ||
      (view==='history' && label==='history') ||
      (view==='lab' && label.includes('lab'))
    );
  });
  if(view==='search') buildStockSuggestions();
  if(view==='market') { _mvSection='flow'; renderMarketView(); }
  if(view==='compare') renderCompare();
  if(view==='history') initHistoryView();
  if(view==='lab') initLabView();
}


// ═══════════════════════════════════════════════════════════════
//  SHARED: full history cache (lazy-loaded once)
// ═══════════════════════════════════════════════════════════════


// ── bootstrap ─────────────────────────────────────────────────────────────
// Inject each page's markup partial (pages/*.html) into its #view-* wrapper,
// then start the app. Works under server.py and GitHub Pages (static fetch).
const VIEW_PARTIALS = ['investors','search','market','compare','history','lab'];
async function loadPartials() {
  await Promise.all(VIEW_PARTIALS.map(async name => {
    const host = document.getElementById('view-' + name);
    if (!host) return;
    const res = await fetch('pages/' + name + '.html');
    if (!res.ok) throw new Error('Failed to load pages/' + name + '.html (' + res.status + ')');
    host.innerHTML = await res.text();
  }));
}
(async () => {
  try {
    await loadPartials();
    initApp();
  } catch (err) {
    console.error(err);
    const app = document.getElementById('app');
    if (app) {
      app.style.display = 'block';
      app.innerHTML = '<div class="empty" style="padding:3rem"><p>Could not load page modules.<br>'
        + 'Serve this folder over HTTP (python server.py or any static server) — '
        + 'opening index.html via file:// will not work.</p></div>';
    }
  }
})();
