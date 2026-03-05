export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefaultWithAuth, recordTimeout } from '@/lib/vault';
import { storeSignedAction } from '@/lib/signed-actions';

export async function POST(req: NextRequest) {
  const log: string[] = [];

  try {
    const { tradeId } = await req.json();
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

    const db = getServiceClient();
    const now = new Date();

    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    let timeoutType: 'taker_timeout' | 'maker_default' | null = null;
    let partyAddress = '';
    let targetStatus = '';
    let previousStatus = trade.status;

    if ((trade.status === 'open' || trade.status === 'taker_timed_out') && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      timeoutType = 'taker_timeout'; partyAddress = trade.taker_address; targetStatus = 'taker_timed_out';
    }
    if ((trade.status === 'taker_verified' || trade.status === 'maker_defaulted') && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      timeoutType = 'maker_default'; partyAddress = trade.maker_address; targetStatus = 'maker_defaulted';
    }

    if (!timeoutType) {
      return NextResponse.json({ processed: false, reason: 'No timeout condition', status: trade.status, log });
    }

    // Already fully processed?
    const { data: existing } = await db.from('signed_actions')
      .select('id').eq('trade_id', tradeId)
      .in('action_type', ['council_taker_timeout', 'council_maker_default']).limit(1);
    if (existing?.length) {
      if (trade.status !== targetStatus) await db.from('trades').update({ status: targetStatus }).eq('id', tradeId);
      return NextResponse.json({ processed: true, reason: 'Already processed', log });
    }

    // ============================================
    // STEP 1: FLIP STATUS (prevents UI confusion)
    // ============================================
    if (trade.status !== targetStatus) {
      await db.from('trades').update({ status: targetStatus }).eq('id', tradeId);
      log.push(`Status → ${targetStatus}`);
    }

    // ============================================
    // STEP 2: COUNCIL VOTE (authorizes everything that follows)
    // ============================================
    let councilHash = '';
    let councilApproved = false;
    let councilVotes: any[] = [];
    try {
      const { councilVerifyAndSign } = await import('@/lib/council-sign');
      const councilResult = await councilVerifyAndSign(
        timeoutType,
        { tradeId, party: partyAddress, pair: trade.pair, size: trade.size, rate: trade.rate },
        [{ name: 'deadline_expired', fn: async () => ({ passed: true }) }],
        { tradeId, db },
      );
      councilHash = councilResult.aggregateHash;
      councilApproved = councilResult.decision === 'approved';
      councilVotes = councilResult.votes;
      log.push(`Council: ${councilResult.decision} (${councilResult.approvals}/${councilResult.rejections})`);
    } catch (e: any) { log.push(`Council err: ${e.message}`); }

    // If Council rejected, revert status
    if (!councilApproved) {
      await db.from('trades').update({ status: previousStatus }).eq('id', tradeId);
      log.push(`Reverted status → ${previousStatus}`);
      return NextResponse.json({ processed: false, reason: 'Council rejected', log });
    }

    // ============================================
    // STEP 3: PENALTY (Council-authorized)
    // ============================================
    let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
    try {
      penalty = await applyTimeoutPenalty(partyAddress, timeoutType);
      log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);
    } catch (e: any) { log.push(`Penalty err: ${e.message}`); }

    // ============================================
    // STEP 4: LIQUIDATION / EARMARK (Council-authorized)
    // ============================================
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
        liquidation = await liquidateForDefaultWithAuth(tradeId, tradeValue, trade.maker_address, trade.taker_address, councilHash);
        log.push(`Liquidated: ${liquidation.liquidatedAmount}`);
      } catch (e: any) { log.push(`Liquidation err: ${e.message}`); }
    }

    // ============================================
    // STEP 5: TIMEOUT COUNT + BAN CHECK
    // ============================================
    let timeoutCount = 0, banned = false;
    try {
      const result = await recordTimeout(partyAddress);
      timeoutCount = result.timeoutCount; banned = result.banned;
    } catch {}

    // Council votes already stored by councilVerifyAndSign (same path as confirm-tx)
    log.push('Votes stored via councilVerifyAndSign');

    // ============================================
    // STEP 7: AUDIT TRAIL
    // ============================================
    try {
      await storeSignedAction({
        actionType: timeoutType === 'taker_timeout' ? 'council_taker_timeout' : 'council_maker_default',
        signerAddress: 'council-approved',
        payload: {
          decision: timeoutType, tradeId, party: partyAddress,
          penalty: { old: penalty.oldScore, new: penalty.newScore },
          liquidation: liquidation.liquidatedAmount ? liquidation : undefined,
          timeoutCount, banned, councilHash,
        },
        payloadHash: councilHash, signature: councilHash, tradeId,
      });
      log.push('Audit stored');
    } catch (e: any) { log.push(`Audit err: ${e.message}`); }

    log.push('DONE');
    return NextResponse.json({ processed: true, type: timeoutType, councilHash, penalty, liquidation, timeoutCount, banned, log });
  } catch (e: any) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
