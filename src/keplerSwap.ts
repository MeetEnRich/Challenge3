// =============================================================
// keplerSwap.ts — Get BoN USDC for Kepler Subscription
//
// Wraps EGLD -> WEGLD and swaps WEGLD -> USDC on BoN xExchange.
// Usage: npx ts-node src/keplerSwap.ts --amount 50
// =============================================================

import {
  Account,
  Address,
  ProxyNetworkProvider,
  Transaction,
  TransactionComputer,
  UserSigner,
} from "@multiversx/sdk-core";
import { Mnemonic } from "@multiversx/sdk-wallet";
import { CONFIG } from "./config";

// --- BoN Constants (Standard xExchange testnet/BoN deployment) ---
const WRAPPER_ADDR    = "erd1qqqqqqqqqqqqqpgqvc7gdl0p4s97guh498wgz75k8sav6sjfjlwqh679jy";
const WEGLD_USDC_PAIR = "erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq"; // xExchange WEGLD/USDC Liquidity Pool
const WEGLD_ID        = "WEGLD-bd4d79";
const USDC_ID         = "USDC-c76f1f";

async function main() {
  const args = process.argv.slice(2);
  const amountIdx = args.indexOf("--amount");
  const amountEgld = amountIdx !== -1 ? parseFloat(args[amountIdx + 1]) : 10;

  if (!CONFIG.MASTER_SEED) {
    console.error("❌ ERROR: MASTER_SEED not found in .env");
    process.exit(1);
  }

  const provider = new ProxyNetworkProvider(CONFIG.API_URL, { timeout: 10000 });
  const mnemonic = Mnemonic.fromString(CONFIG.MASTER_SEED);
  const secretKey = mnemonic.deriveKey();
  const signer = new UserSigner(secretKey as any);
  const addressStr = secretKey.generatePublicKey().toAddress().bech32();
  const address = new Address(addressStr);
  const computer = new TransactionComputer();

  console.log(`\n[keplerSwap] Initializing swap for ${amountEgld} EGLD`);
  console.log(`  Wallet: ${addressStr}\n`);

  // 1. Sync account
  const accountOnNetwork = await provider.getAccount(address);
  let currentNonce = BigInt(accountOnNetwork.nonce);

  // Use proper bigint math to avoid float precision loss (JS floats lose precision above 9e15)
  const amountAtoms = BigInt(Math.round(amountEgld)) * 10n ** 18n;

  // --- STEP 1: WRAP EGLD -> WEGLD ---
  console.log(`[Step 1] Wrapping ${amountEgld} EGLD to WEGLD...`);
  const wrapTx = new Transaction({
    nonce:    currentNonce++,
    sender:   address,
    receiver: new Address(WRAPPER_ADDR),
    value:    amountAtoms,
    gasLimit: 10_000_000n,
    chainID:  CONFIG.CHAIN_ID,
    data:     Buffer.from("wrapEgld"),
    version:  1
  });

  const wrapBytes = computer.computeBytesForSigning(wrapTx);
  wrapTx.signature = await signer.sign(wrapBytes);
  const wrapHash = await provider.sendTransaction(wrapTx);
  console.log(`  Wrap TX Sent: https://bon-explorer.multiversx.com/transactions/${wrapHash}`);
  
  console.log("  Waiting for wrap confirmation (15s)...");
  await new Promise(r => setTimeout(r, 15000));

  // --- STEP 2: SWAP WEGLD -> USDC ---
  console.log(`[Step 2] Swapping WEGLD for USDC...`);
  
  const amountHex = amountAtoms.toString(16).length % 2 === 0 
    ? amountAtoms.toString(16) 
    : "0" + amountAtoms.toString(16);
  
  const tokenHex  = Buffer.from(WEGLD_ID).toString("hex");
  const methodHex = Buffer.from("swapTokensFixedInput").toString("hex");
  const targetHex = Buffer.from(USDC_ID).toString("hex");

  // Router call format: ESDTTransfer@TokenID@Amount@Method@TokenID_out@Amount_out_min
  // Min output = 1 unit (0x01) — pair contract rejects 0
  const swapData = `ESDTTransfer@${tokenHex}@${amountHex}@${methodHex}@${targetHex}@01`;

  const swapTx = new Transaction({
    nonce:    currentNonce++,
    sender:   address,
    receiver: new Address(WEGLD_USDC_PAIR),
    value:    0n,
    gasLimit: 50_000_000n,  // proven working gas from successful BoN swap
    chainID:  CONFIG.CHAIN_ID,
    data:     Buffer.from(swapData),
    version:  1
  });

  const swapBytes = computer.computeBytesForSigning(swapTx);
  swapTx.signature = await signer.sign(swapBytes);
  const swapHash = await provider.sendTransaction(swapTx);
  console.log(`  Swap TX Sent: https://bon-explorer.multiversx.com/transactions/${swapHash}`);

  console.log(`\n✅ Done! Check your wallet for USDC soon.`);
  console.log(`Once you have USDC, go buy the Kepler plan at https://bon-kepler.projectx.mx/\n`);
}

main().catch(console.error);
