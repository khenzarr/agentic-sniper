# Agentic Sniper

A BNB Smart Chain bot that monitors [AgenticMint](https://agenticmint.ai) for supported public free NFT mints, validates candidates, and submits transactions through Binance Agentic Wallet.

It follows the current radar rather than a fixed collection. Each user connects their own Agentic Wallet and claimed Agent ID. Wallet history, daily limits, and pending transactions are isolated by wallet address.

**Windows, macOS, and Linux · Node.js 22.16+ · BSC mainnet (chain ID 56)**

## Features

- Continuous discovery of ERC-721 and ERC-1155 free-mint candidates.
- Verified source and ABI checks, on-chain NFT interface checks, zero-value simulation, and gas estimates.
- Support for selected zero-argument and recipient/quantity mint functions, including payable methods that succeed with zero native value.
- Mandatory BAW previews with simulation, recipient, balance-change, approval, and risk checks.
- Preview, Binance app approval, and automatic execution modes.
- Per-wallet transaction reservations, duplicate prevention, receipt verification, and restart recovery.
- No private-key import, seed phrase storage, or bundled wallet credentials.

Source verification and simulation are filters, not a security audit. Free mints still cost network gas. Some collections require unsupported proofs, signatures, or custom workflows and will be skipped.

## Installation

Install Node.js 22.16+ and the official [Binance Agentic Wallet CLI](https://www.npmjs.com/package/@binance/agentic-wallet). Confirm that `baw --version` works.

```sh
git clone https://github.com/khenzarr/agentic-sniper.git
cd agentic-sniper
npm ci
npm run browser:install
npm test
```

Create your local environment file.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**macOS / Linux:**

```sh
cp .env.example .env
```

Do not overwrite an existing `.env` when updating. Set `ETHERSCAN_API_KEY` to your Etherscan V2 API key. The BSC RPC has a default endpoint and can be overridden through `BSC_RPC_URL`.

Keep API keys, login links, pairing codes, and wallet sessions private. These files are excluded from Git.

## Connect your own wallet

```sh
npm run login
```

Open the returned sign-in link locally and complete the Binance authentication flow. If needed, finish verification with the returned QR code ID:

```sh
npm run login -- --qr QR_CODE_ID
npm run doctor
```

The bot reads the connected wallet address and claimed Agent ID from BAW. There is no fixed username requirement. BAW manages its own local credentials; this bot does not copy sessions between operating systems.

To switch accounts, stop the bot, run `baw auth signout`, and sign in with the other account. If the session expires, repeat the login flow. Each user should use a separate local installation or operating-system account; this is not a shared-server wallet service.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run doctor` | Display the connected identity, mode, execution gate, limits, and state directory. |
| `npm run scan` | Read the current radar without requiring a wallet. |
| `npm run audit` | Check source/ABI, NFT interfaces, zero-value calls, and gas for the connected wallet. Does not create BAW previews. |
| `npm run sniper:once` | Run one discovery and processing cycle. |
| `npm run sniper:watch` | Keep monitoring at the configured interval. |
| `npm run history` | Display this wallet's local transaction records. |
| `npm run reconcile` | Recheck pending transactions without scanning for new candidates. |

The watcher runs in the foreground. Keep the terminal open and the computer awake. Press **Ctrl+C** to stop. It does not install a background service or scheduled task.

## Execution modes

The repository ships with execution disabled and `preview` mode selected.

| `SNIPER_MODE` | Behavior |
| --- | --- |
| `preview` | Produce validated BAW previews. Never call execute. |
| `app` | Execute only previews that explicitly require Binance app confirmation, then wait for the user to approve in the app. |
| `auto` | Execute previews that pass all checks. If Binance requires app confirmation, the transaction still waits for that confirmation. |

### Enable automatic submission

Set the following property in `config.json`:

```json
"executionEnabled": true
```

Set these values in your local `.env`:

```ini
SNIPER_MODE=auto
ENABLE_EXECUTE=YES_I_UNDERSTAND
```

Then run:

```sh
npm run doctor
npm run sniper:watch
```

Confirm that the startup output shows `"mode":"auto"`. Automatic mode can spend BNB on gas. The bot does not bypass Binance's app confirmation, Developer Mode, transaction lock, or session requirements.

To return to preview mode, set `SNIPER_MODE=preview` and restart. Configuration is loaded at startup. The legacy `SNIPER_APP_APPROVAL_REQUESTS` variable is no longer used.

## How candidates are processed

1. Read current free ERC-721/ERC-1155 rows from the radar. Commands displayed by the website are never executed.
2. Verify bytecode and NFT interfaces on BSC.
3. Require verified contract source and ABI from Etherscan. Upgradeable proxies are excluded.
4. Consider `mint`, `publicMint`, `freeMint`, and `claim`.
5. Accept supported zero-argument methods or clearly named recipient/quantity inputs. The recipient is the connected wallet and quantity is one. Token IDs, proofs, and signatures are not guessed.
6. Simulate with **value = 0 wei**, including payable functions. Reverts from paid phases, exhausted supply, or wallet eligibility checks block submission.
7. Require exactly one successful supported method. Multiple successful methods produce `AMBIGUOUS_MINT_METHODS`.
8. Check the gas estimate, wallet balance, BAW simulation, and risk report. Approval changes, authority changes, and risk signals block submission.
9. Require the BAW simulation to show exactly one incoming NFT from the target collection to the connected wallet. Outgoing assets, ERC-20 changes, other recipients, extra changes, and unknown schemas are rejected.
10. Before submission, recheck the wallet identity, simulation, execution opt-in, and preview expiration.

A radar label is not proof of mint eligibility. Unsupported contracts and responses are skipped with a reason.

## Limits and transaction tracking

Default settings in `config.json`:

| Setting | Default |
| --- | --- |
| Daily submission limit | 5 per wallet, using the Europe/Istanbul calendar day |
| Estimated gas budget per transaction | 0.0001 BNB |
| Gas-unit padding | 20% |
| Gas-price padding | 20% |
| Polling interval | 120 seconds; minimum 90 seconds |
| Local preview lifetime | Up to 120 seconds, bounded by BAW expiration |

The gas budget is a conservative **estimate**, not an enforceable ceiling on the eventual network fee through BAW.

Records are stored under `state/56/<wallet>/`. A per-wallet lock prevents overlapping runners in the same installation. Submitted, pending, uncertain, and failed transactions count toward the local daily limit. A recorded submission prevents another attempt on the same collection by that wallet. Preview mode processes all eligible collections rather than stopping at the first preview.

Before execution, a submission reservation is written and synced to disk. Subsequent cycles:

- Associate pending orders with transaction hashes using the exact order ID.
- Wait for three confirmations, then validate the transaction sender, target, calldata, zero native value, and NFT mint event.
- Continue to another collection after a confirmed mint.
- Pause on uncertain submissions rather than retrying blindly.
- Mark transactions without the expected mint event as `NEEDS_REVIEW`.

These limits and duplicate checks are local to an installation. Do not run independent installations against the same wallet expecting a shared global limit.

### Recover an uncertain submission

```sh
npm run history
npm run reconcile
```

If you find the transaction hash in Binance history, attach it to the matching local record:

```sh
node src/hunter.mjs attach --id RECORD_ID --tx 0xTRANSACTION_HASH
npm run reconcile
```

The hash is accepted only after the on-chain transaction matches the reserved mint. If no order ID or hash can be found, inspect the wallet history before taking further action. Do not delete transaction records to force a retry.

After a crash, a lock file may remain. Verify that no other runner is active before removing a stale lock.

Legacy records in the root `state/history.json` are preserved but not automatically imported. Check old transaction history before upgrading an installation that has already submitted mints.

## Reading the output

| Event or status | Meaning |
| --- | --- |
| `RADAR_SCANNED` | A discovery cycle read the current radar. |
| `PREVIEW_READY` | An eligible transaction preview was prepared; this alone does not mean a mint was sent. |
| `SUBMITTED` / `BROADCASTED` | A transaction was submitted; confirmation is still pending. |
| `PENDING_CONFIRMATION` | Approval is required in Binance. |
| `RECEIPT_CHECKED` / `CONFIRMED` | The transaction and expected mint event were verified. |
| `CANDIDATE_SKIPPED` | The candidate failed or needs unsupported handling. |
| `PAUSED_UNRESOLVED_TX` | A previous submission needs reconciliation before another can be sent. |

Source API errors are distinguished from missing verification:

- `API_KEY_INVALID`: Etherscan rejected the supplied key for that request.
- `API_RATE_LIMIT`: The source API reported throttling.
- `SOURCE_UNVERIFIED`: The response did not contain verified source and ABI.
- Transient network/server errors receive bounded retries with backoff.

## Testing

```sh
npm test
```

Tests do not submit real wallet transactions. They cover wallet isolation and switching, preview validation and expiry, gas and balance checks, ambiguous methods, daily limits, uncertain submissions, duplicate prevention, NFT receipts, and continuation after confirmation.

GitHub Actions runs the suite on **Windows, macOS, and Linux with Node.js 22 and 24**. Passing these tests does not establish that every collection is supported or that every platform's live wallet flow has been exercised.

## Data and credentials

The repository contains source code and example configuration. It does not include `.env`, API keys, private keys, pairing data, wallet sessions, or local mint history. Use your own credentials and wallet.
