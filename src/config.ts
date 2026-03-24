// =============================================================
// config.ts — Central configuration for Challenge 3: Crossover
// =============================================================

import { config } from "dotenv";
config();

export const NUM_SHARDS = 3;

/**
 * Compute which shard a bech32 address belongs to.
 *
 * MultiversX uses a BITMASK algorithm, NOT modulo:
 *   shard = lastByte & maskHigh
 *   if shard > numShards - 1: shard = lastByte & maskLow
 *
 * Where:
 *   n = ceil(log2(numShards))
 *   maskHigh = (1 << n) - 1
 *   maskLow  = (1 << (n-1)) - 1
 *
 * For 3 shards: maskHigh=3, maskLow=1
 */
const SHARD_N        = Math.ceil(Math.log2(NUM_SHARDS));
const SHARD_MASK_HI  = (1 << SHARD_N) - 1;       // 3 for 3 shards
const SHARD_MASK_LO  = (1 << (SHARD_N - 1)) - 1;  // 1 for 3 shards

export function getShardOfAddress(pubkeyHex: string): number {
  const lastByte = parseInt(pubkeyHex.slice(-2), 16);
  let shard = lastByte & SHARD_MASK_HI;
  if (shard > NUM_SHARDS - 1) {
    shard = lastByte & SHARD_MASK_LO;
  }
  return shard;
}

export const CONFIG = {
  // ── Network ──────────────────────────────────────────────
  API_URL: "https://api.battleofnodes.com",
  CHAIN_ID: "B",

  // ── Wallets ───────────────────────────────────────────────
  MASTER_SEED: process.env.MASTER_SEED || "",

  WALLETS_DIR:    "./wallets",
  WALLET_COUNT:   500,
  WALLET_PASSWORD: "guildwars2026",

  // ── Team ──────────────────────────────────────────────────
  MEMBER_NAMES: ["EnRich", "CreativeX", "Evangel"],

  // ── Part 1 params ─────────────────────────────────────────
  PART1_EGLD_PER_WALLET: BigInt("4000000000000000000"),      // 4.0 EGLD
  PART1_MIN_TX_VALUE:    BigInt("1"),                         // 1 atom (1e-18)
  PART1_FEE_BUDGET:      2000,                                // 2000 EGLD total

  // ── Part 2 params ─────────────────────────────────────────
  PART2_EGLD_PER_WALLET: BigInt("760000000000000000"),        // 0.76 EGLD (adjusted for 382 EGLD GL budget)
  PART2_MIN_TX_VALUE:    BigInt("10000000000000000"),          // 0.01 EGLD
  PART2_FEE_BUDGET:      382,                                 // 382 EGLD roughly

  // ── Transaction params ────────────────────────────────────
  GAS_LIMIT:  50_000,
  GAS_PRICE:  1_000_000_000,

  // Fee per tx = GAS_LIMIT * GAS_PRICE = 50,000 * 1e9 = 5e13 = 0.00005 EGLD
  FEE_PER_TX: BigInt("50000000000000"),  // 0.00005 EGLD in atoms

  // ── Spray tuning ──────────────────────────────────────────
  BATCH_SIZE:          100,     // maximize batch size so each wallet fires 1 single HTTP request
  CONCURRENT_WALLETS:  500,     // all wallets fire simultaneously
  STAGGER_MS:          5,       // ultra-fast 5ms stagger (all 500 launch in 2.5 seconds)

  // ── Window timing (UTC → maps to local system clock) ──────
  // All times in HH:MM LOCAL (your system auto-converts)
  // Part 1: 16:00–16:30 UTC = 17:00–17:30 CET
  // Part 2: 17:00–17:30 UTC = 18:00–18:30 CET
  PART1_END_UTC: "17:30",   // local CET = UTC+1
  PART2_END_UTC: "18:30",   // local CET
} as const;
