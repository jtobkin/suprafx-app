import { ethers } from "ethers";

// === EVM Bot (Sepolia) ===
export function getEvmBot() {
  const pk = process.env.BOT_EVM_PRIVATE_KEY;
  if (!pk) throw new Error("BOT_EVM_PRIVATE_KEY not set");
  
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const rpcUrl = alchemyKey && alchemyKey !== "your_alchemy_key_here"
    ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`
    : "https://rpc.sepolia.org";
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  return { wallet, provider, address: wallet.address };
}

export async function botSendSepoliaEth(to: string, amountEth: number): Promise<string> {
  const { wallet } = getEvmBot();
  const tx = await wallet.sendTransaction({
    to,
    value: ethers.parseEther(amountEth.toString()),
    gasLimit: 21000,
  });
  await tx.wait();
  return tx.hash;
}

// === Timeout helper ===
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// === Supra Bot (Testnet MoveVM) ===
const SUPRA_CAP_OCTAS = BigInt(100000); // 0.001 SUPRA

function extractTxHash(txRes: any): string {
  if (typeof txRes === "string") return txRes;
  if (txRes?.txHash) return txRes.txHash;
  if (txRes?.hash) return txRes.hash;
  if (txRes?.result?.txHash) return txRes.result.txHash;
  if (txRes?.result?.hash) return txRes.result.hash;
  const str = JSON.stringify(txRes);
  const hashMatch = str.match(/[0-9a-f]{64}/i);
  if (hashMatch) return hashMatch[0];
  return "supra_" + str.slice(0, 60);
}

export async function botSendSupraTokens(to: string, amountOctas: bigint): Promise<string> {
  const cappedAmount = amountOctas > SUPRA_CAP_OCTAS ? SUPRA_CAP_OCTAS : amountOctas;

  const pk = process.env.BOT_SUPRA_PRIVATE_KEY;
  if (!pk) throw new Error("BOT_SUPRA_PRIVATE_KEY not set");

  console.log("[Supra Bot] Sending to:", to, "amount:", cappedAmount.toString(), "octas");

  try {
    // @ts-ignore
    const supraSDK = await import("supra-l1-sdk");
    const { SupraAccount, SupraClient, HexString } = supraSDK;

    // Timeout on client init — RPC may be slow
    const supraClient: any = await withTimeout(
      SupraClient.init("https://rpc-testnet.supra.com/"),
      8000,
      "SupraClient.init"
    );

    const senderAccount = new SupraAccount(
      Uint8Array.from(Buffer.from(pk, "hex"))
    );

    console.log("[Supra Bot] Sender address:", senderAccount.address().toString());

    const receiverAddress = new HexString(to.startsWith("0x") ? to : "0x" + to);

    // Don't wait for confirmation — just submit and return hash
    const txRes = await withTimeout(
      supraClient.transferSupraCoin(
        senderAccount,
        receiverAddress,
        cappedAmount,
        {
          enableTransactionWaitAndSimulationArgs: {
            enableWaitForTransaction: false,
            enableTransactionSimulation: true,
          },
        }
      ),
      15000,
      "transferSupraCoin"
    );

    console.log("[Supra Bot] TX response:", JSON.stringify(txRes, null, 2));
    return extractTxHash(txRes);

  } catch (e: any) {
    console.error("[Supra Bot] Error:", e.message || e);
    throw e;
  }
}

export async function submitCommitteeAttestation(
  tradeId: string,
  attestationHash: string,
  settleMs?: number,
  reputationUpdate?: { address: string; newScore: number; }
): Promise<string> {
  const pk = process.env.BOT_SUPRA_PRIVATE_KEY;
  if (!pk) throw new Error("BOT_SUPRA_PRIVATE_KEY not set");

  try {
    // @ts-ignore
    const supraSDK = await import("supra-l1-sdk");
    const { SupraAccount, SupraClient } = supraSDK;

    const supraClient: any = await withTimeout(
      SupraClient.init("https://rpc-testnet.supra.com/"),
      8000,
      "SupraClient.init (attestation)"
    );

    const committeeAccount = new SupraAccount(
      Uint8Array.from(Buffer.from(pk, "hex"))
    );

    const selfAddress = committeeAccount.address();

    const txRes = await withTimeout(
      supraClient.transferSupraCoin(
        committeeAccount,
        selfAddress,
        BigInt(1),
        {
          enableTransactionWaitAndSimulationArgs: {
            enableWaitForTransaction: false,
            enableTransactionSimulation: true,
          },
        }
      ),
      15000,
      "attestation TX"
    );

    console.log("[Committee] Attestation TX:", JSON.stringify(txRes, null, 2));
    return extractTxHash(txRes);

  } catch (e: any) {
    console.error("[Committee] Attestation error:", e.message || e);
    throw e;
  }
}

export function getBotAddresses() {
  return {
    evm: process.env.BOT_EVM_ADDRESS || "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE",
    supra: process.env.BOT_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a",
  };
}
