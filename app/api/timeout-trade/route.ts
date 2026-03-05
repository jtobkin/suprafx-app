export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const start = Date.now();
  const log: string[] = [];
  
  try {
    const { tradeId } = await req.json();
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });
    log.push(`tradeId: ${tradeId}`);

    const db = getServiceClient();
    const now = new Date();

    const { data: trade, error: fetchErr } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (fetchErr) { log.push(`fetch error: ${fetchErr.message}`); return NextResponse.json({ error: fetchErr.message, log }, { status: 500 }); }
    if (!trade) return NextResponse.json({ error: 'Trade not found', log }, { status: 404 });
    
    log.push(`status: ${trade.status}, taker_deadline: ${trade.taker_deadline}, maker_deadline: ${trade.maker_deadline}`);

    // === TAKER TIMEOUT ===
    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      log.push('Processing taker timeout...');
      
      // Step 1: Atomic claim
      const { data: claimed, error: claimErr } = await db.from('trades')
        .update({ status: 'taker_timed_out' })
        .eq('id', tradeId)
        .eq('status', 'open')
        .select('id');
      
      if (claimErr) { log.push(`claim error: ${claimErr.message}`); return NextResponse.json({ error: 'Claim failed', log }, { status: 500 }); }
      if (!claimed?.length) { log.push('Already claimed by another process'); return NextResponse.json({ processed: false, reason: 'Already processed', log }); }
      log.push('Claimed successfully');

      // Step 2: Council signature
      try {
        const { councilVerifyAndSign } = await import('@/lib/council-sign');
        const councilResult = await councilVerifyAndSign(
          'taker_timeout',
          { tradeId, takerAddress: trade.taker_address },
          [{ name: 'timeout', fn: async () => ({ passed: true }) }],
          { tradeId, db },
        );
        log.push(`Council: ${councilResult.decision}, hash: ${councilResult.aggregateHash.slice(0, 16)}...`);
      } catch (e: any) { log.push(`Council error: ${e.message}`); }

      // Step 3: Reputation penalty
      try {
        const { applyTimeoutPenalty } = await import('@/lib/reputation');
        const penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');
        log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)} (-33%)`);
      } catch (e: any) { log.push(`Penalty error: ${e.message}`); }

      // Step 4: Release earmark
      try {
        const { releaseEarmark } = await import('@/lib/vault');
        const { data: q } = await db.from('quotes').select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
        if (q) { await releaseEarmark(q.id, 'taker_timed_out'); log.push('Earmark released'); }
      } catch (e: any) { log.push(`Earmark error: ${e.message}`); }

      // Step 5: Record timeout
      try {
        const { recordTimeout } = await import('@/lib/vault');
        const result = await recordTimeout(trade.taker_address);
        log.push(`Timeouts: ${result.timeoutCount}/3, banned: ${result.banned}`);
      } catch (e: any) { log.push(`Timeout record error: ${e.message}`); }

      // Step 6: Audit trail
      try {
        const { storeSignedAction } = await import('@/lib/signed-actions');
        await storeSignedAction({
          actionType: 'taker_timeout_penalty',
          signerAddress: 'council-approved',
          payload: { tradeId, type: 'taker_timeout', takerAddress: trade.taker_address },
          payloadHash: 'timeout-' + tradeId,
          signature: 'timeout-' + tradeId,
          tradeId,
        });
        log.push('Audit trail stored');
      } catch (e: any) { log.push(`Audit error: ${e.message}`); }

      log.push(`Done in ${Date.now() - start}ms`);
      return NextResponse.json({ processed: true, type: 'taker_timeout', log });
    }

    // === MAKER DEFAULT ===
    if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      log.push('Processing maker default...');
      
      const { data: claimed, error: claimErr } = await db.from('trades')
        .update({ status: 'maker_defaulted' })
        .eq('id', tradeId)
        .eq('status', 'taker_verified')
        .select('id');
      
      if (claimErr) { log.push(`claim error: ${claimErr.message}`); return NextResponse.json({ error: 'Claim failed', log }, { status: 500 }); }
      if (!claimed?.length) { log.push('Already claimed'); return NextResponse.json({ processed: false, reason: 'Already processed', log }); }
      log.push('Claimed successfully');

      // Council
      try {
        const { councilVerifyAndSign } = await import('@/lib/council-sign');
        await councilVerifyAndSign(
          'maker_default',
          { tradeId, makerAddress: trade.maker_address },
          [{ name: 'timeout', fn: async () => ({ passed: true }) }],
          { tradeId, db },
        );
        log.push('Council signed');
      } catch (e: any) { log.push(`Council error: ${e.message}`); }

      // Penalty
      try {
        const { applyTimeoutPenalty } = await import('@/lib/reputation');
        const penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');
        log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)} (-67%)`);
      } catch (e: any) { log.push(`Penalty error: ${e.message}`); }

      // Liquidate and repay taker
      try {
        const { liquidateForDefault } = await import('@/lib/vault');
        const tradeValue = trade.size * trade.rate;
        const result = await liquidateForDefault(tradeId, tradeValue, trade.maker_address, trade.taker_address);
        log.push(`Liquidated: ${result.liquidatedAmount}, taker repaid: ${result.takerRepaid}`);
      } catch (e: any) { log.push(`Liquidation error: ${e.message}`); }

      // Record timeout
      try {
        const { recordTimeout } = await import('@/lib/vault');
        const result = await recordTimeout(trade.maker_address);
        log.push(`Timeouts: ${result.timeoutCount}/3, banned: ${result.banned}`);
      } catch (e: any) { log.push(`Timeout record error: ${e.message}`); }

      // Audit trail
      try {
        const { storeSignedAction } = await import('@/lib/signed-actions');
        await storeSignedAction({
          actionType: 'maker_default_penalty',
          signerAddress: 'council-approved',
          payload: { tradeId, type: 'maker_default', makerAddress: trade.maker_address, takerAddress: trade.taker_address },
          payloadHash: 'default-' + tradeId,
          signature: 'default-' + tradeId,
          tradeId,
        });
        log.push('Audit trail stored');
      } catch (e: any) { log.push(`Audit error: ${e.message}`); }

      log.push(`Done in ${Date.now() - start}ms`);
      return NextResponse.json({ processed: true, type: 'maker_default', log });
    }

    log.push('No expired deadline found for this trade');
    return NextResponse.json({ processed: false, log });
  } catch (e: any) {
    log.push(`TOP LEVEL ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
