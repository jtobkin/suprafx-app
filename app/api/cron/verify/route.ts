import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { runCommitteeVerification, runReputationApproval } from '@/lib/committee';
import { updateReputation } from '@/lib/reputation';

// This runs on a schedule (Vercel Cron) or can be called manually
export async function GET() {
  const db = getServiceClient();
  const results: any[] = [];

  // 1. Verify taker transactions (status = 'taker_sent')
  const { data: takerPending } = await db
    .from('trades')
    .select('*')
    .eq('status', 'taker_sent')
    .not('taker_tx_hash', 'is', null);

  for (const trade of takerPending || []) {
    const result = await runCommitteeVerification(
      trade.id, 'verify_taker_tx', trade.source_chain, trade.taker_tx_hash
    );
    if (result.approved) {
      await db.from('trades').update({
        status: 'taker_verified',
        taker_tx_confirmed_at: new Date().toISOString(),
      }).eq('id', trade.id);
    }
    results.push({ tradeId: trade.id, type: 'verify_taker_tx', ...result });
  }

  // 2. Verify maker transactions (status = 'maker_sent')
  const { data: makerPending } = await db
    .from('trades')
    .select('*')
    .eq('status', 'maker_sent')
    .not('maker_tx_hash', 'is', null);

  for (const trade of makerPending || []) {
    const result = await runCommitteeVerification(
      trade.id, 'verify_maker_tx', trade.dest_chain, trade.maker_tx_hash
    );
    if (result.approved) {
      const settleMs = Date.now() - new Date(trade.created_at).getTime();
      await db.from('trades').update({
        status: 'settled',
        maker_tx_confirmed_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
        settle_ms: settleMs,
      }).eq('id', trade.id);

      // Reputation update
      await runReputationApproval(trade.id);
      await updateReputation(trade.taker_address, settleMs);
      await updateReputation(trade.maker_address, settleMs);
    }
    results.push({ tradeId: trade.id, type: 'verify_maker_tx', ...result });
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
