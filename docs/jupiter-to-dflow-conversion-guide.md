# Jup -> DFlow Conversion Guide

This guide describes how to migrate swap code from Jupiter to DFlow. Jupiter has two APIs:

- **Swap API V2** — the current recommended path, at `/swap/v2`.
- **Ultra** — `no longer actively maintained`, superseded by Swap API V2. Still functional, no
  removal date announced.

Both use the same `order` -> sign -> `execute` shape as DFlow, so the migration steps
below apply to either one.

## Related Files

- Jupiter Ultra swap: `src/01-jupiter-swap.ts`
- Jupiter Swap API V2 swap: `src/03-jupiter-swap-v2.ts`
- DFlow swap: `src/02-dflow-swap.ts`

## TL; DR Flows

### Jupiter Swap API V2

1. `GET /swap/v2/order` with `inputMint`, `outputMint`, `amount`, and `taker`. `slippageBps` is
   optional — Jupiter auto-determines it if omitted.
2. Deserialize and sign the returned `transaction` locally.
3. `POST /swap/v2/execute` with `signedTransaction` + `requestId` (Jupiter handles broadcast and status).

### Jupiter Ultra (deprecated)

1. `GET /ultra/v1/order` with `inputMint`, `outputMint`, `amount`, and `taker`.
2. Deserialize and sign the returned `transaction` locally.
3. `POST /ultra/v1/execute` with `signedTransaction` + `requestId` (Jupiter handles broadcast and status).

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

| Concept               | Jupiter Ultra            | Jupiter Swap V2 | DFlow           |
| --------------------- | ------------------------ | --------------- | --------------- |
| Input mint            | `inputMint`              | `inputMint`     | `inputMint`     |
| Output mint           | `outputMint`             | `outputMint`    | `outputMint`    |
| Amount (atomic units) | `amount`                 | `amount`        | `amount`        |
| Swapper wallet field   | `taker`                  | `taker`         | `userPublicKey` |
| Slippage field        | abstracted in Ultra flow | `slippageBps`   | `slippageBps`   |

`slippageBps` is optional on both Swap V2 and DFlow — each auto-determines slippage tolerance if
it's omitted. Ultra has no such parameter at all; its slippage handling is entirely internal.

### Submitting the signed transaction

| Concept                      | Jupiter Ultra        | Jupiter Swap V2      | DFlow                |
| ----------------------------- | -------------------- | -------------------- | -------------------- |
| Signed payload field         | `signedTransaction`  | `signedTransaction`  | `signedTransaction`  |
| Additional correlation field | `requestId`          | `requestId`          | `none`                |
| Confirmation                 | handled by Jupiter (`status: Success/Failed` in the `/execute` response) | same as Ultra | your responsibility — poll `getSignatureStatuses` yourself |

Where it lands: Jupiter (Ultra and V2) submits to the Jupiter API, which broadcasts, confirms, and
reports back success or failure in one call. DFlow returns the transaction to you unbroadcast — you
submit it to your own Solana RPC and poll for confirmation yourself.

## JUP Ultra -> DFlow

1. Keep your existing flow shape: request a quote, sign the returned transaction, submit it.
2. Replace Jupiter `GET /ultra/v1/order` with DFlow `GET /order`.
3. Replace `taker` with `userPublicKey`.
4. `slippageBps` is optional on DFlow, same as Ultra — it defaults to `"auto"` if omitted. Unlike
   Ultra, DFlow also lets you pass an explicit value if you want manual control.
5. Sign the returned transaction — `VersionedTransaction` for v0 (what you get if
   `transactionVersion` is omitted), or `@solana/kit` if you pass `transactionVersion=v1`.
6. Replace Jupiter's `/execute` call with your own RPC submission (`sendRawTransaction` for v0,
   kit's send helpers for v1).
7. Add your own confirmation polling: replace Jupiter `requestId`-based retries with a
   `getSignatureStatuses` poll against `lastValidBlockHeight`.

## JUP Swap V2 -> DFlow

1. Keep your existing flow shape: request a quote, sign the returned transaction, submit it.
2. Replace Jupiter `GET /swap/v2/order` with DFlow `GET /order`.
3. Replace `taker` with `userPublicKey`.
4. `slippageBps` is optional on both — Swap V2 and DFlow each auto-determine slippage if it's
   omitted. Pass an explicit integer (basis points) on either side for manual control.
5. Sign the returned transaction — `VersionedTransaction` for v0 (what you get if
   `transactionVersion` is omitted), or `@solana/kit` if you pass `transactionVersion=v1`.
6. Replace Jupiter's `/execute` call with your own RPC submission (`sendRawTransaction` for v0,
   kit's send helpers for v1).
7. Add your own confirmation polling: replace Jupiter `requestId`-based retries with a
   `getSignatureStatuses` poll against `lastValidBlockHeight`.

## Platform fees

| Concept          | Jupiter Ultra                          | Jupiter Swap V2 | DFlow                                    |
| ----------------- | --------------------------------------- | --------------- | ------------------------------------------ |
| Fee rate field    | `referralFee` (bps)                    | `platformFeeBps` | `platformFeeBps`                          |
| Fee account field | `referralAccount`                      | `feeAccount`     | `feeAccount`                              |
| Side selector     | none (set by referral account config)  | none            | `platformFeeMode` (`inputMint`/`outputMint`) |
| Account setup     | Must be pre-registered under Jupiter's Referral Program before use | Any existing token account | Any existing token account |

The setup requirement is the real difference here, not the field names:

- **Ultra** requires a `referralAccount` registered ahead of time through Jupiter's Referral
  Program. Passing an arbitrary account fails at request time with an error like
  `referralAccount is initialized under REFER4Zg...for project...`. This is a one-time onboarding
  step separate from the swap flow itself.
- **Swap V2** dropped that requirement (Jupiter simplified this in Jan 2025): any token account
  you already own works as `feeAccount`, same as DFlow.

## JUP Ultra -> DFlow platform fees

1. Drop the Referral Program registration step entirely — DFlow's `feeAccount` just needs to
   already exist, no dashboard signup.
2. Replace `referralAccount` with `feeAccount`.
3. Replace `referralFee` with `platformFeeBps`.
4. Pick a side with `platformFeeMode` (`inputMint` or `outputMint`); Ultra has no equivalent
   toggle, since it doesn't need one.

## JUP Swap V2 -> DFlow platform fees

1. `platformFeeBps` carries over unchanged.
2. `feeAccount` carries over unchanged.
3. Add `platformFeeMode` if you want to choose which side the fee is collected from; Swap V2
   doesn't expose that as a separate parameter.

## Common migration mistakes

- Treating DFlow like Jupiter (Ultra or V2) and forgetting RPC ownership.
- Assuming DFlow requires `slippageBps` on every request — it's optional and defaults to `"auto"`,
  the same automatic behavior Ultra and Swap V2 both have.
- Mixing decimal token amounts with atomic units.
- Assuming `requestId` semantics exist on DFlow (they do not).
- Assuming DFlow's `feeAccount` needs the same Referral Program registration Ultra's
  `referralAccount` does (it doesn't — same simplicity as Swap V2).
