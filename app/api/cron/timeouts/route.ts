export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { updateReputation } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefault, recordTimeout } from '@/lib/vault';

const TAKER_DEADLINE_MINUTES = 30;
const MAKER_DEADLINE_MINUTES = 30;

export async function GET() {
  const db = getServiceClient();
  const now = new Date();
  const results: string[] = [];

  try {
    // === Check taker timeouts ===
    // Trades in 'open' status where taker_deadline has passed
    const { data: takerTimeouts } = await db.from('trades')
      .select('*')
      .eq('status', 'open')
      .not('taker_deadline', 'is', null)
      .lt('taker_deadline', now.toISOString());

    for (const trade of takerTimeouts || []) {
      // Council signs the timeout
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
        await db.from('trades').update({
          status: 'taker_timed_out',
        }).eq('id', trade.id);

        // Reputation penalty: -33%
        // -33% penalty handled by settleMs=null path
        await updateReputation(trade.taker_address, null);

        // Release maker earmark
        const { data: acceptedQuote } = await db.from('quotes')
          .select('id')
          .eq('rfq_id', trade.rfq_id)
          .eq('status', 'accepted')
          .single();

        if (acceptedQuote) {
          await releaseEarmark(acceptedQuote.id, 'taker_timed_out');
        }

        // Record timeout and check for ban
        const { timeoutCount, banned } = await recordTimeout(trade.taker_address);

        results.push(`Taker timeout: ${trade.id} (${timeoutCount}/3 this month${banned ? ', BANNED' : ''})`);
      }
    }

    // === Check maker defaults ===
    // Trades in 'taker_verified' status where maker_deadline has passed
    const { data: makerDefaults } = await db.from('trades')
      .select('*')
      .eq('status', 'taker_verified')
      .not('maker_deadline', 'is', null)
      .lt('maker_deadline', now.toISOString());

    for (const trade of makerDefaults || []) {
      // Council signs the default
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
        // Update trade status
        await db.from('trades').update({
          status: 'maker_defaulted',
        }).eq('id', trade.id);

        // Reputation penalty: -67%
        // -67% penalty handled by settleMs=null path
        await updateReputation(trade.maker_address, null);

        // Liquidate maker deposit, repay taker
        const tradeValue = trade.size * trade.rate;
        await liquidateForDefault(trade.id, tradeValue, trade.maker_address, trade.taker_address);

        results.push(`Maker default: ${trade.id}, liquidated ${tradeValue}`);
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
