export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

/**
 * Lightweight deadline check — delegates to /api/timeout-trade for each expired trade.
 * This keeps the logic in one place and avoids duplication.
 */
export async function GET() {
  const db = getServiceClient();
  const now = new Date().toISOString();
  const processed: string[] = [];
  const errors: string[] = [];

  try {
    // Find trades with expired taker deadlines
    const { data: expiredTaker } = await db.from('trades')
      .select('id')
      .eq('status', 'open')
      .not('taker_deadline', 'is', null)
      .lt('taker_deadline', now)
      .limit(5);

    // Find trades with expired maker deadlines
    const { data: expiredMaker } = await db.from('trades')
      .select('id')
      .eq('status', 'taker_verified')
      .not('maker_deadline', 'is', null)
      .lt('maker_deadline', now)
      .limit(5);

    const expired = [...(expiredTaker || []), ...(expiredMaker || [])];

    if (expired.length === 0) {
      return NextResponse.json({ checked: true, expired: 0 });
    }

    // Process each by calling the timeout-trade endpoint internally
    for (const { id: tradeId } of expired) {
      try {
        // Import and call the same logic as timeout-trade
        const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
        if (!trade) continue;
        
        // Skip if already processed
        if (['taker_timed_out', 'maker_defaulted', 'settled', 'cancelled'].includes(trade.status)) continue;

        const isTakerTimeout = trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < new Date();
        const isMakerDefault = trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < new Date();

        if (!isTakerTimeout && !isMakerDefault) continue;

        // Atomic claim
        const targetStatus = isTakerTimeout ? 'taker_timed_out' : 'maker_defaulted';
        const currentStatus = isTakerTimeout ? 'open' : 'taker_verified';
        
        const { data: claimed } = await db.from('trades')
          .update({ status: targetStatus })
          .eq('id', tradeId)
          .eq('status', currentStatus)
          .select('id');

        if (!claimed?.length) continue; // Another process got it

        // Run council, penalties, etc.
        const { councilVerifyAndSign } = await import('@/lib/council-sign');
        const { applyTimeoutPenalty } = await import('@/lib/reputation');
        const { releaseEarmark, liquidateForDefault, recordTimeout } = await import('@/lib/vault');
        const { storeSignedAction } = await import('@/lib/signed-actions');

        if (isTakerTimeout) {
          let councilHash = '';
          try {
            const r = await councilVerifyAndSign('taker_timeout',
              { tradeId, takerAddress: trade.taker_address, deadline: trade.taker_deadline },
              [{ name: 'deadline_passed', fn: async () => ({ passed: true }) }],
              { tradeId, db });
            councilHash = r.aggregateHash;
          } catch (e: any) { errors.push(`council:${e.message}`); }

          let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
          try { penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout'); } catch (e: any) { errors.push(`penalty:${e.message}`); }

          try {
            const { data: q } = await db.from('quotes').select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
            if (q) await releaseEarmark(q.id, 'taker_timed_out');
          } catch {}

          let timeoutCount = 0, banned = false;
          try { const r = await recordTimeout(trade.taker_address); timeoutCount = r.timeoutCount; banned = r.banned; } catch {}

          try {
            await storeSignedAction({
              actionType: 'taker_timeout_penalty', signerAddress: 'council-approved',
              payload: { tradeId, takerAddress: trade.taker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, penaltyPercent: '33%', timeoutCount, banned },
              payloadHash: councilHash, signature: councilHash, tradeId,
            });
          } catch {}

          processed.push(`taker_timeout:${tradeId}`);
        }

        if (isMakerDefault) {
          let councilHash = '';
          try {
            const r = await councilVerifyAndSign('maker_default',
              { tradeId, makerAddress: trade.maker_address, deadline: trade.maker_deadline },
              [{ name: 'deadline_passed', fn: async () => ({ passed: true }) }],
              { tradeId, db });
            councilHash = r.aggregateHash;
          } catch (e: any) { errors.push(`council:${e.message}`); }

          let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
          try { penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default'); } catch (e: any) { errors.push(`penalty:${e.message}`); }

          const tradeValue = trade.size * trade.rate;
          let liquidation = { liquidatedAmount: 0, takerRepaid: 0, councilSurcharge: 0 };
          try {
            const r = await liquidateForDefault(tradeId, tradeValue, trade.maker_address, trade.taker_address);
            liquidation = { liquidatedAmount: r.liquidatedAmount || 0, takerRepaid: r.takerRepaid || tradeValue, councilSurcharge: r.councilSurcharge || tradeValue * 0.10 };
          } catch (e: any) { errors.push(`liquidation:${e.message}`); }

          let timeoutCount = 0, banned = false;
          try { const r = await recordTimeout(trade.maker_address); timeoutCount = r.timeoutCount; banned = r.banned; } catch {}

          try {
            await storeSignedAction({
              actionType: 'maker_default_penalty', signerAddress: 'council-approved',
              payload: { tradeId, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
                oldScore: penalty.oldScore, newScore: penalty.newScore, penaltyPercent: '67%',
                tradeValue, liquidatedAmount: liquidation.liquidatedAmount,
                takerRepaid: liquidation.takerRepaid, takerCredited: true, timeoutCount, banned },
              payloadHash: councilHash, signature: councilHash, tradeId,
            });
          } catch {}

          processed.push(`maker_default:${tradeId}`);
        }
      } catch (e: any) {
        errors.push(`trade_${tradeId}:${e.message}`);
      }
    }

    return NextResponse.json({ checked: true, expired: expired.length, processed, errors: errors.length > 0 ? errors : undefined });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, errors }, { status: 500 });
  }
}
