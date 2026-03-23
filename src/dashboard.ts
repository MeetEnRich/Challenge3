// =============================================================
// dashboard.ts — Premium live dashboard for Challenge 3: Crossover
// Serves at http://localhost:3000
//
// Unified guild view — all members tracked as one.
// Focus: cross-shard tx volume, throughput, fee budget, shard flow.
//
// Usage: npm run dashboard
// =============================================================

import * as http from "http";
import * as fs   from "fs";
import * as path from "path";

const PORT        = 3000;
const RESULTS_DIR = "./results";

interface WalletLog {
  address:   string;
  shard:     number;
  txSent:    number;
  txSuccess: number;
  txFailed:  number;
  feesSpent: string;
  errors:    string[];
}

interface SprayLog {
  timestamp:          string;
  part:               number;
  globalTxSent:       number;
  globalTxSuccess:    number;
  globalCrossShardTx: number;
  globalFeesSpent:    string;
  feesSpentEgld:      string;
  elapsedSeconds:     string;
  wallets:            WalletLog[];
}

function readAllLogs(): SprayLog[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("spray_part") && f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8")) as SprayLog; }
      catch { return null; }
    })
    .filter(Boolean) as SprayLog[];
}

function buildStats() {
  const logs = readAllLogs();

  // Part-level aggregation
  const partData: Record<number, {
    crossShard: number; sent: number; success: number; failed: number;
    fees: number; elapsed: number; wallets: WalletLog[]; budget: number;
    shardSent: number[]; shardFailed: number[];
  }> = {};

  for (const part of [1, 2]) {
    const partLogs = logs.filter((l) => l.part === part);
    const allWallets: WalletLog[] = [];
    const shardSent = [0, 0, 0];
    const shardFailed = [0, 0, 0];
    let cross = 0, sent = 0, success = 0, failed = 0, fees = 0, elapsed = 0;

    for (const log of partLogs) {
      cross   += log.globalCrossShardTx || 0;
      sent    += log.globalTxSent || 0;
      success += log.globalTxSuccess || 0;
      fees    += parseFloat(log.feesSpentEgld || "0");
      elapsed  = Math.max(elapsed, parseFloat(log.elapsedSeconds || "0"));
      for (const w of log.wallets || []) {
        allWallets.push(w);
        shardSent[w.shard]   += w.txSent;
        shardFailed[w.shard] += w.txFailed;
        failed += w.txFailed;
      }
    }

    partData[part] = {
      crossShard: cross, sent, success, failed,
      fees, elapsed, wallets: allWallets,
      budget: part === 1 ? 2000 : 500,
      shardSent, shardFailed,
    };
  }

  // Grand totals
  const totalCross   = partData[1].crossShard + partData[2].crossShard;
  const totalSent    = partData[1].sent + partData[2].sent;
  const totalSuccess = partData[1].success + partData[2].success;
  const totalFailed  = partData[1].failed + partData[2].failed;
  const totalFees    = partData[1].fees + partData[2].fees;
  const maxElapsed   = Math.max(partData[1].elapsed, partData[2].elapsed);
  const rate         = maxElapsed > 0 ? Math.round(totalSent / maxElapsed) : 0;

  // Top wallets (combined)
  const allWallets = [...partData[1].wallets, ...partData[2].wallets];
  const topWallets = allWallets
    .sort((a, b) => b.txSent - a.txSent)
    .slice(0, 15)
    .map((w) => ({
      address: w.address,
      shard: w.shard,
      sent: w.txSent,
      success: w.txSuccess,
      failed: w.txFailed,
    }));

  // Shard totals combined
  const shardSent = [0, 1, 2].map((s) => partData[1].shardSent[s] + partData[2].shardSent[s]);

  return {
    totalCross, totalSent, totalSuccess, totalFailed,
    totalFees: totalFees.toFixed(6), rate, elapsed: maxElapsed,
    part1: {
      cross: partData[1].crossShard, sent: partData[1].sent,
      fees: partData[1].fees.toFixed(6), budget: 2000,
      elapsed: partData[1].elapsed,
      shardSent: partData[1].shardSent,
    },
    part2: {
      cross: partData[2].crossShard, sent: partData[2].sent,
      fees: partData[2].fees.toFixed(6), budget: 500,
      elapsed: partData[2].elapsed,
      shardSent: partData[2].shardSent,
    },
    shardSent, topWallets,
    activeWallets: allWallets.filter((w) => w.txSent > 0).length,
    totalWallets: allWallets.length,
  };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Crossover Dashboard | GreenGlitch</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#05060a;--surface:rgba(12,14,22,.85);--surface2:rgba(18,21,32,.7);
  --border:rgba(62,72,105,.25);--border-glow:rgba(35,247,221,.12);
  --cyan:#23F7DD;--blue:#3B82F6;--indigo:#6366F1;--purple:#A78BFA;
  --green:#10B981;--amber:#F59E0B;--rose:#F43F5E;
  --text:#E8ECF4;--muted:#64748B;--dim:#374151;
}
body{
  background:var(--bg);color:var(--text);font-family:'Space Grotesk',sans-serif;
  min-height:100vh;overflow-x:hidden;
  background-image:
    radial-gradient(ellipse at 20% 0%, rgba(35,247,221,.04) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(99,102,241,.04) 0%, transparent 50%);
}

