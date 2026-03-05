export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

/**
 * Lightweight deadline check — called by the server every 30 seconds.
 * If any trades have expired deadlines, triggers the timeout-trade endpoint
 * for each one. This ensures timeouts process even if no client is watching.
 */
export async function GET() {
  const db = getServiceClient();
  const now = new Date().toISOString();
  const processed: string[] = [];

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

    // Process each expired trade
    // Use the internal timeout logic directly to avoid HTTP overhead
    const { councilVerifyAndSign } = await import('@/lib/council-sign');
    const { applyTimeoutPenalty } = await import('@/lib/reputation');
    const { releaseEarmark, liquidateForDefault, recordTimeout } = await import('@/lib/vault');
    const { storeSignedAction } = await import('@/lib/signed-actions');

    for (const { id: tradeId } of expired) {
      const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
      if (!trade) continue;

      if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < new Date()) {
        // Atomic claim: only proceed if we successfully flip the status
        const { data: claimed } = await db.from('trades')
          .update({ status: 'taker_timed_out' })
          .eq('id', tradeId)
          .eq('status', 'open')  // Only if still open (prevents races)
          .select('id')
          .single();
        if (!claimed) continue; // Another process already handled it

        const result = await councilVerifyAndSign(
          'taker_timeout',
          { tradeId, takerAddress: trade.taker_address, deadline: trade.taker_deadline },
          [
            { name: 'deadline_passed', fn: async () => ({ passed: true }) },
            { name: 'status_is_open', fn: async () => ({ passed: trade.status === 'open' }) },
          ],
          { tradeId, db },
        );

        if (result.decision === 'approved') {
          // Status already claimed above
          const penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');

          const { data: acceptedQuote } = await db.from('quotes')
            .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
          if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'taker_timed_out');

          const { timeoutCount, banned } = await recordTimeout(trade.taker_address);

          await storeSignedAction({
            actionType: 'taker_timeout_penalty',
            signerAddress: 'council-approved',
            payload: { tradeId, takerAddress: trade.taker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, penaltyPercent: '33%', timeoutCount, banned },
            payloadHash: result.aggregateHash,
            signature: result.aggregateHash,
            tradeId,
          });

          processed.push(`taker_timeout:${tradeId}`);
        }
      }

      if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < new Date()) {
        // Atomic claim
        const { data: claimed2 } = await db.from('trades')
          .update({ status: 'maker_defaulted' })
          .eq('id', tradeId)
          .eq('status', 'taker_verified')
          .select('id')
          .single();
        if (!claimed2) continue;

        const result = await councilVerifyAndSign(
          'maker_default',
          { tradeId, makerAddress: trade.maker_address, deadline: trade.maker_deadline },
          [
            { name: 'deadline_passed', fn: async () => ({ passed: true }) },
            { name: 'status_is_taker_verified', fn: async () => ({ passed: trade.status === 'taker_verified' }) },
          ],
          { tradeId, db },
        );

        if (result.decision === 'approved') {
          // Status already claimed above
          const penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');
          const tradeValue = trade.size * trade.rate;
          const liquidation = await liquidateForDefault(tradeId, tradeValue, trade.maker_address, trade.taker_address);
          const { timeoutCount, banned } = await recordTimeout(trade.maker_address);

          await storeSignedAction({
            actionType: 'maker_default_penalty',
            signerAddress: 'council-approved',
            payload: { tradeId, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
              oldScore: penalty.oldScore, newScore: penalty.newScore, penaltyPercent: '67%',
              tradeValue, liquidatedAmount: liquidation.liquidatedAmount,
              takerRepaid: liquidation.takerRepaid || tradeValue, takerCredited: true, timeoutCount, banned },
            payloadHash: result.aggregateHash,
            signature: result.aggregateHash,
            tradeId,
          });

          processed.push(`maker_default:${tradeId}`);
        }
      }
    }

    return NextResponse.json({ checked: true, expired: expired.length, processed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
