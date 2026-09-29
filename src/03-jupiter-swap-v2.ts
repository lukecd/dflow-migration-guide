import "dotenv/config";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const mode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (mode !== "validate" && mode !== "live") {
  throw new Error(`Invalid mode "${mode}". Use "validate" or "live".`);
}

// Optional, same as Ultra: api.jup.ag accepts keyless requests at a tighter rate limit. Unlike
// Ultra, V2 has no separate lite-api.jup.ag host for that keyless tier.
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const JUPITER_SWAP_V2_BASE_URL = process.env.JUPITER_SWAP_V2_BASE_URL ?? "https://api.jup.ag/swap/v2";
const INPUT_MINT = process.env.INPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
const OUTPUT_MINT = process.env.OUTPUT_MINT ?? "So11111111111111111111111111111111111111112"; // SOL
const INPUT_AMOUNT = Number(process.env.INPUT_AMOUNT ?? "100000"); // 0.1 USDC (6 decimals)
const EXPLORER_URL = process.env.EXPLORER_URL ?? "https://orb.helius.dev/tx";

function getKeypair(activeMode: RunMode): { keypair: Keypair; isEphemeral: boolean } {
  const raw = process.env.SOLANA_PRIVATE_KEY;

  if (!raw) {
    if (activeMode === "live") {
      throw new Error("SOLANA_PRIVATE_KEY is required in live mode.");
    }
    return { keypair: Keypair.generate(), isEphemeral: true };
  }

  if (raw.trim().startsWith("[")) {
    const secretKey = new Uint8Array(JSON.parse(raw));
    return { keypair: Keypair.fromSecretKey(secretKey), isEphemeral: false };
  }

  return { keypair: Keypair.fromSecretKey(bs58.decode(raw)), isEphemeral: false };
}

// Meta-Aggregator path of Swap API V2: GET /order returns a quote + assembled
// transaction, same shape as Ultra's GET /order. The Router path
// (GET /build + your own submission) is a separate flow, not covered here.
type V2OrderResponse = {
  transaction?: string;
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  error?: string;
  errorMessage?: string;
};

type V2ExecuteResponse = {
  status?: string;
  signature?: string;
  code?: number;
  error?: string;
};

const requestHeaders: HeadersInit = {
  "Content-Type": "application/json",
  ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
};

// `slippageBps` is intentionally omitted below — per Jupiter's own GET /order spec, "if not set,
// Jupiter automatically determines an appropriate slippage." Pass an explicit integer (basis
// points) as a `slippageBps` query param instead if you want manual control.
export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  taker?: string;
}): Promise<V2OrderResponse> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
  });
  if (params.taker) search.set("taker", params.taker);

  const response = await fetch(`${JUPITER_SWAP_V2_BASE_URL}/order?${search.toString()}`, {
    headers: requestHeaders,
  });
  const data = (await response.json()) as V2OrderResponse;

  if (!response.ok) {
    throw new Error(`getOrder failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

export async function executeOrder(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<V2ExecuteResponse> {
  const response = await fetch(`${JUPITER_SWAP_V2_BASE_URL}/execute`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      signedTransaction: params.signedTransaction,
      requestId: params.requestId,
    }),
  });
  const data = (await response.json()) as V2ExecuteResponse;

  if (!response.ok) {
    throw new Error(`executeOrder failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log("Jupiter Swap API V2 config:");
  console.log("  mode:", mode);
  console.log("  swap v2 api:", JUPITER_SWAP_V2_BASE_URL);
  console.log("  amount:", INPUT_AMOUNT, "atomic units");

  const previewOrder = await getOrder({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
  });
  console.log("Order preview. inAmount:", previewOrder.inAmount, "outAmount:", previewOrder.outAmount);

  if (mode === "validate") {
    console.log("Validate mode complete. (order fetched, no execute call)");
    return;
  }

  const { keypair } = getKeypair(mode);
  const taker = keypair.publicKey.toBase58();
  console.log("  wallet:", taker);

  const order = await getOrder({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
    taker,
  });
  if (!order.transaction || !order.requestId) {
    throw new Error(order.errorMessage || order.error || "getOrder returned no transaction/requestId");
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  transaction.sign([keypair]);
  const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");
  console.log("Order transaction signed.");

  const executeResponse = await executeOrder({
    signedTransaction,
    requestId: order.requestId,
  });
  console.log("Execute response:", executeResponse);
  if (executeResponse.signature) {
    console.log("View tx:", `${EXPLORER_URL}/${executeResponse.signature}`);
  }
}

main().catch((error) => {
  console.error("Jupiter Swap API V2 script failed:", error);
  process.exit(1);
});