/* ── Header ── */
header{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 32px;
  border-bottom:1px solid var(--border);
  background:rgba(5,6,10,.8);backdrop-filter:blur(16px);
  position:sticky;top:0;z-index:100;
}
.logo{display:flex;align-items:center;gap:14px}
.logo-mark{
  width:36px;height:36px;border-radius:10px;
  background:linear-gradient(135deg,var(--cyan),var(--indigo));
  display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:.85rem;color:#000;
  box-shadow:0 0 20px rgba(35,247,221,.2);
}
.logo-text h1{font-size:1rem;font-weight:700;
  background:linear-gradient(90deg,var(--cyan),var(--purple));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.2}
.logo-text span{font-size:.65rem;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
.header-right{display:flex;align-items:center;gap:16px}
.live-badge{
  display:flex;align-items:center;gap:6px;
  padding:5px 14px;border-radius:999px;font-size:.7rem;font-weight:600;
  background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);color:var(--green);
}
.live-badge::before{content:'';width:6px;height:6px;background:var(--green);border-radius:50%;
  animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.8)}}
.clock{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--muted)}

/* ── Layout ── */
.container{max-width:1440px;margin:0 auto;padding:24px 32px}

/* ── Hero counter ── */
.hero{
  text-align:center;padding:40px 0 28px;
}
.hero-label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.18em;color:var(--muted);margin-bottom:8px}
.hero-count{
  font-size:4.5rem;font-weight:700;line-height:1;
  font-family:'JetBrains Mono','Space Grotesk',monospace;
  background:linear-gradient(135deg,var(--cyan) 0%,var(--blue) 40%,var(--purple) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  filter:drop-shadow(0 0 40px rgba(35,247,221,.15));
  font-variant-numeric:tabular-nums;
}
.hero-sub{font-size:.8rem;color:var(--muted);margin-top:10px}
.hero-sub b{color:var(--cyan);font-weight:600}

/* ── Stat row ── */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
.kpi{
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;padding:16px 18px;
  position:relative;overflow:hidden;
  transition:border-color .3s;
}
.kpi:hover{border-color:var(--border-glow)}
.kpi-label{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:6px}
.kpi-val{font-size:1.6rem;font-weight:700;font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;line-height:1.1}
.kpi-sub{font-size:.65rem;color:var(--dim);margin-top:4px}

/* ── Parts row ── */
.parts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
.part-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;padding:18px 20px;position:relative;overflow:hidden;
}
.part-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.part-card.p1::before{background:linear-gradient(90deg,var(--cyan),var(--blue))}
.part-card.p2::before{background:linear-gradient(90deg,var(--indigo),var(--purple))}
.part-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.part-title{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.part-title.p1c{color:var(--cyan)}.part-title.p2c{color:var(--purple)}
.part-elapsed{font-size:.68rem;color:var(--muted);font-family:'JetBrains Mono',monospace}
.part-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.pm{text-align:center}
.pm-val{font-size:1.2rem;font-weight:700;font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
.pm-label{font-size:.58rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-top:2px}
/* Budget bar */
.budget-track{background:rgba(100,116,139,.15);border-radius:999px;height:5px;overflow:hidden;margin-top:4px}
.budget-fill{height:100%;border-radius:999px;transition:width .8s cubic-bezier(.4,0,.2,1)}
.bf-ok{background:linear-gradient(90deg,var(--green),var(--cyan))}
.bf-warn{background:linear-gradient(90deg,var(--amber),var(--rose))}
.budget-meta{display:flex;justify-content:space-between;font-size:.6rem;color:var(--muted);margin-top:4px}

/* ── Shard flow ── */
.shard-section{margin-bottom:20px}
.section-title{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);margin-bottom:10px}
.shard-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.shard-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;padding:16px;text-align:center;
  position:relative;overflow:hidden;
  transition:transform .2s,border-color .3s;
}
.shard-card:hover{transform:translateY(-2px);border-color:var(--border-glow)}
.shard-route{font-size:.68rem;font-weight:600;color:var(--muted);margin-bottom:4px;letter-spacing:.05em}
.shard-arrow{font-size:.9rem;margin:6px 0;opacity:.5}
.shard-val{font-size:1.8rem;font-weight:700;font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
.sc0{color:var(--cyan)}.sc1{color:var(--blue)}.sc2{color:var(--purple)}
.shard-pct{font-size:.62rem;color:var(--dim);margin-top:3px}

/* ── Bottom grid ── */
.bottom{display:grid;grid-template-columns:1fr 340px;gap:12px;margin-bottom:20px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px}
.panel-title{font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:14px}
.chart-wrap{position:relative;height:220px}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:.72rem}
thead th{text-align:left;padding:5px 6px;color:var(--muted);font-weight:600;font-size:.6rem;
  text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border)}
