export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefault, recordTimeout } from '@/lib/vault';
import { storeSignedAction, getTradeActions } from '@/lib/signed-actions';

export async function POST(req: NextRequest) {
  try {
    const { tradeId } = await req.json();
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

    const db = getServiceClient();
    const now = new Date();

    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    // === Taker timeout ===
    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      // Atomic claim — only one process can flip this
      const { data: claimed, error: claimErr } = await db.from('trades')
        .update({ status: 'taker_timed_out' })
        .eq('id', tradeId)
        .eq('status', 'open')
        .select('id');

      if (claimErr || !claimed?.length) {
        return NextResponse.json({ processed: false, reason: 'Could not claim trade (already processed or error)', claimErr: claimErr?.message });
      }

      // Council signs the timeout
      let councilHash = '';
      try {
        const councilResult = await councilVerifyAndSign(
          'taker_timeout',
          { tradeId, takerAddress: trade.taker_address, deadline: trade.taker_deadline },
          [{ name: 'deadline_passed', fn: async () => ({ passed: true }) }],
          { tradeId, db },
        );
        councilHash = councilResult.aggregateHash;
      } catch (e: any) {
        console.error('[Timeout] Council sign failed:', e.message);
      }

      // Apply penalty
      let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
      try {
        penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');
      } catch (e: any) {
        console.error('[Timeout] Penalty failed:', e.message);
      }

      // Release earmark
      try {
        const { data: acceptedQuote } = await db.from('quotes')
          .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
        if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'taker_timed_out');
      } catch (e: any) {
        console.error('[Timeout] Earmark release failed:', e.message);
      }

      // Record timeout count
      let timeoutCount = 0;
      let banned = false;
      try {
        const result = await recordTimeout(trade.taker_address);
        timeoutCount = result.timeoutCount;
        banned = result.banned;
      } catch (e: any) {
        console.error('[Timeout] Record timeout failed:', e.message);
      }

      // Audit trail
      try {
        await storeSignedAction({
          actionType: 'taker_timeout_penalty',
          signerAddress: 'council-approved',
          payload: {
            tradeId, takerAddress: trade.taker_address,
            oldScore: penalty.oldScore, newScore: penalty.newScore,
            penaltyPercent: '33%', timeoutCount, banned,
          },
          payloadHash: councilHash,
          signature: councilHash,
          tradeId,
        });
      } catch (e: any) {
        console.error('[Timeout] Audit trail failed:', e.message);
      }

      // On-chain attestation
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const { submitCommitteeAttestation, buildAttestationBundle } = await import('@/lib/bot-wallets');
          const tradeActions = await getTradeActions(tradeId);
          const bundle = await buildAttestationBundle(
            tradeId, councilHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address },
            { taker: { address: trade.taker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'taker_timeout_attestation';
          bundle.timeout = { party: 'taker', penaltyPercent: '33%', oldScore: penalty.oldScore, newScore: penalty.newScore, timeoutCount, banned };
          await submitCommitteeAttestation(tradeId, councilHash, undefined, undefined, bundle);
        }
      } catch (e: any) {
        console.error('[Timeout] Attestation failed:', e.message);
      }

      return NextResponse.json({
        processed: true, type: 'taker_timeout',
        penalty: { oldScore: penalty.oldScore, newScore: penalty.newScore, percent: '33%' },
        timeoutCount, banned,
      });
    }

    // === Maker default ===
    if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      const { data: claimed, error: claimErr } = await db.from('trades')
        .update({ status: 'maker_defaulted' })
        .eq('id', tradeId)
        .eq('status', 'taker_verified')
        .select('id');

      if (claimErr || !claimed?.length) {
        return NextResponse.json({ processed: false, reason: 'Could not claim trade', claimErr: claimErr?.message });
      }

      let councilHash = '';
      try {
        const councilResult = await councilVerifyAndSign(
          'maker_default',
          { tradeId, makerAddress: trade.maker_address, deadline: trade.maker_deadline },
          [{ name: 'deadline_passed', fn: async () => ({ passed: true }) }],
          { tradeId, db },
        );
        councilHash = councilResult.aggregateHash;
      } catch (e: any) {
        console.error('[Timeout] Council sign failed:', e.message);
      }

      let penalty = { oldScore: 0, newScore: 0, penaltyAmount: 0 };
      try {
        penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');
      } catch (e: any) {
        console.error('[Timeout] Penalty failed:', e.message);
      }

      const tradeValue = trade.size * trade.rate;
      let liquidation = { liquidatedAmount: 0, takerRepaid: 0, councilSurcharge: 0 };
      try {
        const result = await liquidateForDefault(tradeId, tradeValue, trade.maker_address, trade.taker_address);
        liquidation = { liquidatedAmount: result.liquidatedAmount || 0, takerRepaid: result.takerRepaid || tradeValue, councilSurcharge: result.councilSurcharge || tradeValue * 0.10 };
      } catch (e: any) {
        console.error('[Timeout] Liquidation failed:', e.message);
      }

      let timeoutCount = 0;
      let banned = false;
      try {
        const result = await recordTimeout(trade.maker_address);
        timeoutCount = result.timeoutCount;
        banned = result.banned;
      } catch (e: any) {
        console.error('[Timeout] Record timeout failed:', e.message);
      }

      try {
        await storeSignedAction({
          actionType: 'maker_default_penalty',
          signerAddress: 'council-approved',
          payload: {
            tradeId, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
            oldScore: penalty.oldScore, newScore: penalty.newScore, penaltyPercent: '67%',
            tradeValue, liquidatedAmount: liquidation.liquidatedAmount,
            takerRepaid: liquidation.takerRepaid, takerCredited: true, timeoutCount, banned,
          },
          payloadHash: councilHash,
          signature: councilHash,
          tradeId,
        });
      } catch (e: any) {
        console.error('[Timeout] Audit trail failed:', e.message);
      }

      // On-chain attestation
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const { submitCommitteeAttestation, buildAttestationBundle } = await import('@/lib/bot-wallets');
          const tradeActions = await getTradeActions(tradeId);
          const bundle = await buildAttestationBundle(
            tradeId, councilHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address,
              takerTxHash: trade.taker_tx_hash },
            { maker: { address: trade.maker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'maker_default_attestation';
          bundle.default = { party: 'maker', penaltyPercent: '67%', oldScore: penalty.oldScore, newScore: penalty.newScore,
            liquidatedAmount: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid, timeoutCount, banned };
          await submitCommitteeAttestation(tradeId, councilHash, undefined, undefined, bundle);
        }
      } catch (e: any) {
        console.error('[Timeout] Attestation failed:', e.message);
      }

      return NextResponse.json({
        processed: true, type: 'maker_default',
        penalty: { oldScore: penalty.oldScore, newScore: penalty.newScore, percent: '67%' },
        liquidated: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid,
        timeoutCount, banned,
      });
    }

    return NextResponse.json({ processed: false, reason: 'Deadline not expired or wrong status', status: trade.status, taker_deadline: trade.taker_deadline, maker_deadline: trade.maker_deadline });
  } catch (e: any) {
    console.error('[Timeout] Top-level error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
