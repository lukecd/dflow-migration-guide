import "dotenv/config";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

type RunMode = "validate" | "live";

const runMode = (process.argv[2] as RunMode | undefined) ?? "validate";
if (runMode !== "validate" && runMode !== "live") {
  throw new Error(`Invalid run mode "${runMode}". Use "validate" or "live".`);
}

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DFLOW_TRADE_API_URL = process.env.DFLOW_TRADE_API_URL ?? "https://dev-quote-api.dflow.net";
const DFLOW_API_KEY = process.env.DFLOW_API_KEY;
const EXPLORER_URL = process.env.EXPLORER_URL ?? "https://orb.helius.dev/tx";

// "OKX-shaped" request fields, matching OKX's current DEX Aggregator API (v6).
type OkxSwapRequest = {
  chainIndex?: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: number;
  userWalletAddress: string;
  slippagePercent: number; // 0.5 means 0.5%
};

type DFlowOrderResponse = {
  transaction?: string;
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  error?: string;
  errorMessage?: string;
};

type DFlowExecuteResponse = {
  signature?: string;
  status?: string;
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
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function okxToDflowRequest(input: OkxSwapRequest): {
  inputMint: string;
  outputMint: string;
  amount: number;
  userPublicKey: string;
  slippageBps: number;
} {
  return {
    inputMint: input.fromTokenAddress,
    outputMint: input.toTokenAddress,
    amount: input.amount,
    userPublicKey: input.userWalletAddress,
    slippageBps: Math.round(input.slippagePercent * 100),
  };
}

function getHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(DFLOW_API_KEY ? { "x-api-key": DFLOW_API_KEY } : {}),
  };
}

export async function getOrder(input: OkxSwapRequest): Promise<DFlowOrderResponse> {
  const mapped = okxToDflowRequest(input);

  const params = new URLSearchParams({
    inputMint: mapped.inputMint,
    outputMint: mapped.outputMint,
    amount: String(mapped.amount),
    userPublicKey: mapped.userPublicKey,
    slippageBps: String(mapped.slippageBps),
  });

  const response = await fetch(`${DFLOW_TRADE_API_URL}/order?${params.toString()}`, {
    headers: getHeaders(false),
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
  const tx = VersionedTransaction.deserialize(Buffer.from(params.signedTransaction, "base64"));
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, status: "confirmed" };
}

async function main() {
  const keypair = getKeypair(runMode);

  const okxShapedInput: OkxSwapRequest = {
    chainIndex: process.env.OKX_CHAIN_INDEX ?? "501", // kept for source-shape parity; not used by DFlow
    fromTokenAddress: process.env.INPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    toTokenAddress: process.env.OUTPUT_MINT ?? "So11111111111111111111111111111111111111112", // SOL
    amount: Number(process.env.INPUT_AMOUNT ?? "100000"), // 0.1 USDC (6 decimals)
    userWalletAddress: keypair.publicKey.toBase58(),
    slippagePercent: Number(process.env.OKX_SLIPPAGE_PERCENT ?? "0.5"),
  };

  console.log("OKX -> DFlow swap config:");
  console.log("  run mode:", runMode);
  console.log("  dflow api:", DFLOW_TRADE_API_URL);
  console.log("  user wallet:", okxShapedInput.userWalletAddress);
  console.log("  amount:", okxShapedInput.amount);

  const order = await getOrder(okxShapedInput);
  console.log("Order preview. inAmount:", order.inAmount, "outAmount:", order.outAmount);

  if (runMode === "validate") {
    console.log("Validate mode complete. (order fetched, no execute call)");
    return;
  }

  if (!order.transaction) {
    throw new Error(order.error || order.errorMessage || "Missing transaction in /order response");
  }
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([keypair]);
  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");

  const result = await executeOrder({ signedTransaction });
  console.log("Execute result:", result);
  if (result.signature) {
    console.log("View tx:", `${EXPLORER_URL}/${result.signature}`);
  }
}

main().catch((error) => {
  console.error("OKX -> DFlow swap script failed:", error);
  process.exit(1);
});
