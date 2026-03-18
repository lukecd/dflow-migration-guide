import "dotenv/config";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const mode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (mode !== "validate" && mode !== "live") {
  throw new Error(`Invalid mode "${mode}". Use "validate" or "live".`);
}

const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const defaultUltraBaseUrl = JUPITER_API_KEY
  ? "https://api.jup.ag/ultra/v1"
  : "https://lite-api.jup.ag/ultra/v1";
const JUPITER_ULTRA_BASE_URL = process.env.JUPITER_ULTRA_BASE_URL ?? defaultUltraBaseUrl;
const INPUT_MINT = process.env.INPUT_MINT ?? "So11111111111111111111111111111111111111112";
const OUTPUT_MINT = process.env.OUTPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const INPUT_AMOUNT = Number(process.env.INPUT_AMOUNT ?? "100000");
const HELIUS_ORB_BASE_URL = process.env.HELIUS_ORB_BASE_URL ?? "https://orb.helius.dev/tx";

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

type UltraOrderResponse = {
  transaction?: string;
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  error?: string;
  errorMessage?: string;
};

type UltraExecuteResponse = {
  status?: string;
  signature?: string;
  code?: string;
  error?: string;
};

const requestHeaders: HeadersInit = {
  "Content-Type": "application/json",
  ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
};

export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  taker?: string;
}): Promise<UltraOrderResponse> {
  const search = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
  });
  if (params.taker) search.set("taker", params.taker);

  const response = await fetch(`${JUPITER_ULTRA_BASE_URL}/order?${search.toString()}`, {
    headers: requestHeaders,
  });
  const data = (await response.json()) as UltraOrderResponse;

  if (!response.ok) {
    throw new Error(`getOrder failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

export async function executeOrder(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<UltraExecuteResponse> {
  const response = await fetch(`${JUPITER_ULTRA_BASE_URL}/execute`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      signedTransaction: params.signedTransaction,
      requestId: params.requestId,
    }),
  });
  const data = (await response.json()) as UltraExecuteResponse;

  if (!response.ok) {
    throw new Error(`executeOrder failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log("Jupiter swap config:");
  console.log("  mode:", mode);
  console.log("  ultra api:", JUPITER_ULTRA_BASE_URL);
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
    console.log("View tx on Helius Orb:", `${HELIUS_ORB_BASE_URL}/${executeResponse.signature}`);
  }
}

main().catch((error) => {
  console.error("Jupiter swap script failed:", error);
  process.exit(1);
});
