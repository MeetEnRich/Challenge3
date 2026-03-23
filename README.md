# MultiversX · GreenGlitch

## Guild Wars | Challenge #3: Crossover

Cross-shard transaction sprint toolkit. Only transactions crossing shard boundaries count towards scoring.

---

## 🎯 How It Works

- **500 wallets** per part, sharded across 3 shards using MultiversX bitmask algorithm
- **Cross-shard routing**: Shard 0→1, Shard 1→2, Shard 2→0 — 100% cross-shard guarantee
- **Two parts**: Part 1 (volume play, 2000 EGLD budget) and Part 2 (tight budget, 500 EGLD)
- **Live dashboard** at `localhost:3000` with real-time stats

---

## 🚀 Setup

```bash
npm install
```

Add your GL wallet seed to `.env`:
```env
MASTER_SEED="word1 word2 word3 ... word12"
```

---

## 📋 Full Command Sequence

### Pre-Challenge — Part 1 Setup (at 15:45 UTC)

```bash
# 1. Generate 500 shard-aware wallets for Part 1
npm run create-wallets -- --part 1

# 2. Split wallets across 3 team members (shard-balanced)
npm run split -- --part 1

# 3. Fund all 500 wallets from GL wallet (4.0 EGLD each = 2000 EGLD)
npm run distribute -- --part 1

# 4. Start the dashboard (in a separate terminal)
npm run dashboard
```

### Part 1 — START (16:00 UTC)

```bash
# Solo mode (one machine runs all 500 wallets):
npm run solo-p1

# OR team mode (each member on their own machine):
npm run EnRich-p1       # Member 1
npm run CreativeX-p1    # Member 2
npm run Evangel-p1      # Member 3
```

### Break — Part 2 Setup (16:30–17:00 UTC)

```bash
# 5. Generate 500 NEW wallets for Part 2 (fresh, no reuse)
npm run create-wallets -- --part 2

# 6. Split across team members
npm run split -- --part 2

# 7. Fund wallets (1.0 EGLD each = 500 EGLD)
npm run distribute -- --part 2
```

### Part 2 — START (17:00 UTC)

```bash
# Solo mode:
npm run solo-p2

# OR team mode:
npm run EnRich-p2       # Member 1
npm run CreativeX-p2    # Member 2
npm run Evangel-p2      # Member 3
```

### Post-Challenge

```bash
# View final summary
npm run summarize
```

---

## 🧪 Testing Commands

```bash
# Quick test: 5 wallets, 1 minute
npm run test-spray

# Full test with custom duration (minutes)
npx ts-node src/spray.ts --part 1 --duration 2

# Dry run (no real txs)
npx ts-node src/spray.ts --part 1 --dry-run --duration 1

# Distribute with custom amount (for testing)
npm run distribute -- --part 1 --amount 0.05 --count 10
```

---

## 📊 Monitoring

```bash
# Live web dashboard (http://localhost:3000)
npm run dashboard

# Terminal-based stats
npm run monitor -- --watch

# Post-challenge summary
npm run summarize
```

---

## 📁 Project Structure

```
src/
├── config.ts          # Central config, shard bitmask algorithm
├── createWallets.ts   # Shard-aware wallet generation + crossmap
├── split.ts           # Shard-balanced split across team members
├── distribute.ts      # Fund wallets from GL wallet (direct, no intermediaries)
├── spray.ts           # Cross-shard transaction engine
├── dashboard.ts       # Live web dashboard (localhost:3000)
├── monitor.ts         # Terminal-based monitoring
└── summarize.ts       # Post-challenge report
```

---

## ⚠️ Challenge Rules

- **GL wallet must NOT send MoveBalance** — funding only
- **No intermediary wallets** — GL funds each wallet directly
- **Fresh wallets each part** — no reuse between Part 1 and Part 2
- **Part 1 min tx value**: 1 atom (1×10⁻¹⁸ EGLD)
- **Part 2 min tx value**: 0.01 EGLD (budget-limited to ~99 txs/wallet)
- **Only cross-shard txs count** — guaranteed by our bitmask routing

---

## 🔑 Key Numbers

| | Part 1 | Part 2 |
|---|---|---|
| Fee Budget | 2,000 EGLD | 500 EGLD |
| Min Tx Value | 1 atom | 0.01 EGLD |
| Per Wallet | 4.0 EGLD | 1.0 EGLD |
| Wallets | 500 (fresh) | 500 (fresh) |

---

## 🔒 Security

- `.gitignore` blocks `wallets/`, `.env`, `results/`
- **DO NOT** commit private keys
