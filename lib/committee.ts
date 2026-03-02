import { getServiceClient } from './supabase';
import { verifySepoliaTx, verifySupraTx } from './chains';

const COMMITTEE_NODES = ['N-1', 'N-2', 'N-3', 'N-4', 'N-5'];
const THRESHOLD = 3;

interface VerificationResult {
  nodeId: string;
  decision: 'approve' | 'reject';
  chain: string;
  txHash: string;
}

// Each node independently verifies a transaction
async function nodeVerify(
  nodeId: string,
  chain: string,
  txHash: string
): Promise<VerificationResult> {
  try {
    if (chain === 'sepolia') {
      const result = await verifySepoliaTx(txHash);
      return {
        nodeId,
        decision: result.verified ? 'approve' : 'reject',
        chain,
        txHash,
      };
    } else {
      const result = await verifySupraTx(txHash);
      return {
        nodeId,
        decision: result.verified ? 'approve' : 'reject',
        chain,
        txHash,
      };
    }
  } catch {
    return { nodeId, decision: 'reject', chain, txHash };
  }
}

// Run full committee verification for a trade
export async function runCommitteeVerification(
  tradeId: string,
  verificationType: 'verify_taker_tx' | 'verify_maker_tx',
  chain: string,
  txHash: string
): Promise<{ approved: boolean; approvals: number; rejections: number }> {
  const db = getServiceClient();

  // Create or get the committee request
  const { data: existing } = await db
    .from('committee_requests')
    .select('*')
    .eq('trade_id', tradeId)
    .eq('verification_type', verificationType)
    .single();

  if (existing?.status === 'approved') {
    return { approved: true, approvals: existing.approvals, rejections: existing.rejections };
  }

  if (!existing) {
    await db.from('committee_requests').insert({
      trade_id: tradeId,
      verification_type: verificationType,
      status: 'pending',
    });
  }

  // All 5 nodes verify independently (in parallel)
  const results = await Promise.all(
    COMMITTEE_NODES.map(nodeId => nodeVerify(nodeId, chain, txHash))
  );

  // Record each vote
  for (const result of results) {
    await db.from('committee_votes').upsert({
      trade_id: tradeId,
      node_id: result.nodeId,
      verification_type: verificationType,
      decision: result.decision,
      chain: result.chain,
      tx_hash: result.txHash,
    }, { onConflict: 'trade_id,node_id,verification_type' });
  }

  const approvals = results.filter(r => r.decision === 'approve').length;
  const rejections = results.filter(r => r.decision === 'reject').length;
  const approved = approvals >= THRESHOLD;

  // Update committee request
  await db.from('committee_requests').update({
    status: approved ? 'approved' : (rejections > COMMITTEE_NODES.length - THRESHOLD ? 'rejected' : 'pending'),
    approvals,
    rejections,
    resolved_at: approved ? new Date().toISOString() : null,
  }).eq('trade_id', tradeId).eq('verification_type', verificationType);

  return { approved, approvals, rejections };
}

// Run reputation approval after settlement
export async function runReputationApproval(tradeId: string): Promise<boolean> {
  const db = getServiceClient();

  // Simple auto-approve for reputation updates post-settlement
  await db.from('committee_requests').upsert({
    trade_id: tradeId,
    verification_type: 'approve_reputation',
    status: 'approved',
    approvals: 5,
    rejections: 0,
    resolved_at: new Date().toISOString(),
  }, { onConflict: 'trade_id,verification_type' });

  // Record all 5 approval votes
  for (const nodeId of COMMITTEE_NODES) {
    await db.from('committee_votes').upsert({
      trade_id: tradeId,
      node_id: nodeId,
      verification_type: 'approve_reputation',
      decision: 'approve',
    }, { onConflict: 'trade_id,node_id,verification_type' });
  }

  return true;
}
