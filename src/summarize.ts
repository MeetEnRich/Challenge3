// =============================================================
// summarize.ts — Post-challenge summary for Challenge 3
//
// Usage: npm run summarize
// =============================================================

import * as fs   from "fs";
import * as path from "path";

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
  wallets: {
    address:    string;
    shard:      number;
    txSent:     number;
    txSuccess:  number;
    txFailed:   number;
    feesSpent:  string;
    errors:     string[];
  }[];
}

function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    console.log("No results directory found.");
    return;
  }

  const files = fs.readdirSync(RESULTS_DIR).filter((f) =>
    f.startsWith("spray_part") && f.endsWith(".json")
  );

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║   Challenge 3: Crossover — Final Summary            ║");
  console.log("  ╚══════════════════════════════════════════════════════╝\n");

  let grandTotalCrossShard = 0;
  let grandTotalSent       = 0;
  let grandTotalFees       = BigInt(0);
  let totalErrors          = 0;

  for (const file of files) {
    try {
      const log: SprayLog = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8"));

      const shardSent = [0, 0, 0];
      let fileErrors = 0;
      for (const w of log.wallets) {
        shardSent[w.shard] += w.txSent;
        fileErrors += w.txFailed;
      }

      console.log(`  📄 ${file}`);
      console.log(`     Part: ${log.part}  |  Timestamp: ${log.timestamp}`);
      console.log(`     Cross-shard: ${log.globalCrossShardTx?.toLocaleString() || "N/A"}`);
      console.log(`     Total sent:  ${log.globalTxSent.toLocaleString()}`);
      console.log(`     Fees:        ${log.feesSpentEgld || "N/A"} EGLD`);
      console.log(`     Duration:    ${log.elapsedSeconds}s`);
      console.log(`     Wallets:     ${log.wallets.length}`);
      console.log(`     By shard:    S0:${shardSent[0]} | S1:${shardSent[1]} | S2:${shardSent[2]}`);
      console.log(`     Errors:      ${fileErrors}`);
      console.log();

      grandTotalCrossShard += log.globalCrossShardTx || 0;
      grandTotalSent       += log.globalTxSent;
      grandTotalFees       += BigInt(log.globalFeesSpent || "0");
      totalErrors          += fileErrors;
    } catch (e) {
      console.log(`  ⚠️  Could not parse: ${file}`);
    }
  }

  console.log("  ═══ GRAND TOTALS (All Parts, All Members) ═══════════");
  console.log(`  Cross-shard txs : ${grandTotalCrossShard.toLocaleString()}`);
  console.log(`  Total sent      : ${grandTotalSent.toLocaleString()}`);
  console.log(`  Total fees      : ${(Number(grandTotalFees) / 1e18).toFixed(6)} EGLD`);
  console.log(`  Total errors    : ${totalErrors.toLocaleString()}`);
  console.log(`  Success rate    : ${((grandTotalSent - totalErrors) / Math.max(grandTotalSent, 1) * 100).toFixed(1)}%`);
  console.log(`  1M bonus        : ${grandTotalCrossShard >= 1_000_000 ? "✅ REACHED!" : `❌ ${grandTotalCrossShard.toLocaleString()}/1,000,000`}`);
  console.log();
}

main();
