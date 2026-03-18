# OKX -> DFlow Migration Guide

This guide describes how to migrate swap code from OKX-style quote/swap integrations to DFlow.

## Related Files

- OKX-shaped adapter swap: `src/04-okx-swap.ts`
- DFlow imperative swap: `src/02-dflow-imperative-swap.ts`
- DFlow declarative swap: `src/03-dflow-declarative-swap.ts`

## TL; DR Flows

### OKX-style source flow

1. Request quote/route using OKX fields like `fromTokenAddress`, `toTokenAddress`, `amount`, `userWalletAddress`, and the Solana chain selector.
2. Build and sign the returned swap payload.
3. Execute and track status using provider-specific `swap`/`execute`/history endpoints.

### DFlow [Imperative Trade](https://pond.dflow.net/learn/imperative-trades)

1. `GET /order` with `inputMint`, `outputMint`, `amount`, `userPublicKey`, and `slippageBps`.
2. Deserialize and sign the returned `transaction` locally.
3. Broadcast and confirm via your own `Solana RPC` (`sendRawTransaction` + confirm).

### DFlow [Declarative Trade](https://pond.dflow.net/learn/declarative-trades)

1. `GET /intent` with `inputMint`, `outputMint`, `amount`, `userPublicKey`, and `slippageBps`.
2. Deserialize and sign the returned `openTransaction` locally.
3. `POST /submit-intent` with `quoteResponse` + `signedOpenTransaction`, then track order lifecycle.

## Code Migration

## Parameter mapping

### `getOrder` inputs

| Concept         | OKX-style source         | DFlow Imperative         | DFlow Declarative        |
| --------------- | ------------------------ | ------------------------ | ------------------------ |
| Input token     | `fromTokenAddress`       | `inputMint`              | `inputMint`              |
| Output token    | `toTokenAddress`         | `outputMint`             | `outputMint`             |
| Amount          | `amount`                 | `amount`                 | `amount`                 |
| User key field  | `userWalletAddress`      | `userPublicKey`          | `userPublicKey`          |
| Slippage field  | `slippage`               | `slippageBps`            | `slippageBps`            |
| Chain selectors | `chainId` / `chainIndex` | `none` (Solana-only API) | `none` (Solana-only API) |

### `executeOrder` inputs

| Concept                      | OKX-style source                    | DFlow Imperative    | DFlow Declarative                               |
| ---------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------- |
| Signed payload field         | provider-specific tx payload        | `signedTransaction` | `signedOpenTransaction`                         |
| Additional correlation field | provider request/trace id           | `none`              | `quoteResponse`/`intent` context in submit body |
| Execute target               | provider `swap`/`execute` endpoints | `Solana RPC`        | `DFlow API`                                     |

## OKX -> DFlow imperative trades

1. Keep your existing flow shape: `getOrder` -> sign -> `executeOrder`.
2. In `getOrder`, replace OKX quote/swap calls with DFlow `GET /order`.
3. Replace fields: `fromTokenAddress` -> `inputMint`, `toTokenAddress` -> `outputMint`, `userWalletAddress` -> `userPublicKey`, `slippage` -> `slippageBps`.
4. Keep signing with `VersionedTransaction`, because `/order` returns `transaction`.
5. Replace provider execute/status calls with `sendRawTransaction` + `confirmTransaction` on your RPC.
6. Replace provider request-id polling with signature-based confirm/retry handling.

## OKX -> DFlow declarative trades

1. Keep your existing flow shape: `getOrder` -> sign -> `executeOrder`.
2. In `getOrder`, replace OKX quote/swap calls with DFlow `GET /intent`.
3. Replace fields: `fromTokenAddress` -> `inputMint`, `toTokenAddress` -> `outputMint`, `userWalletAddress` -> `userPublicKey`, `slippage` -> `slippageBps`.
4. Update signing logic to use `openTransaction` from `/intent` (`Transaction.from(...)`).
5. Replace provider execute/status calls with `POST /submit-intent` using `quoteResponse` + `signedOpenTransaction`.
6. Replace provider request-id polling with order-metadata tracking (`orderAddress`, `programId`) and lifecycle follow-up.

## Common migration mistakes

- Keeping `chainId`/`chainIndex` in request builders after moving to DFlow Solana APIs.
- Forgetting to convert `slippage` semantics to `slippageBps`.
- Mixing decimal token amounts with atomic units.
