export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
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

    // Determine timeout type
    let timeoutType: 'taker_timeout' | 'maker_default' | null = null;
    let targetStatus = '';
    let currentStatus = '';

    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      timeoutType = 'taker_timeout'; targetStatus = 'taker_timed_out'; currentStatus = 'open';
    } else if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      timeoutType = 'maker_default'; targetStatus = 'maker_defaulted'; currentStatus = 'taker_verified';
    } else {
      return NextResponse.json({ processed: false, reason: 'No expired deadline', status: trade.status, log });
    }

    // ATOMIC CLAIM
    const { data: claimed } = await db.from('trades')
      .update({ status: targetStatus })
      .eq('id', tradeId).eq('status', currentStatus).select('id');
    if (!claimed?.length) {
      return NextResponse.json({ processed: false, reason: 'Already being processed', log });
    }
    log.push(`Claimed: ${targetStatus}`);

    // COUNCIL VOTE — signing only, NO db storage (pass no storeOpts)
    const partyAddress = timeoutType === 'taker_timeout' ? trade.taker_address : trade.maker_address;
    const councilResult = await councilVerifyAndSign(
      timeoutType,
      { tradeId, party: partyAddress, pair: trade.pair, size: trade.size, rate: trade.rate },
      [{ name: 'deadline_expired', fn: async () => ({ passed: true }) }],
      // NO { tradeId, db } — we store votes manually below for speed
    );

    if (councilResult.decision !== 'approved') {
      await db.from('trades').update({ status: currentStatus }).eq('id', tradeId);
      return NextResponse.json({ processed: false, reason: 'Council rejected', log });
    }
    log.push(`Council: ${councilResult.decision} (${councilResult.approvals}/${councilResult.rejections})`);

    // STORE VOTES IMMEDIATELY — before anything else can timeout
    // committee_requests first
    await db.from('committee_requests').upsert({
      trade_id: tradeId,
      verification_type: timeoutType,
      status: 'approved',
      approvals: councilResult.approvals,
      rejections: councilResult.rejections,
      threshold: 3,
      resolved_at: now.toISOString(),
    }, { onConflict: 'trade_id,verification_type' });

    // committee_votes — 5 inserts
    for (const vote of councilResult.votes) {
      const { error: vErr } = await db.from('committee_votes').insert({
        trade_id: tradeId,
        node_id: vote.nodeId,
        verification_type: timeoutType,
        decision: vote.decision,
        chain: '',
        tx_hash: '',
        signature: vote.signature,
      });
      if (vErr) log.push(`Vote ${vote.nodeId} err: ${vErr.message}`);
    }
    log.push('Votes stored');

    // PENALTY
    let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
    try {
      penalty = await applyTimeoutPenalty(partyAddress, timeoutType);
      log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);
    } catch (e: any) { log.push(`Penalty err: ${e.message}`); }

    // EARMARK / LIQUIDATION
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
        liquidation = await liquidateForDefaultWithAuth(tradeId, tradeValue, trade.maker_address, trade.taker_address, councilResult.aggregateHash);
        log.push(`Liquidated: ${liquidation.liquidatedAmount}`);
      } catch (e: any) { log.push(`Liquidation err: ${e.message}`); }
    }

    // TIMEOUT COUNT
    let timeoutCount = 0, banned = false;
    try {
      const r = await recordTimeout(partyAddress);
      timeoutCount = r.timeoutCount; banned = r.banned;
    } catch {}

    // AUDIT TRAIL
    try {
      await storeSignedAction({
        actionType: timeoutType === 'taker_timeout' ? 'council_taker_timeout' : 'council_maker_default',
        signerAddress: 'council-approved',
        payload: {
          decision: timeoutType, tradeId, party: partyAddress,
          penalty: { old: penalty.oldScore, new: penalty.newScore },
          liquidation: liquidation.liquidatedAmount ? liquidation : undefined,
          timeoutCount, banned, councilHash: councilResult.aggregateHash,
        },
        payloadHash: councilResult.aggregateHash,
        signature: councilResult.aggregateHash,
        tradeId,
      });
      log.push('Audit stored');
    } catch (e: any) { log.push(`Audit err: ${e.message}`); }

    log.push('DONE');
    return NextResponse.json({ processed: true, type: timeoutType, councilHash: councilResult.aggregateHash, penalty, liquidation, timeoutCount, banned, log });
  } catch (e: any) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
