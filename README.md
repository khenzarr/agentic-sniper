# Agentic Sniper

A BSC bot that monitors [AgenticMint](https://agenticmint.ai) for supported ERC-20 and NFT mints, searches for eligible mint quantities, and submits transactions through Binance Agentic Wallet.

**Windows, macOS, Linux · Node.js 22.16+ · BSC mainnet · Your own Agentic Wallet**

## What it does

- Reads the current radar instead of tracking a fixed collection or username.
- Prioritizes free listings and new collections before topping up earlier ones.
- Searches for the largest simulated quantity within wallet, supply, gas and configured spending limits.
- Handles both quantity-based mint functions and repeated fixed-lot claims.
- Tracks cumulative mint value and gas per wallet and collection across restarts.
- Uses verified Etherscan/Sourcify sources by default, with an optional **degen mode** for inferred mint selectors.
- Requires BAW simulation, incoming-asset checks, risk checks, and fresh pre-submission validation.
- Prevents duplicate execution after timeouts and reconciles receipts before another submission.

This is not a promise to mint every contract or find valuable tokens. Custom proofs, signatures, unsupported selectors, complex proxies, and ERC-20 payment approvals are not automatically handled. Source verification, selector inference, and successful simulation are not security audits.

## Quick start: how to use

### 1. Install the requirements

Install [Node.js 22.16 or newer](https://nodejs.org/) and [Git](https://git-scm.com/downloads). You also need your own Binance Agentic Wallet with a claimed Agent ID and a small BSC BNB balance for gas. Free mints still cost gas.

Open **PowerShell on Windows** or **Terminal on macOS/Linux**, then run these commands one at a time:

```sh
npm install -g @binance/agentic-wallet
git clone https://github.com/khenzarr/agentic-sniper.git
cd agentic-sniper
npm ci
npm run browser:install
```

### 2. Create your settings file

Run the command for your operating system:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

Open `.env` in a text editor. If you have an Etherscan API key, enter it after `ETHERSCAN_API_KEY=`. Without one, the bot can use the keyless Sourcify fallback, but source coverage may be lower. Leave `BSC_RPC_URL` unchanged unless you have your own BSC RPC endpoint.

Never enter a wallet private key or seed phrase into this project. Do not share `.env` or wallet pairing data. When updating an existing installation, keep your existing `.env`.

### 3. Connect your own wallet

```sh
npm run login
```

Follow the displayed Binance sign-in instructions. If the flow specifically asks you to verify a QR code, run `npm run login -- --qr QR_CODE_ID`, replacing `QR_CODE_ID` with the ID shown by the login flow.

Each user connects their own wallet and Agent ID automatically; you do not need to replace a hard-coded username. BAW stores credentials locally. For execution, enable Developer Mode and unlock transactions in your Agentic Wallet using Binance's own controls.

### 4. Choose preview or automatic minting

**The default setup only previews. It does not mint automatically.** To try it without submitting transactions, leave the execution settings unchanged and continue to step 5.

To enable automatic **free mints only**, edit the existing lines in `.env` to:

```ini
SNIPER_MODE=auto
ENABLE_EXECUTE=YES_I_UNDERSTAND
```

Then open `config.json` and change these existing values (keep the rest of the file):

```json
"executionEnabled": true,
"paidEnabled": false,
"degenMode": false
```

Save both files. This enables real transactions and gas spending. Binance app confirmation may still be required by BAW.

Optional settings in `config.json`:

| If you want to… | Change |
| --- | --- |
| Include supported paid mints | Set `paidEnabled` to `true`. The default budget is $5 per wallet and collection, including cumulative mint payments and estimated gas—not $5 per day. Final fees and exchange rates can vary. |
| Try supported mints without verified source code | Set `degenMode` to `true` only if you accept the additional contract risk. |
| Change the daily submission cap | Edit `dailyLimit`; the default is 5. `null` removes this count cap and can spend gas across many collections. |

Max-mint search is already enabled. It searches within the configured limits; unsupported contracts are skipped.

### 5. Check and start

```sh
npm run doctor
npm run sniper:watch
```

Check that `doctor` shows **your wallet**, **your Agent ID**, and the mode you selected before starting the watcher. If it reports a problem, resolve it first.

Keep the terminal open and your computer awake. The bot checks the radar every 120 seconds by default. In `auto` mode it can submit eligible mints that pass its checks; in `preview` mode it only prepares previews.

| Log event | Meaning |
| --- | --- |
| `RADAR_SCANNED` | The listings were checked. |
| `PREVIEW_READY` | A transaction preview is ready; this alone does not mean a mint was submitted. |
| `SUBMITTED` | A transaction was sent. |
| `RECEIPT_CHECKED` with `CONFIRMED` | The transaction and expected mint receipt were verified. |
| `CANDIDATE_SKIPPED` | A listing did not pass the current checks or limits. |

### 6. Stop or restart

Press **Ctrl+C** to stop. After changing settings, stop the watcher and run `npm run sniper:watch` again. Do not run a second watcher alongside the first. Submitted transactions can still complete after stopping.

To see your results:

```sh
npm run history
```

## Switching wallets

Stop the bot before switching accounts. Use `baw auth signout` followed by a new login. Separate users should use separate installations or OS accounts; this is not a shared-server wallet service.

## Commands

| Command | Purpose |
| --- | --- |
| npm run doctor | Show identity, execution mode, and limits. |
| npm run scan | Read the current radar without a wallet. |
| npm run audit | Read-only source/selector checks and quantity/price simulations; no BAW execute. |
| npm run sniper:once | Process one cycle. |
| npm run sniper:watch | Continuously scan and reconcile transactions. |
| npm run sniper:stop | Request a graceful stop for this wallet's watcher. |
| npm run history | Show the connected wallet's records. |
| npm run reconcile | Recheck pending transactions without discovering new mints. |

The normal watcher runs in the foreground. Keep the terminal open and computer awake; Ctrl+C stops it. A separately launched background watcher can be stopped with npm run sniper:stop; if the wallet session has expired, use node src/hunter.mjs stop --wallet YOUR_PUBLIC_ADDRESS. Stop requests are checked locally and prevent starting another wallet execution. An already submitted transaction still needs reconciliation. No scheduled task is installed. A lifetime watch lock prevents a second watcher for the same local wallet.

## Execution modes

The repository ships with execution disabled.

| SNIPER_MODE | Behavior |
| --- | --- |
| preview | Produce previews without executing. |
| app | Execute only previews requiring Binance app confirmation. |
| auto | Execute accepted previews; Binance app confirmation is still required when BAW requests it. |

To enable real execution, set `executionEnabled: true` in config.json and the following in your .env:

```ini
SNIPER_MODE=auto
ENABLE_EXECUTE=YES_I_UNDERSTAND
```

Verify the mode with `npm run doctor`, then start the watcher. Configuration is loaded at startup. Binance confirmation, session expiry, Developer Mode, and transaction locks are not bypassed.

## Max mint: quantity is not the same as token payout

Enable `maxMint: true` in config.json.

- **mint(uint256 qty):** the bot searches for the largest valid argument instead of always sending 1.
- **mint():** there is no quantity argument. One invocation might distribute 3, 6, 10, or another fixed token amount. After a confirmed receipt, max mode checks whether another legitimate invocation is allowed.
- **Per-transaction limits:** a smaller batch can be confirmed, then another batch is considered against the updated wallet state and remaining collection budget.
- **ERC-20 decimals:** raw-amount ceilings account for decimals. The bot tests raw per-unit, whole-token-unit, and flat-call payment models through simulation rather than blindly multiplying a displayed token amount.
- **Multiple mint methods:** max mode validates their BAW previews and prefers the largest simulated incoming gain for the same asset, breaking ties with lower native payment.
- **Pending or uncertain submissions:** no repeat is attempted until the earlier outcome is resolved. Failed or review-required records are not blindly retried.

Logs distinguish the requested `quantity` from `expectedGain` and confirmed `mintedAmount`. The requested quantity can represent lots or raw contract units; it does not by itself establish the human-readable token balance. Confirmed ERC-20 receipts include raw mintedUnits and a decimals-formatted mintedAmount when decimals can be read.

Searches are bounded. maxBatchQuantity defaults to 1000 units, expanded into raw units for ERC-20s. maxMintCallsPerCollection defaults to 100 confirmed/submitted invocations as an additional guard. An unlimited contract has no finite "true maximum"; the bot stops at configured search, call, gas, balance, or budget constraints. The search assumes ordinary monotonic limits; custom non-monotonic mint logic may not yield a mathematical global maximum.

## Optional degen mode

Set `degenMode: true` only if you accept calls without verified source code. It is **false in the repository defaults**.

If verified source/ABI is unavailable or unsupported, degen mode:

1. Reads the deployed runtime bytecode.
2. Extracts PUSH4 selector candidates.
3. Considers only a fixed catalog of mint/freeMint/publicMint/claim/safeMint signatures and supported read-only price getters.
4. Simulates candidate arguments and native values.
5. Requires a valid BAW preview showing gains in the expected asset and no unapproved outgoing assets.
6. Rechecks inferred-source bytecode before submitting.

Selector matches are heuristics, not proof of a function's name, meaning, safety, or economic value. Selector collisions, arbitrary contract behavior and upgrades remain risks. Complex proxy implementations are not automatically followed. Methods requiring unknown proofs, signatures, arbitrary token IDs or unsupported parameters remain skipped.

Inferred records carry `sourceProvider: bytecode-selector`, `sourceVerified: false`, and a bytecode hash. Degen mode does not disable approval, authority-change, risk, recipient or balance-change guards. It does not grant token allowances, execute remote website commands, or change wallet security settings.

## Collection budget and limits

| Setting | Repository default |
| --- | --- |
| dailyLimit | 5 submissions per Istanbul calendar day |
| maxMint | true |
| degenMode | false |
| paidEnabled | true |
| paidMintUsdLimit | $5 per wallet and collection |
| usdSafetyMarginPercent | 10 |
| maxGasWei | 0.0001 BNB estimated gas per transaction |
| maxBatchQuantity | 1000 |
| maxMintCallsPerCollection | 100 |
| intervalSeconds | 120 |
| pendingPollSeconds | 10 |

Set dailyLimit to null only if you deliberately want no daily submission-count cap. This can spend gas across many collections. Other limits still apply.

In max mode, the $5 collection budget covers **cumulative native mint payments plus gas**, including earlier free claims. Existing receipts use actual gas when available; otherwise the earlier padded estimate is reserved. Restarting does not reset the ledger. No additional signatures or transfers are needed to enforce these local checks.

The [Chainlink BNB/USD feed](https://data.chain.link/feeds/bsc/mainnet/bnb-usd) is read directly. Missing, invalid, or older-than-one-hour quotes block max-mode submissions. A fresh quote is fetched before execution. With 10% headroom, the planned collection total must fit within approximately $4.55 at the current quote.

The gas estimate separately pads gas units and gas price by 20%. **These are pre-submission estimates, not an enforceable final USD ceiling through BAW.** Final gas and exchange rates can change, especially while waiting for app approval.

Only native BNB payments are supported. No ERC-20 spending approvals are requested. Supported inferred/verified price getter names include price, mintPrice, MINT_PRICE, mintCost, cost, publicMintPrice and PRICE; ambiguous nonzero results are rejected.

## Transaction safety and recovery

Records are stored under `state/56/<wallet>/`. Before a wallet call, a submission reservation is synced to disk. The bot associates pending orders by exact order ID, waits for three confirmations, checks sender/target/calldata/native value, and validates mint events. NFT totals must match the planned or simulated fixed-lot amount.

Only the exact planned native payment may leave the wallet. Other outgoing assets, allowances, authority changes, risk signals, and unexpected recipients block submission.

```sh
npm run history
npm run reconcile
node src/hunter.mjs attach --id RECORD_ID --tx 0xTRANSACTION_HASH
```

A manually attached hash must match the reserved on-chain transaction. Do not delete records to retry unknown outcomes. A review-required transaction pauses automatic submissions. If a crash leaves execute.lock or watch.lock behind, verify the recorded process is no longer running before removing the stale lock.

Legacy records in root state/history.json are preserved but not imported automatically. Check them before upgrading. Limits are local to an installation; independent installations do not share a global wallet budget.

## Source provider reliability

Etherscan is primary; Sourcify provides keyless exact-match fallback. In verified-only mode, Sourcify must supply matching BSC identity, exact runtime match, source, ABI and explicit non-proxy status. A proxy or invalid ABI reported by Etherscan cannot bypass that verified-only policy. Degen mode explicitly uses a separate unverified-bytecode path instead.

- API_KEY_INVALID: Etherscan rejected the key for that request.
- API_IP_THROTTLED: Etherscan reported excessive invalid-key attempts from the source IP. Requests pause for at least 35 seconds.
- API_RATE_LIMIT: request throttling.
- SOURCE_UNVERIFIED: verified source/ABI was not supplied.
- NO_RECOGNIZED_MINT_SELECTOR: degen mode could not infer a supported selector.

Etherscan requests are serialized with at least 1.2 seconds between requests. Network/server errors have bounded retries. The Etherscan key is never forwarded to Sourcify. Source absence is not proof of fraud; source presence is not proof of safety.

## Testing and credentials

```sh
npm test
```

Tests do not submit real transactions. GitHub Actions runs Windows, macOS and Linux with Node 22/24. Tests cover inferred selectors, max quantities, raw token units, fixed lots, flat/scaled pricing, cumulative budgets, receipts, uncertain submissions, wallet isolation, and source-provider failures.

.env, API keys, wallet sessions, pairing data, local history and runtime logs are not committed. Use your own wallet and credentials.
