// =============================================================
// spray.ts — Cross-shard transaction engine for Challenge 3
//
// Key differences from Challenge 1:
//   - Every tx MUST be cross-shard (sender shard ≠ receiver shard)
//   - Part 1: min value = 1 atom, Part 2: min value = 0.01 EGLD
//   - Fee budget tracking per wallet
//   - Cross-shard receiver map loaded at startup
//
// Usage:
//   npm run spray -- --part 1 --keys-file wallets/keys_part1_EnRich.json
//   npm run spray -- --part 2 --keys-file wallets/keys_part2_EnRich.json
//   npm run spray -- --part 1 --dry-run --duration 1
//   npm run spray -- --part 1 --count 5 --duration 1
// =============================================================

import {
  Address,
  Transaction,
  ApiNetworkProvider,
  UserSecretKey,
  TransactionComputer,
} from "@multiversx/sdk-core";
import * as fs   from "fs";
import * as path from "path";
import { CONFIG, NUM_SHARDS, getShardOfAddress } from "./config";

// ── CLI args ───────────────────────────────────────────────
const args          = process.argv.slice(2);
const DRY_RUN       = args.includes("--dry-run");
const partArg       = args.indexOf("--part");
const PART          = partArg !== -1 ? parseInt(args[partArg + 1]) : 1;
const durationArg   = args.indexOf("--duration");
const DURATION_MIN  = durationArg !== -1 ? parseFloat(args[durationArg + 1]) : null;
const countArg      = args.indexOf("--count");
const WALLET_LIMIT  = countArg !== -1 ? parseInt(args[countArg + 1]) : null;
const keysFileArg   = args.indexOf("--keys-file");
const KEYS_FILE_ARG = keysFileArg !== -1 ? path.resolve(args[keysFileArg + 1]) : null;

// ── Part-specific params ───────────────────────────────────
const MIN_TX_VALUE = PART === 2 ? CONFIG.PART2_MIN_TX_VALUE : CONFIG.PART1_MIN_TX_VALUE;
const COST_PER_TX  = MIN_TX_VALUE + CONFIG.FEE_PER_TX; // value + fee in atoms

// ── End time computation ───────────────────────────────────
function computeEndTime(): number {
  if (DURATION_MIN !== null) return Date.now() + DURATION_MIN * 60 * 1000;
  return parseLocalTime(PART === 2 ? CONFIG.PART2_END_UTC : CONFIG.PART1_END_UTC);
}

// ── File paths ─────────────────────────────────────────────
const KEYS_FILE   = KEYS_FILE_ARG ?? path.join(CONFIG.WALLETS_DIR, `keys_part${PART}.json`);
const CROSSMAP    = path.join(CONFIG.WALLETS_DIR, `crossmap_part${PART}.json`);
const RESULTS_DIR = "./results";
const LOG_FILE    = path.join(
  RESULTS_DIR,
  `spray_part${PART}_log${KEYS_FILE_ARG ? "_" + path.basename(KEYS_FILE_ARG, ".json") : ""}.json`
);

// ── Shared stats ───────────────────────────────────────────
interface WalletStats {
  address:        string;
  shard:          number;
  txSent:         number;
  txSuccess:      number;
  txFailed:       number;
  feesSpent:      bigint;
  errors:         string[];
}
const stats              = new Map<string, WalletStats>();
let globalTxSent         = 0; // total attempts (success + failed)
let globalTxSuccess      = 0; // accepted by mempool
let globalTxFailed       = 0; // rejected / errored
let globalCrossShardTx   = 0; // the scoring metric
let globalFeesSpent      = BigInt(0);
let startTime            = 0;
let dryWalletsSkipped    = 0;

interface WalletEntry {
  index:        number;
  address:      string;
  secretKeyHex: string;
  shard:        number;
}

type CrossShardMap = { [addr: string]: string[] };

const txComputer = new TransactionComputer();

