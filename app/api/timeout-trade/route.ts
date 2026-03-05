export const dynamic = 'force-dynamic';
export const maxDuration = 15; // Request 15s on Pro plan

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

    log.push(`status=${trade.status}`);

    // Determine timeout type
    let timeoutType: 'taker_timeout' | 'maker_default' | null = null;
    let partyAddress = '';

    // Taker timeout: status open + taker_deadline expired
    if (trade.status === 'open' && trade.taker_deadline && new Date(trade.taker_deadline) < now) {
      timeoutType = 'taker_timeout';
      partyAddress = trade.taker_address;
    }
    // Maker default: status taker_verified + maker_deadline expired
    if (trade.status === 'taker_verified' && trade.maker_deadline && new Date(trade.maker_deadline) < now) {
      timeoutType = 'maker_default';
      partyAddress = trade.maker_address;
    }
    // Recovery: status already flipped but council hasn't signed yet
    if (trade.status === 'taker_timed_out' && !timeoutType) {
      timeoutType = 'taker_timeout';
      partyAddress = trade.taker_address;
      log.push('Recovery: status already taker_timed_out');
    }
    if (trade.status === 'maker_defaulted' && !timeoutType) {
      timeoutType = 'maker_default';
      partyAddress = trade.maker_address;
      log.push('Recovery: status already maker_defaulted');
    }

    if (!timeoutType) {
      return NextResponse.json({ processed: false, reason: 'No timeout condition', status: trade.status, log });
    }

    // Already fully processed? Check for council signature in audit trail
    const { data: existing } = await db.from('signed_actions')
      .select('id').eq('trade_id', tradeId)
      .in('action_type', ['council_taker_timeout', 'council_maker_default']).limit(1);
    if (existing?.length) {
      return NextResponse.json({ processed: true, reason: 'Already processed by Council', log });
    }

    // === SINGLE COUNCIL VOTE — authorizes everything ===
    const councilResult = await councilVerifyAndSign(
      timeoutType,
      { tradeId, party: partyAddress, pair: trade.pair, size: trade.size, rate: trade.rate },
      [{ name: 'deadline_expired', fn: async () => ({ passed: true }) }],
      { tradeId, db },
    );
    if (councilResult.decision !== 'approved') {
      return NextResponse.json({ processed: false, reason: 'Council rejected', log });
    }
    const councilHash = councilResult.aggregateHash;
    log.push(`Council approved: ${councilHash.slice(0, 12)}...`);

    // === FLIP STATUS (if not already) ===
    const targetStatus = timeoutType === 'taker_timeout' ? 'taker_timed_out' : 'maker_defaulted';
    if (trade.status !== targetStatus) {
      await db.from('trades').update({ status: targetStatus }).eq('id', tradeId);
      log.push(`Status → ${targetStatus}`);
    }

    // === PENALTY ===
    const penalty = await applyTimeoutPenalty(partyAddress, timeoutType);
    log.push(`Penalty: ${penalty.oldScore.toFixed(2)} → ${penalty.newScore.toFixed(2)}`);

    // === EARMARK RELEASE / LIQUIDATION (no second council vote) ===
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
        liquidation = await liquidateForDefaultWithAuth(tradeId, tradeValue, trade.maker_address, trade.taker_address, councilHash);
        log.push(`Liquidated: ${liquidation.liquidatedAmount}`);
      } catch (e: any) { log.push(`Liquidation err: ${e.message}`); }
    }

    // === TIMEOUT COUNT ===
    const { timeoutCount, banned } = await recordTimeout(partyAddress);
    log.push(`Timeouts: ${timeoutCount}/3`);

    // === AUDIT TRAIL ===
    const actionType = timeoutType === 'taker_timeout' ? 'council_taker_timeout' : 'council_maker_default';
    await storeSignedAction({
      actionType,
      signerAddress: 'council-approved',
      payload: {
        decision: timeoutType, tradeId, party: partyAddress,
        penalty: { old: penalty.oldScore, new: penalty.newScore },
        liquidation: liquidation.liquidatedAmount ? { amount: liquidation.liquidatedAmount, takerRepaid: liquidation.takerRepaid } : undefined,
        timeoutCount, banned, councilHash,
      },
      payloadHash: councilHash,
      signature: councilHash,
      tradeId,
    });
    log.push('Audit stored');

    // === ATTESTATION (fire and forget — don't block response) ===
    // The attestation runs after we return the response
    const attestationPromise = (async () => {
      try {
        if (!process.env.BOT_SUPRA_PRIVATE_KEY) return;
        const { submitCommitteeAttestation, buildAttestationBundle } = await import('@/lib/bot-wallets');
        const { getTradeActions } = await import('@/lib/signed-actions');
        const tradeActions = await getTradeActions(tradeId);
        const bundle = await buildAttestationBundle(tradeId, councilHash, undefined,
          { displayId: trade.display_id, pair: trade.pair, size: trade.size, rate: trade.rate,
            sourceChain: trade.source_chain, destChain: trade.dest_chain,
            takerAddress: trade.taker_address, makerAddress: trade.maker_address },
          {}, tradeActions);
        bundle.type = timeoutType + '_attestation';
        bundle.penalty = { old: penalty.oldScore, new: penalty.newScore };
        await submitCommitteeAttestation(tradeId, councilHash, undefined, undefined, bundle);
      } catch (e: any) { console.error('[Timeout] Attestation:', e.message); }
    })();
    // Don't await — let it run in background
    attestationPromise.catch(() => {});

    log.push('DONE');
    return NextResponse.json({ processed: true, type: timeoutType, councilHash, penalty, liquidation, timeoutCount, banned, log });
  } catch (e: any) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ error: e.message, log }, { status: 500 });
  }
}
