import "dotenv/config";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const mode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (mode !== "validate" && mode !== "live") {
  throw new Error(`Invalid mode "${mode}". Use "validate" or "live".`);
}

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DFLOW_TRADE_API_URL = process.env.DFLOW_TRADE_API_URL ?? "https://dev-quote-api.dflow.net";
const DFLOW_API_KEY = process.env.DFLOW_API_KEY;
const INPUT_MINT = process.env.INPUT_MINT ?? "So11111111111111111111111111111111111111112";
const OUTPUT_MINT = process.env.OUTPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const INPUT_AMOUNT = Number(process.env.INPUT_AMOUNT ?? "100000");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "50");
const HELIUS_ORB_BASE_URL = process.env.HELIUS_ORB_BASE_URL ?? "https://orb.helius.dev/tx";

type DFlowOrderResponse = {
  transaction?: string;
  inAmount?: string;
  outAmount?: string;
  error?: string;
};

type DFlowExecuteResponse = {
  signature: string;
};

const requestHeaders: HeadersInit = {
  ...(DFLOW_API_KEY ? { "x-api-key": DFLOW_API_KEY } : {}),
};

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

export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  userPublicKey?: string;
}): Promise<DFlowOrderResponse> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps),
  });
  if (params.userPublicKey) {
    search.set("userPublicKey", params.userPublicKey);
  }

  const response = await fetch(`${DFLOW_TRADE_API_URL}/order?${search.toString()}`, {
    headers: requestHeaders,
  });
  const data = (await response.json()) as DFlowOrderResponse;
  if (!response.ok) {
    throw new Error(`getOrder failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

export async function executeOrder(params: {
  signedTransaction: string;
}): Promise<DFlowExecuteResponse> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const transaction = VersionedTransaction.deserialize(Buffer.from(params.signedTransaction, "base64"));
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature };
}

async function main() {
  const keypair = getKeypair(mode);
  const userPublicKey = keypair.publicKey.toBase58();

  console.log("DFlow imperative swap config:");
  console.log("  mode:", mode);
  console.log("  quote api:", DFLOW_TRADE_API_URL);
  console.log("  wallet:", userPublicKey);
  console.log("  amount:", INPUT_AMOUNT, "atomic units");

  const previewOrder = await getOrder({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
    slippageBps: SLIPPAGE_BPS,
    userPublicKey,
  });
  console.log("Order preview. inAmount:", previewOrder.inAmount, "outAmount:", previewOrder.outAmount);

  if (mode === "validate") {
    console.log("Validate mode complete. (order fetched, no execute call)");
    return;
  }

  const liveOrder = await getOrder({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: INPUT_AMOUNT,
    slippageBps: SLIPPAGE_BPS,
    userPublicKey: keypair.publicKey.toBase58(),
  });
  if (!liveOrder.transaction) {
    throw new Error(liveOrder.error || "getOrder returned no transaction");
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(liveOrder.transaction, "base64"));
  transaction.sign([keypair]);
  const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");

  const executeResponse = await executeOrder({ signedTransaction });
  console.log("Execute response:", executeResponse);
  console.log("View tx on Helius Orb:", `${HELIUS_ORB_BASE_URL}/${executeResponse.signature}`);
}

main().catch((error) => {
  console.error("DFlow imperative swap script failed:", error);
  process.exit(1);
});
