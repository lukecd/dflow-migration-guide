// This script defaults to DFlow's v1 transaction format. Classic `@solana/web3.js` can decode a
// v1 transaction but can't build, sign, or send one, so the live path below uses `@solana/kit`
// instead. The `V0` functions are kept only as a reference for callers still on classic
// `@solana/web3.js` (what DFlow returns when `transactionVersion` is omitted) — they are never
// called from `main()`.
import "dotenv/config";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  assertIsSendableTransaction,
  createKeyPairFromBytes,
  createSolanaRpc,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  sendTransactionWithoutConfirmingFactory,
  signTransaction,
  type SendableTransaction,
  type Transaction,
} from "@solana/kit";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const mode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (mode !== "validate" && mode !== "live") {
  throw new Error(`Invalid mode "${mode}". Use "validate" or "live".`);
}

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DFLOW_TRADE_API_URL = process.env.DFLOW_TRADE_API_URL ?? "https://dev-quote-api.dflow.net";
const DFLOW_API_KEY = process.env.DFLOW_API_KEY;
const INPUT_MINT = process.env.INPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
const OUTPUT_MINT = process.env.OUTPUT_MINT ?? "So11111111111111111111111111111111111111112"; // SOL
const INPUT_AMOUNT = Number(process.env.INPUT_AMOUNT ?? "100000"); // 0.1 USDC (6 decimals)
const EXPLORER_URL = process.env.EXPLORER_URL ?? "https://orb.helius.dev/tx";

type DFlowOrderResponse = {
  transaction?: string;
  inAmount?: string;
  outAmount?: string;
  error?: string;
  lastValidBlockHeight?: number;
};

type DFlowExecuteResponse = {
  signature: string;
  status: "confirmed";
};

const requestHeaders: HeadersInit = {
  ...(DFLOW_API_KEY ? { "x-api-key": DFLOW_API_KEY } : {}),
};

// Returns a classic `@solana/web3.js` Keypair. Used directly for the v0 reference path, and as
// the raw secret-key source for the v1 path's `@solana/kit` keypair (same wallet, two toolchains).
function getKeypair(activeMode: RunMode): Keypair {
  const raw = process.env.SOLANA_PRIVATE_KEY;
  if (!raw) {
    if (activeMode === "live") {
      throw new Error("SOLANA_PRIVATE_KEY is required for live mode.");
    }
    return Keypair.generate();
  }

  if (raw.trim().startsWith("[")) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

// v1 (live path): opts into DFlow's v1 transaction format via `transactionVersion`. `slippageBps`
// is intentionally omitted here — DFlow defaults it to "auto" and determines slippage tolerance
// itself. Pass an explicit integer (basis points) as a `slippageBps` query param instead if you
// want manual control.
export async function getOrderV1(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  userPublicKey?: string;
}): Promise<DFlowOrderResponse> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    transactionVersion: "v1",
  });
  if (params.userPublicKey) {
    search.set("userPublicKey", params.userPublicKey);
  }

  const response = await fetch(`${DFLOW_TRADE_API_URL}/order?${search.toString()}`, {
    headers: requestHeaders,
  });
  const data = (await response.json()) as DFlowOrderResponse;
  if (!response.ok) {
    throw new Error(`getOrderV1 failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// v0 reference only, never called. Omits `transactionVersion`, so DFlow returns a v0 transaction
// (1232-byte limit, address lookup tables, classic web3.js-compatible). Also omits `slippageBps`
// for the same reason as the v1 path — DFlow's "auto" default handles it.
export async function getOrderV0(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  userPublicKey?: string;
}): Promise<DFlowOrderResponse> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
  });
  if (params.userPublicKey) {
    search.set("userPublicKey", params.userPublicKey);
  }

  const response = await fetch(`${DFLOW_TRADE_API_URL}/order?${search.toString()}`, {
    headers: requestHeaders,
  });
  const data = (await response.json()) as DFlowOrderResponse;
  if (!response.ok) {
    throw new Error(`getOrderV0 failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// v1 (live path): broadcasts an already-signed v1 transaction via `@solana/kit`'s
// `sendTransactionWithoutConfirmingFactory`, then confirms it ourselves. DFlow only hands back a
// transaction for you to submit — unlike Jupiter's `/execute`, nothing on DFlow's side tells you
// whether it landed, so unlike the Jupiter scripts in this repo, skipping this step here would
// mean never actually knowing if the swap succeeded.
export async function executeOrderV1(params: {
  signedTransaction: SendableTransaction & Transaction;
  lastValidBlockHeight?: number;
}): Promise<DFlowExecuteResponse> {
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc });
  await sendTransaction(params.signedTransaction, { commitment: "confirmed" });
  const signature = getSignatureFromTransaction(params.signedTransaction);

  // Poll until the transaction lands, fails, or its blockhash expires. Capped at ~30s as a
  // fallback in case `lastValidBlockHeight` wasn't available to bound it.
  for (let attempt = 0; attempt < 30; attempt++) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature]).send();
    if (status?.err) {
      throw new Error(`Transaction failed onchain: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { signature, status: "confirmed" };
    }
    if (params.lastValidBlockHeight !== undefined) {
      const currentBlockHeight = await rpc.getBlockHeight().send();
      if (currentBlockHeight > BigInt(params.lastValidBlockHeight)) {
        throw new Error("Transaction expired before confirming (blockhash no longer valid).");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for confirmation. Check manually: ${signature}`);
}

// v0 reference only, never called. Classic web3.js path: deserialize, broadcast, and wait for
// confirmation via `Connection`.
export async function executeOrderV0(params: {
  signedTransaction: string;
}): Promise<DFlowExecuteResponse> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const transaction = VersionedTransaction.deserialize(Buffer.from(params.signedTransaction, "base64"));
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, status: "confirmed" };
}

async function main() {
  const keypair = getKeypair(mode);
  const userPublicKey = keypair.publicKey.toBase58();

  console.log("DFlow swap config:");
  console.log("  mode:", mode);
  console.log("  tx version: v1");
  console.log("  quote api:", DFLOW_TRADE_API_URL);
  console.log("  wallet:", userPublicKey);
  console.log("  amount:", INPUT_AMOUNT, "atomic units");

  // Only the v1 path runs. getOrderV0/executeOrderV0 above are reference-only.
  const order = await getOrderV1({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
    userPublicKey,
  });
  console.log("Order preview. inAmount:", order.inAmount, "outAmount:", order.outAmount);

  if (mode === "validate") {
    console.log("Validate mode complete. (order fetched, no execute call)");
    return;
  }

  if (!order.transaction) {
    throw new Error(order.error || "getOrderV1 returned no transaction");
  }

  // Same wallet as `keypair` above, re-keyed for `@solana/kit` since classic web3.js can't sign
  // a v1 transaction.
  const kitKeyPair = await createKeyPairFromBytes(keypair.secretKey);
  const transactionBytes = getBase64Encoder().encode(order.transaction);
  const transaction = getTransactionDecoder().decode(transactionBytes);
  const signedTransaction = await signTransaction([kitKeyPair], transaction);
  // DFlow already built this within the v1 size limit; assert rather than re-derive it.
  assertIsSendableTransaction(signedTransaction);

  const executeResponse = await executeOrderV1({
    signedTransaction,
    lastValidBlockHeight: order.lastValidBlockHeight,
  });
  console.log("Execute response:", executeResponse);
  console.log("View tx:", `${EXPLORER_URL}/${executeResponse.signature}`);
}

main().catch((error) => {
  console.error("DFlow swap script failed:", error);
  process.exit(1);
});
