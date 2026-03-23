// =============================================================
// distribute.ts — Fund wallets directly from GL wallet
//
// CRITICAL RULES:
//   - GL wallet funds each sending wallet DIRECTLY (no intermediaries)
//   - GL wallet must NOT send MoveBalance itself
//   - Part 1: ~4.0 EGLD per wallet (2000 EGLD budget)
//   - Part 2: ~1.0 EGLD per wallet (500 EGLD budget)
//
// Usage:
//   npm run distribute -- --part 1
//   npm run distribute -- --part 2
//   npm run distribute -- --part 1 --dry-run
//   npm run distribute -- --part 1 --count 10
// =============================================================

import {
  Account,
  Address,
  Transaction,
  ApiNetworkProvider,
} from "@multiversx/sdk-core";
import * as fs   from "fs";
import * as path from "path";
import { CONFIG } from "./config";

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes("--dry-run");
const partArg   = args.indexOf("--part");
const PART      = partArg !== -1 ? parseInt(args[partArg + 1]) : 1;
const countArg  = args.indexOf("--count");
const COUNT     = countArg !== -1 ? parseInt(args[countArg + 1]) : CONFIG.WALLET_COUNT;
const amountArg = args.indexOf("--amount");

// --amount overrides the default per-wallet amount (in EGLD, e.g. --amount 0.05)
const DEFAULT_PER_WALLET = PART === 2 ? CONFIG.PART2_EGLD_PER_WALLET : CONFIG.PART1_EGLD_PER_WALLET;
const EGLD_PER_WALLET = amountArg !== -1
  ? BigInt(Math.round(parseFloat(args[amountArg + 1]) * 1e18))
  : DEFAULT_PER_WALLET;
const KEYS_FILE = path.join(CONFIG.WALLETS_DIR, `keys_part${PART}.json`);

interface WalletEntry {
  index:        number;
  address:      string;
  secretKeyHex: string;
  shard:        number;
}

async function main() {
  console.log(`\n[distribute] Challenge 3: Crossover — Part ${PART}`);
  console.log(DRY_RUN ? "  Mode: DRY RUN (no txs sent)" : "  Mode: LIVE");
  console.log(`  Budget: ${PART === 1 ? "2,000" : "500"} EGLD\n`);

  const seed      = process.env.MASTER_SEED || CONFIG.MASTER_SEED;
  const wordCount = seed ? seed.trim().split(/\s+/).length : 0;
  if (!seed || (wordCount !== 12 && wordCount !== 24)) {
    console.error("[distribute] ERROR: Invalid MASTER_SEED in .env");
    process.exit(1);
  }
  const master = Account.newFromMnemonic(seed.trim(), 0);

  console.log(`  GL wallet  : ${master.address.toBech32()}`);

  if (!fs.existsSync(KEYS_FILE)) {
    console.error(`[distribute] ERROR: ${KEYS_FILE} not found. Run createWallets.ts --part ${PART} first.`);
    process.exit(1);
  }

  const allWallets: WalletEntry[] = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  const targets = allWallets.slice(0, COUNT);

  const totalNeeded = EGLD_PER_WALLET * BigInt(targets.length);
  console.log(`  Funding    : ${targets.length} wallets`);
  console.log(`  Per wallet : ${formatEgld(EGLD_PER_WALLET)} EGLD`);
  console.log(`  Total      : ${formatEgld(totalNeeded)} EGLD\n`);

  if (DRY_RUN) {
    console.log("  Dry run complete — no txs sent.\n");
    return;
  }

  const provider      = new ApiNetworkProvider(CONFIG.API_URL, { clientName: "guildwars-dist" });
  const networkConfig = await provider.getNetworkConfig();
  const networkAcct   = await provider.getAccount(master.address);
  master.nonce        = BigInt(networkAcct.nonce);

  console.log(`  Network  : ${CONFIG.API_URL}`);
  console.log(`  Chain    : ${networkConfig.chainID}`);
  console.log(`  Balance  : ${formatEgld(BigInt(networkAcct.balance.toString()))} EGLD`);
  console.log(`  Nonce    : ${master.nonce}\n`);

  // Pre-sign all transactions
  console.log("  Signing transactions...");
  const txs: Transaction[] = [];

  for (const w of targets) {
    const tx = new Transaction({
      sender:   master.address,
      receiver: Address.newFromBech32(w.address),
      value:    EGLD_PER_WALLET,
      gasLimit: BigInt(CONFIG.GAS_LIMIT),
      gasPrice: BigInt(CONFIG.GAS_PRICE),
      chainID:  networkConfig.chainID,
      nonce:    master.getNonceThenIncrement(),
      data:     new Uint8Array(0),
    });
    tx.signature = await master.signTransaction(tx);
    txs.push(tx);
  }
  console.log(`  Signed ${txs.length} transactions`);

  // Send in batches
  const BATCH = 100; // gateway limit per call
  let sent = 0;
  const startTime = Date.now();

  console.log(`  Sending in batches of ${BATCH}...\n`);

  for (let i = 0; i < txs.length; i += BATCH) {
    const batch = txs.slice(i, i + BATCH);
    try {
      await provider.sendTransactions(batch);
      sent += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate    = (sent / ((Date.now() - startTime) / 1000)).toFixed(0);
      process.stdout.write(`\r  Sent: ${sent}/${txs.length}  |  ${elapsed}s  |  ${rate} tx/s   `);
    } catch (err) {
      console.error(`\n  ERROR batch ${i}-${Math.min(i + BATCH, txs.length)}:`, err);
    }
    if (i + BATCH < txs.length) await sleep(500);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n  Done in ${elapsed}s`);

  fs.mkdirSync("./results", { recursive: true });
  fs.writeFileSync(
    `./results/distribution_part${PART}_log.json`,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      part: PART,
      sent,
      egldPerWallet: formatEgld(EGLD_PER_WALLET),
      wallets: targets.map((w) => w.address),
    }, null, 2)
  );
  console.log(`  Log: results/distribution_part${PART}_log.json\n`);
}

function formatEgld(atoms: bigint): string {
  return (Number(atoms) / 1e18).toFixed(6);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[distribute] Fatal:", err);
  process.exit(1);
});
