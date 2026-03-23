// =============================================================
// createWallets.ts — Shard-aware wallet generation for Crossover
//
// Generates wallets and computes shard assignment for each.
// Ensures cross-shard receiver mapping is built.
//
// Usage:
//   npm run create-wallets -- --part 1
//   npm run create-wallets -- --part 2
//   npm run create-wallets -- --part 1 --count 20
// =============================================================

import { Mnemonic, UserWallet } from "@multiversx/sdk-core";
import * as fs   from "fs";
import * as path from "path";
import { CONFIG, NUM_SHARDS, getShardOfAddress } from "./config";

const args     = process.argv.slice(2);
const partArg  = args.indexOf("--part");
const PART     = partArg !== -1 ? parseInt(args[partArg + 1]) : 1;
const countArg = args.indexOf("--count");
const COUNT    = countArg !== -1 ? parseInt(args[countArg + 1]) : CONFIG.WALLET_COUNT;

const WALLETS_DIR = path.resolve(CONFIG.WALLETS_DIR);
const KEYS_FILE   = path.join(WALLETS_DIR, `keys_part${PART}.json`);
const CSV_FILE    = path.join(WALLETS_DIR, `addresses_part${PART}.csv`);

export interface WalletEntry {
  index:        number;
  address:      string;
  secretKeyHex: string;
  shard:        number;
}

export interface CrossShardMap {
  [senderAddress: string]: string[]; // list of receiver addresses in different shards
}

async function main() {
  fs.mkdirSync(WALLETS_DIR, { recursive: true });

  // Check if keys file already exists
  let existing: WalletEntry[] = [];
  if (fs.existsSync(KEYS_FILE)) {
    existing = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  }

  console.log(`\n[createWallets] Challenge 3: Crossover — Part ${PART}`);
  console.log(`  Target     : ${COUNT} wallets`);
  console.log(`  Already    : ${existing.length}`);

  const toGenerate = COUNT - existing.length;
  if (toGenerate <= 0) {
    console.log("  Nothing to generate. Done.");
    printSummary(existing);
    buildCrossShardMap(existing);
    return;
  }

  console.log(`  Generating : ${toGenerate} new wallets\n`);

  const allWallets: WalletEntry[] = [...existing];
  const existingIndexes = new Set(existing.map((w) => w.index));

  // Track shard distribution during generation
  const shardCounts = [0, 0, 0];
  existing.forEach((w) => shardCounts[w.shard]++);

  for (let i = 0; i < COUNT; i++) {
    if (existingIndexes.has(i)) continue;

    const mnemonic  = Mnemonic.generate();
    const secretKey = mnemonic.deriveKey(0);
    const publicKey = secretKey.generatePublicKey();
    const address   = publicKey.toAddress("erd").toBech32();
    const pubkeyHex = Buffer.from(publicKey.valueOf()).toString("hex");
    const shard     = getShardOfAddress(pubkeyHex);

    shardCounts[shard]++;

    allWallets.push({
      index: i,
      address,
      secretKeyHex: Buffer.from(secretKey.valueOf()).toString("hex"),
      shard,
    });

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r  Progress: ${i + 1}/${COUNT}  [S0:${shardCounts[0]} S1:${shardCounts[1]} S2:${shardCounts[2]}]`);
    }
  }
  process.stdout.write("\n");

  allWallets.sort((a, b) => a.index - b.index);
  fs.writeFileSync(KEYS_FILE, JSON.stringify(allWallets, null, 2));

  const csvLines = ["index,address,shard", ...allWallets.map((w) => `${w.index},${w.address},${w.shard}`)];
  fs.writeFileSync(CSV_FILE, csvLines.join("\n"));

  printSummary(allWallets);
  buildCrossShardMap(allWallets);
}

function printSummary(wallets: WalletEntry[]) {
  const shardCounts = [0, 0, 0];
  wallets.forEach((w) => shardCounts[w.shard]++);

  console.log(`\n  [createWallets] Complete — Part ${PART}`);
  console.log(`  Total     : ${wallets.length} wallets`);
  console.log(`  Shard 0   : ${shardCounts[0]} wallets`);
  console.log(`  Shard 1   : ${shardCounts[1]} wallets`);
  console.log(`  Shard 2   : ${shardCounts[2]} wallets`);
  console.log(`  Keys file : ${path.basename(KEYS_FILE)}`);
  console.log("\n  ⚠️  keys file contains raw private keys. Do NOT commit.\n");
}

/**
 * Build cross-shard receiver mapping:
 * Each wallet gets receivers from a DIFFERENT shard.
 * Shard 0 → sends to Shard 1 addresses
 * Shard 1 → sends to Shard 2 addresses
 * Shard 2 → sends to Shard 0 addresses
 */
function buildCrossShardMap(wallets: WalletEntry[]) {
  // Group addresses by shard
  const byShard: Map<number, string[]> = new Map();
  for (let s = 0; s < NUM_SHARDS; s++) byShard.set(s, []);
  for (const w of wallets) {
    byShard.get(w.shard)!.push(w.address);
  }

  // Build routing: each shard's target shard
  // 0→1, 1→2, 2→0
  const crossMap: CrossShardMap = {};
  for (const w of wallets) {
    const targetShard = (w.shard + 1) % NUM_SHARDS;
    crossMap[w.address] = byShard.get(targetShard)!;
  }

  const mapFile = path.join(WALLETS_DIR, `crossmap_part${PART}.json`);
  fs.writeFileSync(mapFile, JSON.stringify(crossMap, null, 2));

  console.log(`  Cross-shard map: ${path.basename(mapFile)}`);
  console.log(`  Routing: S0→S1 (${byShard.get(0)!.length} → ${byShard.get(1)!.length})`);
  console.log(`           S1→S2 (${byShard.get(1)!.length} → ${byShard.get(2)!.length})`);
  console.log(`           S2→S0 (${byShard.get(2)!.length} → ${byShard.get(0)!.length})\n`);
}

main().catch((err) => {
  console.error("[createWallets] Error:", err);
  process.exit(1);
});