async function main() {
  const endTime    = computeEndTime();
  const endTimeStr = new Date(endTime).toLocaleTimeString();
  const durationMin = ((endTime - Date.now()) / 60000).toFixed(1);

  console.log("\n[spray] Challenge 3: Crossover — Cross-Shard Spray");
  console.log(`  Part          : ${PART}`);
  console.log(`  Min tx value  : ${PART === 2 ? "0.01 EGLD" : "1 atom (1e-18)"}`);
  console.log(`  Cost per tx   : ${formatEgld(COST_PER_TX)} EGLD`);
  if (DURATION_MIN !== null) {
    console.log(`  Duration      : ${DURATION_MIN} min → stops at ${endTimeStr}`);
  } else {
    console.log(`  Window ends   : ${endTimeStr}`);
  }
  console.log(`  Time remaining: ${durationMin} min`);
  console.log(DRY_RUN ? "  Mode          : DRY RUN" : "  Mode          : LIVE");

  if (!fs.existsSync(KEYS_FILE)) {
    console.error(`[spray] ERROR: ${KEYS_FILE} not found.`);
    process.exit(1);
  }

  // Load wallets
  const allWallets: WalletEntry[] = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  const wallets = WALLET_LIMIT ? allWallets.slice(0, WALLET_LIMIT) : allWallets;
  console.log(`  Wallets       : ${wallets.length}${WALLET_LIMIT ? ` (limited)` : ""}`);

  // Load or build cross-shard map
  let crossMap: CrossShardMap;
  if (fs.existsSync(CROSSMAP)) {
    crossMap = JSON.parse(fs.readFileSync(CROSSMAP, "utf8"));
  } else {
    console.log("  Building cross-shard map inline...");
    crossMap = buildCrossMapInline(wallets);
  }

  // Verify cross-shard coverage
  let coveredWallets = 0;
  for (const w of wallets) {
    if (crossMap[w.address] && crossMap[w.address].length > 0) coveredWallets++;
  }
  console.log(`  Cross-shard receivers: ${coveredWallets}/${wallets.length} wallets covered`);

  const provider = new ApiNetworkProvider(CONFIG.API_URL, {
    clientName: "guildwars-spray",
    timeout: 15000,
  });
  const networkConfig = await provider.getNetworkConfig();
  const chainID       = networkConfig.chainID;
  console.log(`  Network       : ${CONFIG.API_URL}  |  Chain: ${chainID}\n`);

  // ── Fetch nonces in parallel ─────────────────────────────
  console.log("  Fetching nonces...");
  const nonceMap    = new Map<string, bigint>();
  const balanceMap  = new Map<string, bigint>();
  const NONCE_BATCH = 100;

  for (let i = 0; i < wallets.length; i += NONCE_BATCH) {
    const batch = wallets.slice(i, i + NONCE_BATCH);
    await Promise.all(
      batch.map(async (w) => {
        try {
          const acct = await provider.getAccount(Address.newFromBech32(w.address));
          nonceMap.set(w.address, BigInt(acct.nonce));
          balanceMap.set(w.address, BigInt(acct.balance.toString()));
        } catch {
          nonceMap.set(w.address, 0n);
          balanceMap.set(w.address, 0n);
        }
      })
    );
    process.stdout.write(`\r  Nonces: ${Math.min(i + NONCE_BATCH, wallets.length)}/${wallets.length}   `);
  }
  process.stdout.write("\n");

  // ── Filter out dry wallets (0 balance) ───────────────────
  const liveWallets = wallets.filter((w) => {
    const bal = balanceMap.get(w.address) ?? 0n;
    if (bal < COST_PER_TX) {
      dryWalletsSkipped++;
      return false;
    }
    return true;
  });
  if (dryWalletsSkipped > 0) {
    console.log(`  Dry wallets   : ${dryWalletsSkipped} skipped (0 or insufficient balance)`);
  }
  console.log(`  Live wallets  : ${liveWallets.length}/${wallets.length}`);

  // ── Check window ─────────────────────────────────────────
  const msRemaining = endTime - Date.now();
  if (msRemaining <= 0) {
    console.error("[spray] ERROR: Window already ended!");
    process.exit(1);
  }

  // Compute max txs per wallet for Part 2
  if (PART === 2) {
    const maxPerWallet = Math.floor(Number(CONFIG.PART2_EGLD_PER_WALLET) / Number(COST_PER_TX));
    console.log(`\n  Part 2 cap    : ~${maxPerWallet} txs/wallet (budget-limited)`);
  }

  console.log(`\n  Window closes in : ${(msRemaining / 60000).toFixed(1)} min`);
  console.log(`  Batch size       : ${CONFIG.BATCH_SIZE} txs/wallet/round`);
  console.log("\n  Starting cross-shard spray...\n");

  startTime = Date.now();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // ── Launch all LIVE wallets with stagger ─────────────────
  const coroutines = liveWallets.map((w, i) =>
    sleep(i * CONFIG.STAGGER_MS).then(() =>
      walletLoop(
        w,
        nonceMap.get(w.address) ?? 0n,
        balanceMap.get(w.address) ?? 0n,
        crossMap[w.address] || [],
        provider,
        chainID,
        endTime
      )
    )
  );

  // Progress line every 5s
  const logger = setInterval(() => {
    const elapsed  = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate     = globalTxSuccess > 0 ? (globalTxSuccess / ((Date.now() - startTime) / 1000)).toFixed(0) : "0";
    const timeLeft = Math.max(0, (endTime - Date.now()) / 1000).toFixed(0);
    const feesEgld = formatEgld(globalFeesSpent);
    console.log(
      `  Sent: ${globalTxSent.toLocaleString().padStart(9)}  |  ` +
      `OK: ${globalTxSuccess.toLocaleString().padStart(8)}  |  ` +
      `Fail: ${globalTxFailed.toLocaleString().padStart(6)}  |  ` +
      `${rate.padStart(5)} tx/s  |  ` +
      `Budget: ${feesEgld} EGLD  |  ` +
      `${elapsed}s elapsed  |  ${timeLeft}s left`
    );
    saveLog();
  }, 5000);

  await Promise.allSettled(coroutines);
  clearInterval(logger);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  saveLog();

  console.log(`\n\n[spray] Complete — Part ${PART}`);
  console.log(`  Total sent      : ${globalTxSent.toLocaleString()}`);
  console.log(`  Accepted (OK)   : ${globalTxSuccess.toLocaleString()}`);
  console.log(`  Failed          : ${globalTxFailed.toLocaleString()}`);
  console.log(`  Cross-shard     : ${globalCrossShardTx.toLocaleString()}`);
  console.log(`  Budget used     : ${formatEgld(globalFeesSpent)} EGLD`);
  console.log(`  Dry skipped     : ${dryWalletsSkipped} wallets`);
  console.log(`  Time elapsed    : ${elapsed}s`);
  console.log(`  Log             : ${LOG_FILE}\n`);
}

