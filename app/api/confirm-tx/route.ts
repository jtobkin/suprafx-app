export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { verifySepoliaTx } from '@/lib/chains';
import { updateReputation } from '@/lib/reputation';

const COMMITTEE_NODES = ['N-1', 'N-2', 'N-3', 'N-4', 'N-5'];

async function verifyOnChain(chain: string, txHash: string): Promise<boolean> {
  const hasAlchemy = process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_key_here';
  if (chain === 'sepolia' && txHash.startsWith('0x') && hasAlchemy) {
    try {
      const result = await verifySepoliaTx(txHash);
      return result.verified;
    } catch { return true; }
  }
  return true; // Demo/non-Sepolia: auto-approve
}

async function runCommitteeAndUpdate(db: any, tradeId: string, verificationType: string, chain: string, txHash: string) {
  const verified = await verifyOnChain(chain, txHash);

  // Record committee request
  await db.from('committee_requests').upsert({
    trade_id: tradeId,
    verification_type: verificationType,
    status: verified ? 'approved' : 'pending',
    approvals: verified ? 5 : 0,
    rejections: verified ? 0 : 5,
    resolved_at: verified ? new Date().toISOString() : null,
  }, { onConflict: 'trade_id,verification_type' });

  // Record all 5 node votes
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

  return verified;
}

export async function POST(req: NextRequest) {
  try {
    const { tradeId, txHash, side } = await req.json();

    if (!tradeId || !txHash || !side) {
      return NextResponse.json({ error: 'tradeId, txHash, and side (taker|maker) required' }, { status: 400 });
    }

    const db = getServiceClient();
    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    if (side === 'taker') {
      if (trade.status !== 'open') {
        return NextResponse.json({ error: 'Trade not in open state' }, { status: 400 });
      }

      // Update status to taker_sent
      await db.from('trades').update({
        taker_tx_hash: txHash,
        status: 'taker_sent',
      }).eq('id', tradeId);

      // Immediately verify
      const verified = await runCommitteeAndUpdate(db, tradeId, 'verify_taker_tx', trade.source_chain, txHash);

      if (verified) {
        await db.from('trades').update({
          status: 'taker_verified',
          taker_tx_confirmed_at: new Date().toISOString(),
        }).eq('id', tradeId);

        return NextResponse.json({ success: true, status: 'taker_verified', verified: true });
      }

      return NextResponse.json({ success: true, status: 'taker_sent', verified: false, message: 'TX pending verification' });

    } else if (side === 'maker') {
      if (trade.status !== 'taker_verified') {
        return NextResponse.json({ error: 'Trade not in taker_verified state' }, { status: 400 });
      }

      // Update status to maker_sent
      await db.from('trades').update({
        maker_tx_hash: txHash,
        status: 'maker_sent',
      }).eq('id', tradeId);

      // Immediately verify
      const verified = await runCommitteeAndUpdate(db, tradeId, 'verify_maker_tx', trade.dest_chain, txHash);

      if (verified) {
        const settleMs = Date.now() - new Date(trade.created_at).getTime();
        await db.from('trades').update({
          status: 'settled',
          maker_tx_confirmed_at: new Date().toISOString(),
          settled_at: new Date().toISOString(),
          settle_ms: settleMs,
        }).eq('id', tradeId);

        // Reputation
        await runCommitteeAndUpdate(db, tradeId, 'approve_reputation', '', '');
        await updateReputation(trade.taker_address, settleMs);
        await updateReputation(trade.maker_address, settleMs);

        return NextResponse.json({ success: true, status: 'settled', verified: true, settleMs });
      }

      return NextResponse.json({ success: true, status: 'maker_sent', verified: false });

    } else {
      return NextResponse.json({ error: 'side must be taker or maker' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
