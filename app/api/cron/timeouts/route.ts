export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefault, recordTimeout } from '@/lib/vault';
import { storeSignedAction } from '@/lib/signed-actions';

export async function GET() {
  const db = getServiceClient();
  const now = new Date();
  const results: string[] = [];

  try {
    // === Check taker timeouts ===
    const { data: takerTimeouts } = await db.from('trades')
      .select('*')
      .eq('status', 'open')
      .not('taker_deadline', 'is', null)
      .lt('taker_deadline', now.toISOString());

    for (const trade of takerTimeouts || []) {
      const councilResult = await councilVerifyAndSign(
        'taker_timeout',
        { tradeId: trade.id, takerAddress: trade.taker_address, deadline: trade.taker_deadline },
        [
          { name: 'deadline_passed', fn: async () => ({ passed: new Date(trade.taker_deadline) < now }) },
          { name: 'status_is_open', fn: async () => ({ passed: trade.status === 'open' }) },
        ],
        { tradeId: trade.id, db },
      );

      if (councilResult.decision === 'approved') {
        // Update trade status
        await db.from('trades').update({ status: 'taker_timed_out' }).eq('id', trade.id);

        // Apply -33% reputation penalty
        const penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');

        // Release maker earmark
        const { data: acceptedQuote } = await db.from('quotes')
          .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
        if (acceptedQuote) {
          await releaseEarmark(acceptedQuote.id, 'taker_timed_out');
        }

        // Record timeout and check for ban
        const { timeoutCount, banned } = await recordTimeout(trade.taker_address);

        // Store penalty details in signed_actions for the audit trail
        await storeSignedAction({
          actionType: 'taker_timeout_penalty',
          signerAddress: 'council-approved',
          payload: {
            tradeId: trade.id,
            takerAddress: trade.taker_address,
            oldScore: penalty.oldScore,
            newScore: penalty.newScore,
            penaltyAmount: penalty.penaltyAmount,
            penaltyPercent: '33%',
            timeoutCount,
            banned,
            earmarkReleased: !!acceptedQuote,
          },
          payloadHash: councilResult.aggregateHash,
          signature: councilResult.aggregateHash,
          tradeId: trade.id,
        });

        results.push(`Taker timeout: ${trade.id}, rep ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)} (-33%), timeouts ${timeoutCount}/3${banned ? ' BANNED' : ''}`);
      }
    }

    // === Check maker defaults ===
    const { data: makerDefaults } = await db.from('trades')
      .select('*')
      .eq('status', 'taker_verified')
      .not('maker_deadline', 'is', null)
      .lt('maker_deadline', now.toISOString());

    for (const trade of makerDefaults || []) {
      const councilResult = await councilVerifyAndSign(
        'maker_default',
        { tradeId: trade.id, makerAddress: trade.maker_address, deadline: trade.maker_deadline },
        [
          { name: 'deadline_passed', fn: async () => ({ passed: new Date(trade.maker_deadline) < now }) },
          { name: 'status_is_taker_verified', fn: async () => ({ passed: trade.status === 'taker_verified' }) },
        ],
        { tradeId: trade.id, db },
      );

      if (councilResult.decision === 'approved') {
        await db.from('trades').update({ status: 'maker_defaulted' }).eq('id', trade.id);

        // Apply -67% reputation penalty
        const penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');

        // Liquidate maker deposit, repay taker
        const tradeValue = trade.size * trade.rate;
        const liquidation = await liquidateForDefault(
          trade.id, tradeValue, trade.maker_address, trade.taker_address
        );

        // Record timeout
        const { timeoutCount, banned } = await recordTimeout(trade.maker_address);

        // Store penalty + liquidation details for audit trail
        await storeSignedAction({
          actionType: 'maker_default_penalty',
          signerAddress: 'council-approved',
          payload: {
            tradeId: trade.id,
            makerAddress: trade.maker_address,
            takerAddress: trade.taker_address,
            oldScore: penalty.oldScore,
            newScore: penalty.newScore,
            penaltyAmount: penalty.penaltyAmount,
            penaltyPercent: '67%',
            tradeValue,
            liquidatedAmount: liquidation.liquidatedAmount,
            takerRepaid: liquidation.takerRepaid || tradeValue,
            surchargeToCouncil: liquidation.councilSurcharge || tradeValue * 0.10,
            takerCredited: true,
            timeoutCount,
            banned,
          },
          payloadHash: councilResult.aggregateHash,
          signature: councilResult.aggregateHash,
          tradeId: trade.id,
        });

        results.push(`Maker default: ${trade.id}, rep ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)} (-67%), liquidated ${liquidation.liquidatedAmount}, taker repaid ${liquidation.takerRepaid || tradeValue}, council surcharge ${liquidation.councilSurcharge || tradeValue * 0.10}`);
      }
    }

    return NextResponse.json({
      checked: true,
      timestamp: now.toISOString(),
      takerTimeouts: takerTimeouts?.length || 0,
      makerDefaults: makerDefaults?.length || 0,
      actions: results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