tbody tr{transition:background .15s}
tbody tr:hover{background:rgba(35,247,221,.03)}
tbody td{padding:6px;border-bottom:1px solid rgba(62,72,105,.12);
  font-family:'JetBrains Mono',monospace;font-size:.68rem;font-variant-numeric:tabular-nums}
.shard-tag{display:inline-block;padding:1px 8px;border-radius:4px;font-size:.58rem;font-weight:700}
.st0{background:rgba(35,247,221,.1);color:var(--cyan)}
.st1{background:rgba(59,130,246,.1);color:var(--blue)}
.st2{background:rgba(167,139,250,.1);color:var(--purple)}

/* ── Footer ── */
.footer{text-align:center;padding:12px;font-size:.62rem;color:var(--dim)}

@media(max-width:900px){
  .stats{grid-template-columns:repeat(3,1fr)}
  .parts,.bottom{grid-template-columns:1fr}
  .shard-grid{grid-template-columns:1fr}
  .hero-count{font-size:3rem}
}
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-mark">GG</div>
    <div class="logo-text">
      <h1>GreenGlitch · Crossover</h1>
      <span>Challenge 3 — Internal Dashboard</span>
    </div>
  </div>
  <div class="header-right">
    <div class="clock" id="clock"></div>
    <div class="live-badge">LIVE</div>
  </div>
</header>

