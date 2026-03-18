# Jup + OKX -> DFlow Migration Guides

This repo is a migration reference for moving swap integrations to DFlow from either Jupiter or OKX.
It contains migration guides and four runnable TypeScript scripts: a Jupiter Ultra swap example, a DFlow imperative swap example, a DFlow declarative swap example, and an OKX-to-DFlow adapter swap example.

## Running the Example Scripts

- Copy env template: `cp .env.example .env`
- Defaults are already set to swap a small amount of `SOL -> USDC`:
  - `INPUT_MINT=So111...` (SOL)
  - `OUTPUT_MINT=EPjF...` (USDC)
  - `INPUT_AMOUNT=100000` (0.0001 SOL)
- Add `SOLANA_PRIVATE_KEY` only if you want to run live swaps.
- In `live` mode, these scripts submit real swaps for that small SOL amount on the selected protocol/mode.
- After successful execution (when a `tx signature` is available), scripts print a Helius Orb explorer link.

To run, use:

```bash
npm run typecheck

npm run jupiter:validate
npm run jupiter:live

npm run dflow:validate
npm run dflow:live

npm run dflow:declarative:validate
npm run dflow:declarative:live

npm run okx:validate
npm run okx:live
```

## Jup -> DFlow

- Guide: [docs/jupiter-to-dflow-conversion-guide.md](docs/jupiter-to-dflow-conversion-guide.md)
- Key difference: Jupiter Ultra executes via Jupiter (`/execute`), while DFlow imperative executes via your RPC and DFlow declarative executes via `/submit-intent`.

## OKX -> DFlow

- Guide: [docs/okx-to-dflow-migration-guide.md](docs/okx-to-dflow-migration-guide.md)
- Key difference: OKX is typically chain-agnostic/provider-specific (`chainId`/`userWalletAddress` patterns), while DFlow is Solana-native (`inputMint`, `outputMint`, `userPublicKey`, `slippageBps`).

