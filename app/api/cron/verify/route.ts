export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { verifySepoliaTx } from '@/lib/chains';
import { updateReputation } from '@/lib/reputation';

const COMMITTEE_NODES = ['N-1', 'N-2', 'N-3', 'N-4', 'N-5'];
const THRESHOLD = 3;

async function verifyTx(chain: string, txHash: string): Promise<boolean> {
  const hasAlchemy = process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_key_here';

  // Real Sepolia verification via Alchemy
  if (chain === 'sepolia' && txHash.startsWith('0x') && hasAlchemy) {
    try {
      const result = await verifySepoliaTx(txHash);
      return result.verified;
    } catch (e) {
      console.error('Sepolia verify error:', e);
      // Fall through to demo mode on error
    }
  }

  // Demo mode: auto-approve non-real TXs or when no Alchemy key
  return true;
}

async function runCommitteeVote(
  db: any,
  tradeId: string,
  verificationType: string,
  chain: string,
  txHash: string
) {
  const { data: existing } = await db
    .from('committee_requests')
    .select('*')
    .eq('trade_id', tradeId)
    .eq('verification_type', verificationType)
    .single();

  if (existing?.status === 'approved') return { approved: true, approvals: existing.approvals };

  if (!existing) {
    await db.from('committee_requests').insert({
      trade_id: tradeId,
      verification_type: verificationType,
      status: 'pending',
    });
  }

  const verified = await verifyTx(chain, txHash);

  // All 5 nodes vote
  for (const nodeId of COMMITTEE_NODES) {
    await db.from('committee_votes').upsert({
      trade_id: tradeId,
      node_id: nodeId,
      verification_type: verificationType,
      decision: verified ? 'approve' : 'reject',
      chain,
      tx_hash: txHash,
    }, { onConflict: 'trade_id,node_id,verification_type' });
  }

  const approvals = verified ? 5 : 0;
  const approved = approvals >= THRESHOLD;

  await db.from('committee_requests').update({
    status: approved ? 'approved' : 'pending',
    approvals,
    rejections: verified ? 0 : 5,
    resolved_at: approved ? new Date().toISOString() : null,
  }).eq('trade_id', tradeId).eq('verification_type', verificationType);

  return { approved, approvals };
}

export async function GET() {
  const db = getServiceClient();
  const results: any[] = [];

  // 1. Verify taker TXs
  const { data: takerPending } = await db
    .from('trades')
    .select('*')
    .eq('status', 'taker_sent')
    .not('taker_tx_hash', 'is', null);

  for (const trade of takerPending || []) {
    const result = await runCommitteeVote(db, trade.id, 'verify_taker_tx', trade.source_chain, trade.taker_tx_hash);
    if (result.approved) {
      await db.from('trades').update({
        status: 'taker_verified',
        taker_tx_confirmed_at: new Date().toISOString(),
      }).eq('id', trade.id);
    }
    results.push({ trade: trade.display_id, type: 'verify_taker_tx', ...result });
  }

  // 2. Verify maker TXs
  const { data: makerPending } = await db
    .from('trades')
    .select('*')
    .eq('status', 'maker_sent')
    .not('maker_tx_hash', 'is', null);

  for (const trade of makerPending || []) {
    const result = await runCommitteeVote(db, trade.id, 'verify_maker_tx', trade.dest_chain, trade.maker_tx_hash);
    if (result.approved) {
      const settleMs = Date.now() - new Date(trade.created_at).getTime();
      await db.from('trades').update({
        status: 'settled',
        maker_tx_confirmed_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
        settle_ms: settleMs,
      }).eq('id', trade.id);

      await runCommitteeVote(db, trade.id, 'approve_reputation', '', '');
      await updateReputation(trade.taker_address, settleMs);
      await updateReputation(trade.maker_address, settleMs);
    }
    results.push({ trade: trade.display_id, type: 'verify_maker_tx', ...result });
  }

  return NextResponse.json({ processed: results.length, results, ts: new Date().toISOString() });
}