<div class="container">

  <!-- Hero counter -->
  <div class="hero">
    <div class="hero-label">Total Cross-Shard Transactions</div>
    <div class="hero-count" id="hero-count">0</div>
    <div class="hero-sub"><b id="hero-rate">0</b> tx/s  ·  <span id="hero-wallets">0</span> active wallets  ·  <span id="hero-elapsed">0s</span> elapsed</div>
  </div>

  <!-- KPI strip -->
  <div class="stats">
    <div class="kpi">
      <div class="kpi-label">Sent</div>
      <div class="kpi-val" style="color:var(--blue)" id="k-sent">0</div>
      <div class="kpi-sub">total transactions</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Accepted</div>
      <div class="kpi-val" style="color:var(--green)" id="k-ok">0</div>
      <div class="kpi-sub" id="k-ok-pct">—</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Failed</div>
      <div class="kpi-val" style="color:var(--rose)" id="k-fail">0</div>
      <div class="kpi-sub">rejected / errors</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Fees Spent</div>
      <div class="kpi-val" style="color:var(--amber)" id="k-fees">0</div>
      <div class="kpi-sub">EGLD consumed</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Throughput</div>
      <div class="kpi-val" style="color:var(--cyan)" id="k-rate">0</div>
      <div class="kpi-sub">tx/s average</div>
    </div>
  </div>

  <!-- Part 1 and Part 2 side by side -->
  <div class="parts">
    <div class="part-card p1">
      <div class="part-head">
        <div class="part-title p1c">Part 1 — Capacity</div>
        <div class="part-elapsed" id="p1-elapsed">0s</div>
      </div>
      <div class="part-metrics">
        <div class="pm"><div class="pm-val" style="color:var(--cyan)" id="p1-cross">0</div><div class="pm-label">Cross-Shard</div></div>
        <div class="pm"><div class="pm-val" id="p1-sent">0</div><div class="pm-label">Total Sent</div></div>
        <div class="pm"><div class="pm-val" style="color:var(--amber)" id="p1-fees">0</div><div class="pm-label">Fees (EGLD)</div></div>
      </div>
      <div class="budget-track"><div class="budget-fill bf-ok" id="p1-bfill" style="width:0%"></div></div>
      <div class="budget-meta"><span id="p1-bused">0 EGLD used</span><span>Budget: 2,000 EGLD</span></div>
    </div>
    <div class="part-card p2">
      <div class="part-head">
        <div class="part-title p2c">Part 2 — Capability</div>
        <div class="part-elapsed" id="p2-elapsed">0s</div>
      </div>
      <div class="part-metrics">
        <div class="pm"><div class="pm-val" style="color:var(--purple)" id="p2-cross">0</div><div class="pm-label">Cross-Shard</div></div>
        <div class="pm"><div class="pm-val" id="p2-sent">0</div><div class="pm-label">Total Sent</div></div>
        <div class="pm"><div class="pm-val" style="color:var(--amber)" id="p2-fees">0</div><div class="pm-label">Fees (EGLD)</div></div>
      </div>
      <div class="budget-track"><div class="budget-fill bf-ok" id="p2-bfill" style="width:0%"></div></div>
      <div class="budget-meta"><span id="p2-bused">0 EGLD used</span><span>Budget: 500 EGLD</span></div>
    </div>
  </div>

  <!-- Shard flow -->
  <div class="shard-section">
    <div class="section-title">Cross-Shard Flow</div>
    <div class="shard-grid">
      <div class="shard-card">
        <div class="shard-route">SHARD 0 → SHARD 1</div>
        <div class="shard-arrow">⟶</div>
        <div class="shard-val sc0" id="sf-0">0</div>
        <div class="shard-pct" id="sf-0-pct">0%</div>
      </div>
      <div class="shard-card">
        <div class="shard-route">SHARD 1 → SHARD 2</div>
        <div class="shard-arrow">⟶</div>
        <div class="shard-val sc1" id="sf-1">0</div>
        <div class="shard-pct" id="sf-1-pct">0%</div>
      </div>
      <div class="shard-card">
        <div class="shard-route">SHARD 2 → SHARD 0</div>
        <div class="shard-arrow">⟶</div>
        <div class="shard-val sc2" id="sf-2">0</div>
        <div class="shard-pct" id="sf-2-pct">0%</div>
      </div>
    </div>
  </div>

  <!-- Chart + Top wallets -->
  <div class="bottom">
    <div class="panel">
      <div class="panel-title">Throughput Over Time (tx/s)</div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
    </div>
    <div class="panel">
      <div class="panel-title">Top Performing Wallets</div>
      <div style="max-height:220px;overflow-y:auto">
      <table>
        <thead><tr><th>#</th><th>Address</th><th>Shard</th><th>Sent</th></tr></thead>
        <tbody id="top-wallets"></tbody>
      </table>
      </div>
    </div>
  </div>
</div>

<div class="footer" id="footer">Connecting to spray engine…</div>

<script>
// Clock
function updateClock(){
  const now = new Date();
  const utc = now.toISOString().slice(11,19)+' UTC';
  const local = now.toLocaleTimeString();
  document.getElementById('clock').textContent = local + '  ·  ' + utc;
}
updateClock(); setInterval(updateClock, 1000);

// Chart
const ctx = document.getElementById('chart').getContext('2d');
const chart = new Chart(ctx, {
  type:'line',
  data:{
    labels:[],
    datasets:[{
      label:'Cross-Shard tx/s',
      data:[],
      borderColor:'#23F7DD',
      backgroundColor:'rgba(35,247,221,.06)',
      borderWidth:2,pointRadius:0,fill:true,tension:.4,
    }]
  },
  options:{
    responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{legend:{display:false}},
    scales:{
      x:{display:false},
      y:{
        grid:{color:'rgba(62,72,105,.2)'},
        ticks:{color:'#475569',font:{family:"'JetBrains Mono'",size:10}},
        beginAtZero:true,
      }
    }
  }
});

let prevCross = 0;
let prevTime = Date.now();

