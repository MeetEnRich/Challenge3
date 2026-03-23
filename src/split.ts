// =============================================================
// split.ts — Split wallets across team members (shard-balanced)
//
// Ensures each member gets roughly equal wallets with balanced
// shard distribution, so each machine maximizes cross-shard tx.
//
// Usage:
//   npm run split -- --part 1
//   npm run split -- --part 2
// =============================================================

import * as fs   from "fs";
import * as path from "path";
import { CONFIG, NUM_SHARDS } from "./config";

const args    = process.argv.slice(2);
const partArg = args.indexOf("--part");
const PART    = partArg !== -1 ? parseInt(args[partArg + 1]) : 1;

const WALLETS_DIR = path.resolve(CONFIG.WALLETS_DIR);
const KEYS_FILE   = path.join(WALLETS_DIR, `keys_part${PART}.json`);
const NAMES       = [...CONFIG.MEMBER_NAMES];

interface WalletEntry {
  index:        number;
  address:      string;
  secretKeyHex: string;
  shard:        number;
}

function main() {
  if (!fs.existsSync(KEYS_FILE)) {
    console.error(`[split] ERROR: ${KEYS_FILE} not found. Run createWallets.ts --part ${PART} first.`);
    process.exit(1);
  }

  const all: WalletEntry[] = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  const total = all.length;

  console.log(`\n[split] Challenge 3: Crossover — Part ${PART}`);
  console.log(`  Splitting ${total} wallets across ${NAMES.length} members\n`);

  // Group by shard first for balanced split
  const byShard: WalletEntry[][] = [[], [], []];
  for (const w of all) byShard[w.shard].push(w);

  // Distribute each shard's wallets round-robin to members
  const memberWallets: WalletEntry[][] = NAMES.map(() => []);

  for (let s = 0; s < NUM_SHARDS; s++) {
    byShard[s].forEach((w, i) => {
      memberWallets[i % NAMES.length].push(w);
    });
  }

  // Write each member's file
  NAMES.forEach((name, i) => {
    const slice   = memberWallets[i];
    const outFile = path.join(WALLETS_DIR, `keys_part${PART}_${name}.json`);
    fs.writeFileSync(outFile, JSON.stringify(slice, null, 2));

    const shardCounts = [0, 0, 0];
    slice.forEach((w) => shardCounts[w.shard]++);

    console.log(
      `  ${name.padEnd(12)}: ${slice.length} wallets  [S0:${shardCounts[0]} S1:${shardCounts[1]} S2:${shardCounts[2]}]  →  keys_part${PART}_${name}.json`
    );
  });

  // Also copy the cross-shard map for each member
  const crossMapFile = path.join(WALLETS_DIR, `crossmap_part${PART}.json`);
  if (fs.existsSync(crossMapFile)) {
    console.log(`\n  Cross-shard map available: ${path.basename(crossMapFile)}`);
  }

  console.log(`
  ─────────────────────────────────────────────────────────
  LEADER: Run distribute to fund ALL wallets from GL wallet:
    npm run distribute -- --part ${PART}

  Then share each keys_part${PART}_NAME.json privately.
  ─────────────────────────────────────────────────────────
  EACH MEMBER runs on challenge day:

${NAMES.map((n) => `    npm run ${n}-p${PART}`).join("\n")}

  All 3 run at the same time on separate machines.
  ─────────────────────────────────────────────────────────
`);
}

main();
