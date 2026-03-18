import "dotenv/config";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const mode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (mode !== "validate" && mode !== "live") {
  throw new Error(`Invalid mode "${mode}". Use "validate" or "live".`);
}

const DFLOW_TRADE_API_URL = process.env.DFLOW_TRADE_API_URL ?? "https://dev-quote-api.dflow.net";
const DFLOW_API_KEY = process.env.DFLOW_API_KEY;
const INPUT_MINT = process.env.INPUT_MINT ?? "So11111111111111111111111111111111111111112";
const OUTPUT_MINT = process.env.OUTPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const INPUT_AMOUNT = Number(process.env.INPUT_AMOUNT ?? "100000");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "50");
const HELIUS_ORB_BASE_URL = process.env.HELIUS_ORB_BASE_URL ?? "https://orb.helius.dev/tx";

type IntentResponse = {
  inputMint?: string;
  outputMint?: string;
  openTransaction: string;
  lastValidBlockHeight?: number;
  expiry?: {
    slotsAfterOpen: number;
  };
  error?: string;
};

type SubmitIntentResponse = {
  signature?: string;
  orderAddress?: string;
  programId?: string;
  error?: string;
};

function getKeypair(activeMode: RunMode): Keypair {
  const raw = process.env.SOLANA_PRIVATE_KEY;

  if (!raw) {
    if (activeMode === "live") {
      throw new Error("SOLANA_PRIVATE_KEY is required in live mode.");
    }
    return Keypair.generate();
  }

  if (raw.trim().startsWith("[")) {
    const secretKey = new Uint8Array(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  }

  return Keypair.fromSecretKey(bs58.decode(raw));
}

export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  userPublicKey: string;
}): Promise<IntentResponse> {
  const searchParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps),
    userPublicKey: params.userPublicKey,
  });

  const headers: HeadersInit = {};
  if (DFLOW_API_KEY) {
    headers["x-api-key"] = DFLOW_API_KEY;
  }

  const response = await fetch(`${DFLOW_TRADE_API_URL}/intent?${searchParams.toString()}`, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`getOrder (/intent) failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as IntentResponse;
}

export async function executeOrder(
  params: {
    order: IntentResponse;
    signedTransaction: string;
  },
): Promise<SubmitIntentResponse> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (DFLOW_API_KEY) {
    headers["x-api-key"] = DFLOW_API_KEY;
  }

  const response = await fetch(`${DFLOW_TRADE_API_URL}/submit-intent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      quoteResponse: params.order,
      signedOpenTransaction: params.signedTransaction,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`executeOrder (/submit-intent) failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as SubmitIntentResponse;
}

async function main() {
  const keypair = getKeypair(mode);
  const userPublicKey = keypair.publicKey.toBase58();

  console.log("DFlow declarative swap config:");
  console.log("  mode:", mode);
  console.log("  quote api:", DFLOW_TRADE_API_URL);
  console.log("  wallet:", userPublicKey);
  console.log("  amount:", INPUT_AMOUNT, "atomic units");

  const order = await getOrder({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
    slippageBps: SLIPPAGE_BPS,
    userPublicKey,
  });
  if (!order.openTransaction) {
    throw new Error(order.error || "getOrder returned no openTransaction");
  }

  const openTransaction = Transaction.from(Buffer.from(order.openTransaction, "base64"));
  openTransaction.sign(keypair);
  const signedTransaction = Buffer.from(openTransaction.serialize()).toString("base64");
  console.log("Order transaction signed.");

  if (mode === "validate") {
    console.log("Validate mode complete. (intent built, no execute call)");
    return;
  }

  const executeResponse = await executeOrder({
    order,
    signedTransaction,
  });
  console.log("Execute response:", executeResponse);
  if (executeResponse.signature) {
    console.log("View tx on Helius Orb:", `${HELIUS_ORB_BASE_URL}/${executeResponse.signature}`);
  }
}

main().catch((error) => {
  console.error("DFlow declarative script failed:", error);
  process.exit(1);
});
