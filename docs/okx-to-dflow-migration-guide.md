# OKX -> DFlow Migration Guide

This guide describes how to migrate swap code from OKX-style quote/swap integrations to DFlow.
Field names here match OKX's current DEX Aggregator API (v6).

## Related Files

- OKX-shaped adapter swap: `src/04-okx-swap.ts`
- DFlow swap: `src/02-dflow-swap.ts`

## TL; DR Flows

### OKX-style source flow

1. Request quote/route using OKX fields like `fromTokenAddress`, `toTokenAddress`, `amount`, `userWalletAddress`, and `chainIndex`.
2. Build and sign the returned swap payload.
3. Execute and track status using provider-specific `swap`/`execute`/history endpoints.

### DFlow

1. `GET /order` with `inputMint`, `outputMint`, `amount`, and `userPublicKey`. `slippageBps` is
   optional and defaults to `"auto"` — DFlow determines slippage tolerance itself unless you pass
   an explicit integer (basis points) to take manual control.
2. Deserialize and sign the returned `transaction` locally (`@solana/web3.js` for v0, what you get
   if `transactionVersion` is omitted; `@solana/kit` if you pass `transactionVersion=v1`).
3. Broadcast it via your own Solana RPC and poll for confirmation yourself.

## Code Migration

## Parameter mapping

### Requesting a quote

| Concept         | OKX-style source         | DFlow                    |
| --------------- | ------------------------ | ------------------------ |
| Input token     | `fromTokenAddress`       | `inputMint`              |
| Output token    | `toTokenAddress`         | `outputMint`             |
| Amount          | `amount`                 | `amount`                 |
| Swapper wallet field | `userWalletAddress`  | `userPublicKey`          |
| Slippage field  | `slippagePercent`        | `slippageBps`            |
| Chain selector  | `chainIndex`             | `none` (Solana-only API) |

`slippageBps` is optional on DFlow — it defaults to `"auto"` and determines slippage tolerance
itself if omitted. Forwarding a converted value from the OKX-style source is only necessary if
you want to preserve manual control the caller already had.

### Submitting the signed transaction

| Concept                      | OKX-style source                    | DFlow                |
| ----------------------------- | ------------------------------------ | ------------------- |
| Signed payload field         | provider-specific tx payload        | `signedTransaction` |
| Additional correlation field | provider request/trace id           | `none`              |
| Confirmation                 | handled by the provider's `swap`/`execute` endpoint | your responsibility — poll `getSignatureStatuses` yourself |

Where it lands: the OKX-style source submits to provider `swap`/`execute` endpoints, which broadcast,
confirm, and report back status for you. DFlow returns the transaction to you unbroadcast — you
submit it to your own Solana RPC and poll for confirmation yourself.

## OKX -> DFlow

1. Keep your existing flow shape: request a quote, sign the returned transaction, submit it.
2. Replace OKX quote/swap calls with DFlow `GET /order`.
3. Replace `fromTokenAddress` with `inputMint`.
4. Replace `toTokenAddress` with `outputMint`.
5. Replace `userWalletAddress` with `userPublicKey`.
6. Replace `slippagePercent` with `slippageBps` — convert percentage to basis points (`0.5` = 0.5% becomes `50`).
7. Sign the returned transaction — `VersionedTransaction` for v0 (what you get if
   `transactionVersion` is omitted), or `@solana/kit` if you pass `transactionVersion=v1`.
8. Replace provider execute/status calls with your own RPC submission (`sendRawTransaction` for v0,
   kit's send helpers for v1).
9. Add your own confirmation polling: replace provider request-id polling with a
   `getSignatureStatuses` poll against `lastValidBlockHeight`.

## Platform fees

| Concept          | OKX-style source                                                | DFlow                                        |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Fee rate field    | `feePercent` (percentage string, e.g. `"1.5"`)                   | `platformFeeBps` (basis points, e.g. `150`)     |
| Fee account field | `fromTokenReferrerWalletAddress` / `toTokenReferrerWalletAddress` | `feeAccount`                                    |
| Side selector     | pick one of the two referrer-wallet fields above                 | `platformFeeMode` (`inputMint`/`outputMint`)   |
| Rate limit        | up to 10% on Solana, 3% on other chains                           | not fixed at a specific cap in the docs         |

## OKX -> DFlow platform fees

1. Convert `feePercent` to basis points for `platformFeeBps` (e.g. `"1.5"` -> `150`).
2. Replace whichever of `fromTokenReferrerWalletAddress`/`toTokenReferrerWalletAddress` you used
   with a single `feeAccount`.
3. Set `platformFeeMode` to match the side you were collecting on (`inputMint` if you used the
   `fromToken` field, `outputMint` if you used the `toToken` field).
4. `feeAccount` must already exist before the swap executes, same requirement as the OKX-style
   referrer wallet fields.

## Common migration mistakes

- Keeping `chainIndex` in request builders after moving to DFlow Solana APIs (DFlow is Solana-only
  and has no chain-selector field).
- Forgetting to convert `slippagePercent` semantics to `slippageBps` when you do forward an
  explicit value.
- Assuming DFlow requires `slippageBps` on every request — it's optional and defaults to `"auto"`.
- Mixing decimal token amounts with atomic units.
- Forgetting to convert `feePercent` (a percentage) to `platformFeeBps` (basis points) — `"1.5"`
  is not `1.5` bps, it's `150`.
