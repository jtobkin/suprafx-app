export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { councilVerifyAndSign } from '@/lib/council-sign';
import { applyTimeoutPenalty } from '@/lib/reputation';
import { releaseEarmark, liquidateForDefault, recordTimeout } from '@/lib/vault';
import { storeSignedAction, getTradeActions } from '@/lib/signed-actions';

export async function POST(req: NextRequest) {
  const log: string[] = [];

  try {
    const { tradeId } = await req.json();
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

    const db = getServiceClient();
    const now = new Date();

    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found', log }, { status: 404 });

    log.push(`Trade ${tradeId}, status: ${trade.status}`);

    // === TAKER TIMEOUT ===
    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {

      // Step 1: Council MUST approve before anything happens
      const councilResult = await councilVerifyAndSign(
        'taker_timeout',
        {
          tradeId, takerAddress: trade.taker_address, makerAddress: trade.maker_address,
          pair: trade.pair, size: trade.size, rate: trade.rate,
          deadline: trade.taker_deadline, expiredAt: now.toISOString(),
        },
        [
          { name: 'deadline_expired', fn: async () => ({ passed: new Date(trade.taker_deadline) < now }) },
          { name: 'trade_still_open', fn: async () => {
            const { data: fresh } = await db.from('trades').select('status').eq('id', tradeId).single();
            return { passed: fresh?.status === 'open', reason: fresh?.status !== 'open' ? 'Status already: ' + fresh?.status : undefined };
          }},
        ],
        { tradeId, db },
      );

      if (councilResult.decision !== 'approved') {
        log.push('Council REJECTED taker timeout');
        return NextResponse.json({ processed: false, reason: 'Council rejected', log });
      }
      log.push(`Council APPROVED: ${councilResult.aggregateHash.slice(0, 20)}...`);

      // Step 2: Atomic status update (only if still open)
      const { data: claimed } = await db.from('trades')
        .update({ status: 'taker_timed_out' })
        .eq('id', tradeId).eq('status', 'open').select('id');
      if (!claimed?.length) {
        log.push('Status already changed by another process');
        return NextResponse.json({ processed: false, reason: 'Already processed', log });
      }

      // Step 3: Apply penalty (Council-authorized)
      const penalty = await applyTimeoutPenalty(trade.taker_address, 'taker_timeout');
      log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);

      // Step 4: Release earmark
      const { data: acceptedQuote } = await db.from('quotes')
        .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
      if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'taker_timed_out');

      // Step 5: Record timeout + ban check (Council-authorized)
      const { timeoutCount, banned } = await recordTimeout(trade.taker_address);
      log.push(`Timeouts: ${timeoutCount}/3, banned: ${banned}`);

      // Step 6: Store Council-signed audit trail
      await storeSignedAction({
        actionType: 'council_taker_timeout',
        signerAddress: 'council-approved',
        payload: {
          decision: 'taker_timeout',
          tradeId, takerAddress: trade.taker_address,
          pair: trade.pair, size: trade.size, rate: trade.rate,
          oldScore: penalty.oldScore, newScore: penalty.newScore,
          penaltyPercent: '33%', timeoutCount, banned,
          councilHash: councilResult.aggregateHash,
          nodeVotes: councilResult.votes.map(v => ({ nodeId: v.nodeId, decision: v.decision, signature: v.signature.slice(0, 32) + '...' })),
        },
        payloadHash: councilResult.aggregateHash,
        signature: councilResult.aggregateHash,
        tradeId,
      });

      // Step 7: On-chain attestation
      let attestationTxHash = '';
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const { submitCommitteeAttestation, buildAttestationBundle } = await import('@/lib/bot-wallets');
          const tradeActions = await getTradeActions(tradeId);
          const bundle = await buildAttestationBundle(
            tradeId, councilResult.aggregateHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address },
            { taker: { address: trade.taker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'taker_timeout_attestation';
          bundle.councilDecision = { type: 'taker_timeout', hash: councilResult.aggregateHash, approvals: councilResult.approvals, rejections: councilResult.rejections };
          bundle.penalty = { party: 'taker', percent: '33%', oldScore: penalty.oldScore, newScore: penalty.newScore, timeoutCount, banned };
          attestationTxHash = await submitCommitteeAttestation(tradeId, councilResult.aggregateHash, undefined, undefined, bundle);
          log.push(`Attestation TX: ${attestationTxHash}`);
        }
      } catch (e: any) { log.push(`Attestation error (non-blocking): ${e.message}`); }

      return NextResponse.json({ processed: true, type: 'taker_timeout', councilHash: councilResult.aggregateHash, penalty, timeoutCount, banned, attestationTxHash, log });
    }

    // === MAKER DEFAULT ===
    if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {

      // Step 1: Council MUST approve
      const tradeValue = trade.size * trade.rate;
      const surcharge = tradeValue * 0.10;

      const councilResult = await councilVerifyAndSign(
        'maker_default',
        {
          tradeId, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
          pair: trade.pair, size: trade.size, rate: trade.rate, tradeValue, surcharge,
          deadline: trade.maker_deadline, expiredAt: now.toISOString(),
        },
        [
          { name: 'deadline_expired', fn: async () => ({ passed: new Date(trade.maker_deadline) < now }) },
          { name: 'trade_taker_verified', fn: async () => {
            const { data: fresh } = await db.from('trades').select('status').eq('id', tradeId).single();
            return { passed: fresh?.status === 'taker_verified', reason: fresh?.status !== 'taker_verified' ? 'Status: ' + fresh?.status : undefined };
          }},
          { name: 'taker_tx_verified', fn: async () => ({ passed: !!trade.taker_tx_hash }) },
        ],
        { tradeId, db },
      );

      if (councilResult.decision !== 'approved') {
        log.push('Council REJECTED maker default');
        return NextResponse.json({ processed: false, reason: 'Council rejected', log });
      }
      log.push(`Council APPROVED: ${councilResult.aggregateHash.slice(0, 20)}...`);

      // Step 2: Atomic status update
      const { data: claimed } = await db.from('trades')
        .update({ status: 'maker_defaulted' })
        .eq('id', tradeId).eq('status', 'taker_verified').select('id');
      if (!claimed?.length) {
        log.push('Status already changed');
        return NextResponse.json({ processed: false, reason: 'Already processed', log });
      }

      // Step 3: Penalty (Council-authorized)
      const penalty = await applyTimeoutPenalty(trade.maker_address, 'maker_default');
      log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);

      // Step 4: Liquidate + repay taker (Council-authorized)
      const liquidation = await liquidateForDefault(tradeId, tradeValue, trade.maker_address, trade.taker_address);
      log.push(`Liquidated: ${liquidation.liquidatedAmount}, taker repaid: ${liquidation.takerRepaid}`);

      // Step 5: Record timeout
      const { timeoutCount, banned } = await recordTimeout(trade.maker_address);
      log.push(`Timeouts: ${timeoutCount}/3, banned: ${banned}`);

      // Step 6: Council-signed audit trail
      await storeSignedAction({
        actionType: 'council_maker_default',
        signerAddress: 'council-approved',
        payload: {
          decision: 'maker_default',
          tradeId, makerAddress: trade.maker_address, takerAddress: trade.taker_address,
          pair: trade.pair, size: trade.size, rate: trade.rate,
          oldScore: penalty.oldScore, newScore: penalty.newScore,
          penaltyPercent: '67%', tradeValue,
          liquidatedAmount: liquidation.liquidatedAmount,
          takerRepaid: liquidation.takerRepaid,
          councilSurcharge: liquidation.councilSurcharge,
          timeoutCount, banned,
          councilHash: councilResult.aggregateHash,
          nodeVotes: councilResult.votes.map(v => ({ nodeId: v.nodeId, decision: v.decision, signature: v.signature.slice(0, 32) + '...' })),
        },
        payloadHash: councilResult.aggregateHash,
        signature: councilResult.aggregateHash,
        tradeId,
      });

      // Step 7: On-chain attestation
      let attestationTxHash = '';
      try {
        if (process.env.BOT_SUPRA_PRIVATE_KEY) {
          const { submitCommitteeAttestation, buildAttestationBundle } = await import('@/lib/bot-wallets');
          const tradeActions = await getTradeActions(tradeId);
          const bundle = await buildAttestationBundle(
            tradeId, councilResult.aggregateHash, undefined,
            { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
              sourceChain: trade.source_chain, destChain: trade.dest_chain,
              takerAddress: trade.taker_address, makerAddress: trade.maker_address,
              takerTxHash: trade.taker_tx_hash },
            { maker: { address: trade.maker_address, oldScore: penalty.oldScore, newScore: penalty.newScore, speedBonus: 0 } },
            tradeActions,
          );
          bundle.type = 'maker_default_attestation';
          bundle.councilDecision = { type: 'maker_default', hash: councilResult.aggregateHash, approvals: councilResult.approvals, rejections: councilResult.rejections };
          bundle.penalty = { party: 'maker', percent: '67%', oldScore: penalty.oldScore, newScore: penalty.newScore, timeoutCount, banned };
          bundle.liquidation = { amount: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid, councilSurcharge: liquidation.councilSurcharge };
          attestationTxHash = await submitCommitteeAttestation(tradeId, councilResult.aggregateHash, undefined, undefined, bundle);
          log.push(`Attestation TX: ${attestationTxHash}`);
        }
      } catch (e: any) { log.push(`Attestation error (non-blocking): ${e.message}`); }

      return NextResponse.json({ processed: true, type: 'maker_default', councilHash: councilResult.aggregateHash, penalty, liquidation, timeoutCount, banned, attestationTxHash, log });
    }

    log.push('No expired deadline');
    return NextResponse.json({ processed: false, status: trade.status, taker_deadline: trade.taker_deadline, maker_deadline: trade.maker_deadline, log });
  } catch (e: any) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