// ── Per-wallet spray loop ──────────────────────────────────
async function walletLoop(
  wallet:     WalletEntry,
  initNonce:  bigint,
  initBalance: bigint,
  receivers:  string[],
  provider:   ApiNetworkProvider,
  chainID:    string,
  endTime:    number
) {
  if (receivers.length === 0) {
    console.error(`  [wallet ${wallet.index}] No cross-shard receivers! Skipping.`);
    return;
  }

  const wStats: WalletStats = {
    address: wallet.address, shard: wallet.shard,
    txSent: 0, txSuccess: 0, txFailed: 0,
    feesSpent: BigInt(0), errors: [],
  };
  stats.set(wallet.address, wStats);

  const secretKey = new UserSecretKey(Buffer.from(wallet.secretKeyHex, "hex"));
  const publicKey = secretKey.generatePublicKey();
  const sender    = publicKey.toAddress("erd");
  let   nonce     = initNonce;
  let   balance   = initBalance;
  let   receiverIdx = 0;

  // Part 2: compute max txs based on budget
  const maxTxs = PART === 2
    ? Math.floor(Number(balance) / Number(COST_PER_TX))
    : Infinity;
  let walletTxCount = 0;

  while (Date.now() < endTime) {
    // Budget check
    if (PART === 2 && walletTxCount >= maxTxs) break;
    if (balance < COST_PER_TX) break;

    const batchSize = PART === 2
      ? Math.min(CONFIG.BATCH_SIZE, maxTxs - walletTxCount)
      : CONFIG.BATCH_SIZE;

    const batch: Transaction[] = [];

    for (let i = 0; i < batchSize; i++) {
      if (Date.now() >= endTime) break;
      if (PART === 2 && walletTxCount + batch.length >= maxTxs) break;
      if (balance < COST_PER_TX * BigInt(batch.length + 1)) break;

      // Round-robin through cross-shard receivers
      const receiverAddr = receivers[receiverIdx % receivers.length];
      receiverIdx++;

      const tx = new Transaction({
        sender,
        receiver: Address.newFromBech32(receiverAddr),
        value:    MIN_TX_VALUE,
        gasLimit: BigInt(CONFIG.GAS_LIMIT),
        gasPrice: BigInt(CONFIG.GAS_PRICE),
        chainID,
        nonce:    nonce++,
        data:     new Uint8Array(0),
      });

      // Synchronous signing
      tx.signature = secretKey.sign(txComputer.computeBytesForSigning(tx));
      batch.push(tx);

      // Yield to event loop periodically
      if (i > 0 && i % 10 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    if (batch.length === 0) break;

    if (DRY_RUN) {
      const batchFees = COST_PER_TX * BigInt(batch.length);
      wStats.txSent        += batch.length;
      wStats.txSuccess     += batch.length;
      wStats.feesSpent     += batchFees;
      globalTxSent         += batch.length;
      globalTxSuccess      += batch.length;
      globalCrossShardTx   += batch.length;
      globalFeesSpent      += batchFees;
      balance              -= batchFees;
      walletTxCount        += batch.length;
      continue;
    }


    try {
      await provider.sendTransactions(batch);
      const batchFees = COST_PER_TX * BigInt(batch.length);
      wStats.txSent        += batch.length;
      wStats.txSuccess     += batch.length;
      wStats.feesSpent     += batchFees;
      globalTxSent         += batch.length;
      globalTxSuccess      += batch.length;
      globalCrossShardTx   += batch.length; // ALL our txs are cross-shard by design
      globalFeesSpent      += batchFees;
      balance              -= batchFees;
      walletTxCount        += batch.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (wStats.errors.length < 5) wStats.errors.push(msg.slice(0, 120));

      // Count failed txs in both per-wallet and global counters
      wStats.txSent   += batch.length;
      wStats.txFailed += batch.length;
      globalTxSent    += batch.length;
      globalTxFailed  += batch.length;

      if (msg.includes("500") || msg.includes("Internal Server") || msg.includes("429")) {
        nonce -= BigInt(batch.length);
        await sleep(200);
      } else if (msg.toLowerCase().includes("nonce")) {
        try {
          const netAcct = await provider.getAccount(sender);
          nonce   = BigInt(netAcct.nonce);
          balance = BigInt(netAcct.balance.toString());
        } catch { /* ignore */ }
      } else {
        nonce -= BigInt(batch.length);
        await sleep(50);
      }
    }
  }
}

// ── Build cross-shard map inline (fallback) ────────────────
function buildCrossMapInline(wallets: WalletEntry[]): CrossShardMap {
  const byShard: Map<number, string[]> = new Map();
  for (let s = 0; s < NUM_SHARDS; s++) byShard.set(s, []);
  for (const w of wallets) byShard.get(w.shard)!.push(w.address);

  const crossMap: CrossShardMap = {};
  for (const w of wallets) {
    const targetShard = (w.shard + 1) % NUM_SHARDS;
    crossMap[w.address] = byShard.get(targetShard)!;
  }
  return crossMap;
}

// ── Helpers ────────────────────────────────────────────────
function parseLocalTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const now    = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  if (target.getTime() < Date.now() - 60_000) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function formatEgld(atoms: bigint): string {
  return (Number(atoms) / 1e18).toFixed(6);
}

function saveLog() {
  const log = {
    timestamp:         new Date().toISOString(),
    part:              PART,
    globalTxSent,
    globalTxSuccess,
    globalTxFailed,
    globalCrossShardTx,
    globalFeesSpent:   globalFeesSpent.toString(),
    feesSpentEgld:     formatEgld(globalFeesSpent),
    elapsedSeconds:    ((Date.now() - startTime) / 1000).toFixed(1),
    dryWalletsSkipped,
    wallets:           Array.from(stats.values()).map((w) => ({
      ...w,
      feesSpent: w.feesSpent.toString(),
    })),
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => {
  console.error("[spray] Fatal:", err);
  process.exit(1);
});
