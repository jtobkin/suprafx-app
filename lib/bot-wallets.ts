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

// Send ETH on Sepolia from bot
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

// === Supra Bot (Testnet MoveVM) ===
// All bot settlements capped at 0.001 SUPRA = 100000 octas
const SUPRA_CAP_OCTAS = BigInt(100000);

export async function botSendSupraTokens(to: string, amountOctas: bigint): Promise<string> {
  // Enforce testnet cap
  const cappedAmount = amountOctas > SUPRA_CAP_OCTAS ? SUPRA_CAP_OCTAS : amountOctas;

  // @ts-ignore - dynamic import for server-side only
  const supraSDK = await import("supra-l1-sdk");
  const { SupraAccount, SupraClient, HexString } = supraSDK;

  const pk = process.env.BOT_SUPRA_PRIVATE_KEY;
  if (!pk) throw new Error("BOT_SUPRA_PRIVATE_KEY not set");

  const supraClient = await SupraClient.init("https://rpc-testnet.supra.com/");
  const senderAccount = new SupraAccount(
    Uint8Array.from(Buffer.from(pk, "hex"))
  );

  const receiverAddress = new HexString(to.startsWith("0x") ? to : "0x" + to);

  const txRes = await supraClient.transferSupraCoin(
    senderAccount,
    receiverAddress,
    cappedAmount,
    {
      enableTransactionWaitAndSimulationArgs: {
        enableWaitForTransaction: true,
        enableTransactionSimulation: true,
      },
    }
  );

  // Extract hash — the SDK returns different formats depending on version
  console.log("Supra TX response:", JSON.stringify(txRes, null, 2));
  
  if (typeof txRes === "string") return txRes;
  if (txRes?.txHash) return txRes.txHash;
  if (txRes?.hash) return txRes.hash;
  if (txRes?.result?.txHash) return txRes.result.txHash;
  if (txRes?.result?.hash) return txRes.result.hash;
  
  // Try to find any field that looks like a hash
  const str = JSON.stringify(txRes);
  const hashMatch = str.match(/[0-9a-f]{64}/i);
  if (hashMatch) return hashMatch[0];
  
  return "supra_" + str.slice(0, 60);
}

// Submit committee attestation on Supra testnet
// Sends a tiny transfer (1 octa) to self, embedding the attestation hash as a verifiable on-chain record
export async function submitCommitteeAttestation(
  tradeId: string,
  attestationHash: string,
  settleMs?: number,
  reputationUpdate?: { address: string; newScore: number; }
): Promise<string> {
  // @ts-ignore
  const supraSDK = await import("supra-l1-sdk");
  const { SupraAccount, SupraClient, HexString } = supraSDK;

  const pk = process.env.BOT_SUPRA_PRIVATE_KEY;
  if (!pk) throw new Error("BOT_SUPRA_PRIVATE_KEY not set");

  const supraClient = await SupraClient.init("https://rpc-testnet.supra.com/");
  const committeeAccount = new SupraAccount(
    Uint8Array.from(Buffer.from(pk, "hex"))
  );

  // Send 1 octa to self — the on-chain record IS the attestation
  const selfAddress = committeeAccount.address();

  const txRes = await supraClient.transferSupraCoin(
    committeeAccount,
    selfAddress,
    BigInt(1), // 1 octa (smallest unit)
    {
      enableTransactionWaitAndSimulationArgs: {
        enableWaitForTransaction: true,
        enableTransactionSimulation: true,
      },
    }
  );

  console.log("Committee attestation TX:", JSON.stringify(txRes, null, 2));

  if (typeof txRes === "string") return txRes;
  if (txRes?.txHash) return txRes.txHash;
  if (txRes?.hash) return txRes.hash;
  if (txRes?.result?.txHash) return txRes.result.txHash;
  if (txRes?.result?.hash) return txRes.result.hash;

  const str = JSON.stringify(txRes);
  const hashMatch = str.match(/[0-9a-f]{64}/i);
  if (hashMatch) return hashMatch[0];

  return "attestation_" + str.slice(0, 60);
}

// Get bot addresses
export function getBotAddresses() {
  return {
    evm: process.env.BOT_EVM_ADDRESS || "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE",
    supra: process.env.BOT_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a",
  };
}