async function refresh(){
  try{
    const res = await fetch('/api/stats');
    const d = await res.json();
    const now = Date.now();
    const dt = (now - prevTime) / 1000;
    prevTime = now;

    // Hero
    document.getElementById('hero-count').textContent = d.totalCross.toLocaleString();
    document.getElementById('hero-rate').textContent = d.rate.toLocaleString();
    document.getElementById('hero-wallets').textContent = d.activeWallets + '/' + d.totalWallets;
    document.getElementById('hero-elapsed').textContent = d.elapsed.toFixed(0) + 's';

    // KPIs
    set('k-sent', d.totalSent.toLocaleString());
    set('k-ok', d.totalSuccess.toLocaleString());
    set('k-ok-pct', d.totalSent > 0 ? ((d.totalSuccess/d.totalSent)*100).toFixed(1)+'% accept rate' : '—');
    set('k-fail', d.totalFailed.toLocaleString());
    set('k-fees', d.totalFees + ' EGLD');
    set('k-rate', d.rate.toLocaleString() + ' tx/s');

    // Part 1
    set('p1-cross', d.part1.cross.toLocaleString());
    set('p1-sent', d.part1.sent.toLocaleString());
    set('p1-fees', parseFloat(d.part1.fees).toFixed(4));
    set('p1-elapsed', d.part1.elapsed.toFixed(0) + 's');
    const p1pct = Math.min((parseFloat(d.part1.fees)/2000)*100, 100);
    document.getElementById('p1-bfill').style.width = p1pct + '%';
    document.getElementById('p1-bfill').className = 'budget-fill ' + (p1pct > 85 ? 'bf-warn' : 'bf-ok');
    set('p1-bused', parseFloat(d.part1.fees).toFixed(2) + ' EGLD used');

    // Part 2
    set('p2-cross', d.part2.cross.toLocaleString());
    set('p2-sent', d.part2.sent.toLocaleString());
    set('p2-fees', parseFloat(d.part2.fees).toFixed(4));
    set('p2-elapsed', d.part2.elapsed.toFixed(0) + 's');
    const p2pct = Math.min((parseFloat(d.part2.fees)/500)*100, 100);
    document.getElementById('p2-bfill').style.width = p2pct + '%';
    document.getElementById('p2-bfill').className = 'budget-fill ' + (p2pct > 85 ? 'bf-warn' : 'bf-ok');
    set('p2-bused', parseFloat(d.part2.fees).toFixed(2) + ' EGLD used');

    // Shard flow
    const sTotal = d.shardSent.reduce((a,b) => a+b, 0) || 1;
    d.shardSent.forEach((v, i) => {
      set('sf-'+i, v.toLocaleString());
      set('sf-'+i+'-pct', ((v/sTotal)*100).toFixed(1)+'% of volume');
    });

    // Chart — instantaneous rate
    const instRate = dt > 0 ? Math.round((d.totalCross - prevCross) / dt) : d.rate;
    prevCross = d.totalCross;
    if(chart.data.labels.length > 90){chart.data.labels.shift();chart.data.datasets[0].data.shift()}
    chart.data.labels.push(new Date().toLocaleTimeString());
    chart.data.datasets[0].data.push(instRate > 0 ? instRate : d.rate);
    chart.update('none');

    // Top wallets
    const tbody = document.getElementById('top-wallets');
    tbody.innerHTML = (d.topWallets||[]).map((w,i) => {
      const addr = w.address.slice(0,6)+'…'+w.address.slice(-4);
      const cls = 'st'+w.shard;
      return '<tr>'
        +'<td style="color:var(--dim)">'+(i+1)+'</td>'
        +'<td style="color:var(--cyan)">'+addr+'</td>'
        +'<td><span class="shard-tag '+cls+'">S'+w.shard+'</span></td>'
        +'<td style="font-weight:600">'+w.sent.toLocaleString()+'</td>'
        +'</tr>';
    }).join('');

    set('footer', 'Last update: '+new Date().toLocaleTimeString()+'  ·  Auto-refresh 2s  ·  ⚠️ Internal tracking only — do not trust live leaderboard');
  }catch(e){
    set('footer', 'Waiting for spray engine… ('+e.message+')');
  }
}

function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v}
refresh(); setInterval(refresh,2000);
</script>
</body>
</html>`;

// ── HTTP Server ────────────────────────────────────────────
function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.url === "/api/stats") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      res.end(JSON.stringify(buildStats()));
    } catch {
      res.end(JSON.stringify({
        totalCross: 0, totalSent: 0, totalSuccess: 0, totalFailed: 0,
        totalFees: "0", rate: 0, elapsed: 0,
        part1: { cross: 0, sent: 0, fees: "0", budget: 2000, elapsed: 0, shardSent: [0,0,0] },
        part2: { cross: 0, sent: 0, fees: "0", budget: 500, elapsed: 0, shardSent: [0,0,0] },
        shardSent: [0,0,0], topWallets: [], activeWallets: 0, totalWallets: 0,
      }));
    }
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(HTML);
}

const server = http.createServer(serve);
server.listen(PORT, () => {
  console.log("\n[dashboard] Challenge 3: Crossover — Live Dashboard");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  Open: http://localhost:" + PORT);
  console.log("  Reads: results/spray_part*_log*.json every 2s");
  console.log("  Press Ctrl+C to stop.\n");
});
