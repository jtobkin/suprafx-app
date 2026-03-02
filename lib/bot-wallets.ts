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
export async function botSendSupraTokens(to: string, amountOctas: bigint): Promise<string> {
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
    amountOctas,
    {
      enableTransactionWaitAndSimulationArgs: {
        enableWaitForTransaction: true,
        enableTransactionSimulation: true,
      },
    }
  );

  return txRes.txHash || txRes.hash || JSON.stringify(txRes);
}

// Get bot addresses
export function getBotAddresses() {
  return {
    evm: process.env.BOT_EVM_ADDRESS || "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE",
    supra: process.env.BOT_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a",
  };
}
