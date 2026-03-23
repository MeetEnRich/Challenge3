// =============================================================
// monitor.ts — Real-time internal tracking for Challenge 3
//
// Reads spray log files and displays live stats.
// Use this instead of the live leaderboard (which may be inaccurate).
//
// Usage: npm run monitor
//        npm run monitor -- --part 1
//        npm run monitor -- --watch (auto-refresh every 5s)
// =============================================================

import * as fs   from "fs";
import * as path from "path";

const args     = process.argv.slice(2);
const partArg  = args.indexOf("--part");
const PART     = partArg !== -1 ? parseInt(args[partArg + 1]) : 0; // 0 = both
const WATCH    = args.includes("--watch");
const INTERVAL = 5000; // 5s refresh

const RESULTS_DIR = "./results";

interface SprayLog {
  timestamp:           string;
  part:                number;
  globalTxSent:        number;
  globalTxSuccess:     number;
  globalCrossShardTx:  number;
  globalFeesSpent:     string;
  feesSpentEgld:       string;
  elapsedSeconds:      string;
  wallets:             {
    address:    string;
    shard:      number;
    txSent:     number;
    txSuccess:  number;
    txFailed:   number;
    feesSpent:  string;
    errors:     string[];
  }[];
}

function readLogs(): SprayLog[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  const files = fs.readdirSync(RESULTS_DIR).filter((f) =>
    f.startsWith("spray_part") && f.endsWith(".json")
  );

  const logs: SprayLog[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8")) as SprayLog;
      if (PART === 0 || data.part === PART) {
        logs.push(data);
      }
    } catch { /* skip corrupted files */ }
  }
  return logs;
}

function display() {
  const logs = readLogs();
  if (logs.length === 0) {
    console.log("\n  No spray logs found. Is the spray running?\n");
    return;
  }

  console.clear();
  console.log("\n  ╔═══════════════════════════════════════════════════════╗");
  console.log("  ║   Challenge 3: Crossover — Internal Monitor          ║");
  console.log("  ╚═══════════════════════════════════════════════════════╝\n");

  let totalCrossShard = 0;
  let totalSent       = 0;
  let totalFees       = BigInt(0);

  for (const log of logs) {
    const memberName = extractMemberName(log);
    totalCrossShard += log.globalCrossShardTx;
    totalSent       += log.globalTxSent;
    totalFees       += BigInt(log.globalFeesSpent || "0");

    // Per-shard breakdown
    const shardSent = [0, 0, 0];
    const shardFailed = [0, 0, 0];
    for (const w of log.wallets) {
      shardSent[w.shard]   += w.txSent;
      shardFailed[w.shard] += w.txFailed;
    }

    console.log(`  Part ${log.part} ${memberName ? `(${memberName})` : ""}`);
    console.log(`    Cross-shard txs : ${log.globalCrossShardTx.toLocaleString()}`);
    console.log(`    Total sent      : ${log.globalTxSent.toLocaleString()}`);
    console.log(`    Fees            : ${log.feesSpentEgld} EGLD`);
    console.log(`    Elapsed         : ${log.elapsedSeconds}s`);
    console.log(`    By shard        : S0:${shardSent[0]} | S1:${shardSent[1]} | S2:${shardSent[2]}`);
    console.log(`    Errors by shard : S0:${shardFailed[0]} | S1:${shardFailed[1]} | S2:${shardFailed[2]}`);
    console.log();
  }

  console.log("  ─── COMBINED ───────────────────────────────────────────");
  console.log(`  Total cross-shard : ${totalCrossShard.toLocaleString()}`);
  console.log(`  Total sent        : ${totalSent.toLocaleString()}`);
  console.log(`  Total fees        : ${(Number(totalFees) / 1e18).toFixed(6)} EGLD`);
  console.log(`  1M bonus target   : ${totalCrossShard >= 1_000_000 ? "✅ REACHED!" : `${((totalCrossShard / 1_000_000) * 100).toFixed(1)}%`}`);
  console.log(`\n  Last update: ${new Date().toLocaleTimeString()}\n`);
}

function extractMemberName(log: SprayLog): string {
  // Try to infer member name from log file pattern
  return "";
}

if (WATCH) {
  display();
  setInterval(display, INTERVAL);
} else {
  display();
}
