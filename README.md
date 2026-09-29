# Jup + OKX -> DFlow Migration Guides

This repo is a migration reference for moving swap integrations to DFlow from either Jupiter or OKX.
It contains migration guides and four runnable TypeScript scripts: a Jupiter Ultra swap example, a Jupiter Swap API V2 swap example, a DFlow swap example, and an OKX-to-DFlow adapter swap example.

`src/02-dflow-swap.ts` defaults to DFlow's v1 transaction format (via `@solana/kit`, required since
classic `@solana/web3.js` can't sign or send v1 transactions). It also includes `getOrderV0`/
`executeOrderV0`, a classic-web3.js reference implementation that is never called — see the file's
top comment for details.

## Running the Example Scripts

- Copy env template: `cp .env.example .env`
- Defaults are already set to swap a small amount of `USDC -> SOL` (avoids new-token-account rent
  since SOL is the output):
  - `INPUT_MINT=EPjF...` (USDC)
  - `OUTPUT_MINT=So111...` (SOL)
  - `INPUT_AMOUNT=100000` (0.1 USDC, ~$0.10)
- Add `SOLANA_PRIVATE_KEY` only if you want to run live swaps.
- In `live` mode, these scripts submit real swaps for that small amount on the selected protocol/mode.
- After successful execution (when a `tx signature` is available), scripts print an explorer link (`EXPLORER_URL`, defaults to Helius Orb).

To run, use:

```bash
npm run typecheck

npm run jupiter:validate
npm run jupiter:live

npm run jupiter:v2:validate
npm run jupiter:v2:live

npm run dflow:validate
npm run dflow:live

npm run okx:validate
npm run okx:live
```

## Jup -> DFlow

- Guide: [docs/jupiter-to-dflow-conversion-guide.md](docs/jupiter-to-dflow-conversion-guide.md)
- Jupiter has two APIs here: Ultra (`src/01-jupiter-swap.ts`, no longer actively maintained) and
  Swap API V2 (`src/03-jupiter-swap-v2.ts`, current recommended path). `JUPITER_API_KEY` is
  optional for both — it raises the rate limit, neither API requires it.
- Key difference: Jupiter (either API) executes via Jupiter (`/execute`), while DFlow executes via your RPC.

## OKX -> DFlow

- Guide: [docs/okx-to-dflow-migration-guide.md](docs/okx-to-dflow-migration-guide.md)
- Key difference: OKX is typically chain-agnostic/provider-specific (`chainIndex`/`userWalletAddress` patterns), while DFlow is Solana-native (`inputMint`, `outputMint`, `userPublicKey`).

