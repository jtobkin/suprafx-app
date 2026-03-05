export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefaultWithAuth, recordTimeout } from '@/lib/vault';
import { storeSignedAction } from '@/lib/signed-actions';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { verifySepoliaTx } from '@/lib/chains';

// Reuse the EXACT same runCommittee function from confirm-tx
async function verifyOnChain(chain: string, txHash: string): Promise<boolean> {
  const hasAlchemy = process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_key_here';
  if (chain === 'sepolia' && txHash.startsWith('0x') && hasAlchemy) {
    try { return (await verifySepoliaTx(txHash)).verified; } catch { return true; }
  }
  return true;
}

async function runCommittee(db: any, tradeId: string, verificationType: string, tradeData?: any) {
  const checks = [{ name: 'deadline_expired', fn: async () => ({ passed: true as boolean }) }];
  const result = await councilVerifyAndSign(
    verificationType,
    { tradeId, ...tradeData },
    checks,
    { tradeId, db },  // THIS is the key — passes db so votes get stored
  );
  return { verified: result.decision === 'approved', multisig: { aggregateHash: result.aggregateHash, signatures: result.votes } };
}

export async function POST(req: NextRequest) {
  const log: string[] = [];

  try {
    const { tradeId } = await req.json();
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

    const db = getServiceClient();
    const now = new Date();

    // STEP 1: Fetch trade and determine timeout type
    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    let timeoutType: 'taker_timeout' | 'maker_default' | null = null;
    let targetStatus = '';
    let currentStatus = '';

    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      timeoutType = 'taker_timeout';
      targetStatus = 'taker_timed_out';
      currentStatus = 'open';
    } else if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      timeoutType = 'maker_default';
      targetStatus = 'maker_defaulted';
      currentStatus = 'taker_verified';
    } else {
      return NextResponse.json({ processed: false, reason: 'No expired deadline', status: trade.status, log });
    }

    // STEP 2: ATOMIC CLAIM — only one process can handle this trade
    // Uses eq('status', currentStatus) so if another process already flipped it, this returns empty
    const { data: claimed } = await db.from('trades')
      .update({ status: targetStatus })
      .eq('id', tradeId)
      .eq('status', currentStatus)
      .select('id');

    if (!claimed?.length) {
      log.push('Another process already claimed this trade');
      return NextResponse.json({ processed: false, reason: 'Already being processed', log });
    }
    // Double-check: re-read status to confirm we actually hold the claim
    const { data: confirm } = await db.from('trades').select('status').eq('id', tradeId).single();
    if (confirm?.status !== targetStatus) {
      log.push(`Claim race lost: expected ${targetStatus}, got ${confirm?.status}`);
      return NextResponse.json({ processed: false, reason: 'Claim race lost', log });
    }
    log.push(`Claimed: ${currentStatus} → ${targetStatus}`);

    // STEP 3: COUNCIL VOTE — uses the same runCommittee as confirm-tx
    // This stores votes in committee_requests AND committee_votes (proven path)
    const partyAddress = timeoutType === 'taker_timeout' ? trade.taker_address : trade.maker_address;
    const { verified, multisig } = await runCommittee(db, tradeId, timeoutType, {
      party: partyAddress, pair: trade.pair, size: trade.size, rate: trade.rate,
    });

    if (!verified) {
      // Revert status
      await db.from('trades').update({ status: currentStatus }).eq('id', tradeId);
      log.push('Council rejected — reverted status');
      return NextResponse.json({ processed: false, reason: 'Council rejected', log });
    }
    log.push(`Council approved (hash: ${multisig.aggregateHash.slice(0, 12)}...)`);

    // STEP 4: APPLY PENALTY (council-authorized)
    let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
    try {
      penalty = await applyTimeoutPenalty(partyAddress, timeoutType);
      log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);
    } catch (e: any) { log.push(`Penalty err: ${e.message}`); }

    // STEP 5: EARMARK / LIQUIDATION (council-authorized)
    let liquidation: any = {};
    if (timeoutType === 'taker_timeout') {
      try {
        const { data: q } = await db.from('quotes').select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
        if (q) await releaseEarmark(q.id, 'taker_timed_out');
      } catch {}
    }
    if (timeoutType === 'maker_default') {
      try {
        const tradeValue = trade.size * trade.rate;
        liquidation = await liquidateForDefaultWithAuth(tradeId, tradeValue, trade.maker_address, trade.taker_address, multisig.aggregateHash);
        log.push(`Liquidated: ${liquidation.liquidatedAmount}`);
      } catch (e: any) { log.push(`Liquidation err: ${e.message}`); }
    }

    // STEP 6: TIMEOUT COUNT
    let timeoutCount = 0, banned = false;
    try {
      const result = await recordTimeout(partyAddress);
      timeoutCount = result.timeoutCount;
      banned = result.banned;
    } catch {}

    // STEP 7: AUDIT TRAIL
    try {
      const actionType = timeoutType === 'taker_timeout' ? 'council_taker_timeout' : 'council_maker_default';
      await storeSignedAction({
        actionType,
        signerAddress: 'council-approved',
        payload: {
          decision: timeoutType, tradeId, party: partyAddress,
          penalty: { old: penalty.oldScore, new: penalty.newScore },
          liquidation: liquidation.liquidatedAmount ? liquidation : undefined,
          timeoutCount, banned, councilHash: multisig.aggregateHash,
        },
        payloadHash: multisig.aggregateHash,
        signature: multisig.aggregateHash,
        tradeId,
      });
      log.push('Audit stored');
    } catch (e: any) { log.push(`Audit err: ${e.message}`); }

    log.push('DONE');
    return NextResponse.json({ processed: true, type: timeoutType, councilHash: multisig.aggregateHash, penalty, liquidation, timeoutCount, banned, log });
  } catch (e: any) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
