# Jup -> DFlow Conversion Guide

This guide describes how to migrate swap code from Jupiter Ultra to DFlow.

## Related Files

- Jupiter swap: `src/01-jupiter-swap.ts`
- DFlow imperative swap: `src/02-dflow-imperative-swap.ts`
- DFlow declarative swap: `src/03-dflow-declarative-swap.ts`

## TL; DR Flows

### Jupiter

1. `GET /ultra/v1/order` with `inputMint`, `outputMint`, `amount`, and `taker`.
2. Deserialize and sign the returned `transaction` locally.
3. `POST /ultra/v1/execute` with `signedTransaction` + `requestId` (Jupiter handles broadcast and status).

### DFlow [Imperative Trade](https://pond.dflow.net/learn/imperative-trades)

1. `GET /order` with `inputMint`, `outputMint`, `amount`, `userPublicKey`, and `slippageBps`.
2. Deserialize and sign the returned `transaction` locally.
3. Broadcast and confirm via your own Solana RPC (`sendRawTransaction` + confirm).

### DFlow [Declarative Trade](https://pond.dflow.net/learn/declarative-trades)

1. `GET /intent` with `inputMint`, `outputMint`, `amount`, `userPublicKey`, and `slippageBps`.
2. Deserialize and sign the returned `openTransaction` locally.
3. `POST /submit-intent` with `quoteResponse` + `signedOpenTransaction`, then track order lifecycle.

## Code Migration

## Parameter mapping

### `getOrder` inputs

| Concept               | Jupiter Ultra            | DFlow Imperative | DFlow Declarative |
| --------------------- | ------------------------ | ---------------- | ----------------- |
| Input mint            | `inputMint`              | `inputMint`      | `inputMint`       |
| Output mint           | `outputMint`             | `outputMint`     | `outputMint`      |
| Amount (atomic units) | `amount`                 | `amount`         | `amount`          |
| User key field        | `taker`                  | `userPublicKey`  | `userPublicKey`   |
| Slippage field        | abstracted in Ultra flow | `slippageBps`    | `slippageBps`     |

### `executeOrder` inputs

| Concept                      | Jupiter Ultra       | DFlow Imperative    | DFlow Declarative                               |
| ---------------------------- | ------------------- | ------------------- | ----------------------------------------------- |
| Signed payload field         | `signedTransaction` | `signedTransaction` | `signedOpenTransaction`                         |
| Additional correlation field | `requestId`         | `none`              | `quoteResponse`/`intent` context in submit body |
| Execute target               | `Jupiter API`       | `Solana RPC`        | `DFlow API`                                     |

## JUP -> DFlow imperative trades

1. Keep your existing flow shape: `getOrder` -> sign -> `executeOrder`.
2. In `getOrder`, replace Jupiter `GET /ultra/v1/order` with DFlow `GET /order`.
3. Replace `taker` with `userPublicKey` and pass `slippageBps`.
4. Keep signing logic the same (`VersionedTransaction`), because `/order` returns `transaction`.
5. Replace Jupiter `/execute` call with `sendRawTransaction` + `confirmTransaction` on your RPC.
6. Replace Jupiter `requestId`-based execute retries with RPC signature-based retry/confirm handling.

## JUP -> DFlow declarative trades

1. Keep your existing flow shape: `getOrder` -> sign -> `executeOrder`.
2. In `getOrder`, replace Jupiter `GET /ultra/v1/order` with DFlow `GET /intent`.
3. Replace `taker` with `userPublicKey` and pass `slippageBps`.
4. Update signing logic to use `openTransaction` from `/intent` (`Transaction.from(...)`).
5. Replace Jupiter `/execute` call with `POST /submit-intent` using `quoteResponse` + `signedOpenTransaction`.
6. Replace Jupiter `requestId` tracking with order metadata (`orderAddress`, `programId`) and order-state follow-up.

## Common migration mistakes

- Treating DFlow imperative like Jupiter Ultra and forgetting RPC ownership.
- Forgetting `slippageBps` on DFlow order/intent requests.
- Mixing decimal token amounts with atomic units.
- Assuming `requestId` semantics exist on DFlow imperative (they do not).
