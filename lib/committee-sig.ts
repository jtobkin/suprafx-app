import crypto from "crypto";

// Committee nodes have deterministic keypairs derived from a seed (demo)
// In production these would be real Ed25519 keys on separate servers
const COMMITTEE_SEED = "suprafx-committee-v1";

export interface CommitteeSignature {
  nodeId: string;
  signature: string;  // hex
  publicKey: string;  // hex
  message: string;    // what was signed
  timestamp: string;
}

export interface MultisigResult {
  tradeId: string;
  verificationType: string;
  threshold: number;
  signatures: CommitteeSignature[];
  aggregateHash: string;  // combined hash of all signatures
  decision: "approved" | "rejected";
  reputationUpdate?: {
    address: string;
    newScore: number;
    tradeCount: number;
  };
}

// Generate deterministic keypair for a committee node
function getNodeKeypair(nodeId: string) {
  const seed = crypto.createHash("sha256").update(COMMITTEE_SEED + ":" + nodeId).digest();
  // Use HMAC as deterministic signature key
  return {
    privateKey: seed,
    publicKey: crypto.createHash("sha256").update(seed).digest().toString("hex").slice(0, 64),
  };
}

// Sign a message with a committee node's key
function nodeSign(nodeId: string, message: string): CommitteeSignature {
  const { privateKey, publicKey } = getNodeKeypair(nodeId);
  const sig = crypto.createHmac("sha256", privateKey).update(message).digest("hex");
  return {
    nodeId,
    signature: sig,
    publicKey,
    message,
    timestamp: new Date().toISOString(),
  };
}

// Generate committee multisig for a trade verification
export function generateMultisig(
  tradeId: string,
  verificationType: string,
  decision: "approved" | "rejected",
  tradeData: {
    pair: string;
    size: number;
    rate: number;
    takerTxHash?: string;
    makerTxHash?: string;
    settleMs?: number;
  },
  reputationUpdate?: { address: string; newScore: number; tradeCount: number }
): MultisigResult {
  const nodes = ["N-1", "N-2", "N-3", "N-4", "N-5"];

  // Construct the canonical message that all nodes sign
  const message = JSON.stringify({
    protocol: "SupraFX",
    version: "1.0",
    tradeId,
    verificationType,
    decision,
    pair: tradeData.pair,
    size: tradeData.size,
    rate: tradeData.rate,
    takerTxHash: tradeData.takerTxHash || null,
    makerTxHash: tradeData.makerTxHash || null,
    settleMs: tradeData.settleMs || null,
    reputationUpdate: reputationUpdate || null,
    timestamp: new Date().toISOString(),
  });

  // All 5 nodes sign
  const signatures = nodes.map(n => nodeSign(n, message));

  // Aggregate hash = hash of all signatures concatenated
  const aggregateHash = crypto
    .createHash("sha256")
    .update(signatures.map(s => s.signature).join(""))
    .digest("hex");

  return {
    tradeId,
    verificationType,
    threshold: 3,
    signatures,
    aggregateHash,
    decision,
    reputationUpdate,
  };
}
