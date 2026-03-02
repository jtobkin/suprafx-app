import { ethers } from 'ethers';

// Sepolia provider via Alchemy
export function getSepoliaProvider() {
  const key = process.env.ALCHEMY_API_KEY;
  return new ethers.JsonRpcProvider(`https://eth-sepolia.g.alchemy.com/v2/${key}`);
}

// Verify a Sepolia transaction
export async function verifySepoliaTx(txHash: string): Promise<{
  verified: boolean;
  confirmations: number;
  from: string;
  to: string;
  value: string;
  status: number;
}> {
  const provider = getSepoliaProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  
  if (!receipt) {
    return { verified: false, confirmations: 0, from: '', to: '', value: '0', status: 0 };
  }

  const tx = await provider.getTransaction(txHash);
  const block = await provider.getBlockNumber();
  const confirmations = receipt.blockNumber ? block - receipt.blockNumber + 1 : 0;

  return {
    verified: receipt.status === 1 && confirmations >= 1,
    confirmations,
    from: receipt.from,
    to: receipt.to || '',
    value: tx?.value.toString() || '0',
    status: receipt.status || 0,
  };
}

// Verify a Supra transaction (via REST API)
export async function verifySupraTx(txHash: string): Promise<{
  verified: boolean;
  status: string;
}> {
  try {
    const rpc = process.env.SUPRA_TESTNET_RPC || 'https://rpc-testnet.supra.com';
    const res = await fetch(`${rpc}/rpc/v1/transactions/${txHash}`);
    if (!res.ok) return { verified: false, status: 'not_found' };
    const data = await res.json();
    // Supra tx is verified if it exists and succeeded
    const success = data?.status === 'Success' || data?.vm_status === 'Executed successfully';
    return { verified: success, status: data?.status || 'unknown' };
  } catch {
    return { verified: false, status: 'error' };
  }
}

// Explorer URLs
export function explorerUrl(txHash: string, chain: string): string {
  if (chain === 'sepolia' || txHash.startsWith('0x')) {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  return `https://testnet.suprascan.io/tx/${txHash}`;
}
