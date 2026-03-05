export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefault, recordTimeout } from '@/lib/vault';
import { storeSignedAction, getTradeActions } from '@/lib/signed-actions';
import { submitCommitteeAttestation, buildAttestationBundle } from '@/lib/bot-wallets';

export async function POST(req: NextRequest) {
  const { tradeId } = await req.json();
  if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

  const db = getServiceClient();
  const now = new Date();

  const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  // === Taker timeout ===
  if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
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
      await db.from('trades').update({ status: 'taker_timed_out' }).eq('id', trade.id);

      const penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');

      const { data: acceptedQuote } = await db.from('quotes')
        .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
      if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'taker_timed_out');

      const { timeoutCount, banned } = await recordTimeout(trade.taker_address);

      await storeSignedAction({
        actionType: 'taker_timeout_penalty',
        signerAddress: 'council-approved',
        payload: {
          tradeId: trade.id, takerAddress: trade.taker_address,
          oldScore: penalty.oldScore, newScore: penalty.newScore,
          penaltyAmount: penalty.penaltyAmount, penaltyPercent: '33%',
          timeoutCount, banned, earmarkReleased: !!acceptedQuote,
        },
        payloadHash: councilResult.aggregateHash,
        signature: councilResult.aggregateHash,
        tradeId: trade.id,
      });

      // On-chain attestation
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const tradeActions = await getTradeActions(trade.id);
          const bundle = await buildAttestationBundle(
            trade.id, councilResult.aggregateHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address },
            { taker: { address: trade.taker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'taker_timeout_attestation';
          bundle.timeout = { party: 'taker', penaltyPercent: '33%', oldScore: penalty.oldScore, newScore: penalty.newScore, timeoutCount, banned };
          const attTxHash = await submitCommitteeAttestation(trade.id, councilResult.aggregateHash, undefined, undefined, bundle);
          await db.from('committee_requests').upsert({
            trade_id: trade.id, verification_type: 'taker_timeout_attestation',
            status: 'approved', approvals: 5, rejections: 0,
            resolved_at: now.toISOString(), attestation_tx: attTxHash,
          }, { onConflict: 'trade_id,verification_type' });
        }
      } catch (e: any) { console.error('[Timeout] Attestation failed:', e.message); }

      return NextResponse.json({
        processed: true, type: 'taker_timeout',
        penalty: { oldScore: penalty.oldScore, newScore: penalty.newScore, percent: '33%' },
        timeoutCount, banned,
      });
    }
  }

  // === Maker default ===
  if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
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

      const penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');
      const tradeValue = trade.size * trade.rate;
      const liquidation = await liquidateForDefault(trade.id, tradeValue, trade.maker_address, trade.taker_address);
      const { timeoutCount, banned } = await recordTimeout(trade.maker_address);

      await storeSignedAction({
        actionType: 'maker_default_penalty',
        signerAddress: 'council-approved',
        payload: {
          tradeId: trade.id, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
          oldScore: penalty.oldScore, newScore: penalty.newScore,
          penaltyAmount: penalty.penaltyAmount, penaltyPercent: '67%',
          tradeValue, liquidatedAmount: liquidation.liquidatedAmount,
          takerRepaid: liquidation.takerRepaid || tradeValue,
          surchargeToCouncil: liquidation.councilSurcharge || tradeValue * 0.10,
          takerCredited: true, timeoutCount, banned,
        },
        payloadHash: councilResult.aggregateHash,
        signature: councilResult.aggregateHash,
        tradeId: trade.id,
      });

      // On-chain attestation
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const tradeActions = await getTradeActions(trade.id);
          const bundle = await buildAttestationBundle(
            trade.id, councilResult.aggregateHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address,
              takerTxHash: trade.taker_tx_hash },
            { maker: { address: trade.maker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'maker_default_attestation';
          bundle.default = { party: 'maker', penaltyPercent: '67%', oldScore: penalty.oldScore, newScore: penalty.newScore,
            liquidatedAmount: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid || tradeValue,
            councilSurcharge: liquidation.councilSurcharge || tradeValue * 0.10, timeoutCount, banned };
          const attTxHash = await submitCommitteeAttestation(trade.id, councilResult.aggregateHash, undefined, undefined, bundle);
          await db.from('committee_requests').upsert({
            trade_id: trade.id, verification_type: 'maker_default_attestation',
            status: 'approved', approvals: 5, rejections: 0,
            resolved_at: now.toISOString(), attestation_tx: attTxHash,
          }, { onConflict: 'trade_id,verification_type' });
        }
      } catch (e: any) { console.error('[Timeout] Attestation failed:', e.message); }

      return NextResponse.json({
        processed: true, type: 'maker_default',
        penalty: { oldScore: penalty.oldScore, newScore: penalty.newScore, percent: '67%' },
        liquidated: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid || tradeValue,
        timeoutCount, banned,
      });
    }
  }

  return NextResponse.json({ processed: false, reason: 'Deadline not expired or wrong status' });
}
