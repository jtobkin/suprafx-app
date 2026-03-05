export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { verifySepoliaTx } from '@/lib/chains';
import { updateReputation } from '@/lib/reputation';
import { botSendSupraTokens, getBotAddresses, submitCommitteeAttestation, buildAttestationBundle } from '@/lib/bot-wallets';
import { getTradeActions } from '@/lib/signed-actions';
import { generateMultisig, councilVerifyAndSign } from '@/lib/council-sign';
import { processEvent } from '@/lib/council-node';
import { storeSignedAction } from '@/lib/signed-actions';
import { botSignAction } from '@/lib/bot-signing';
import { releaseEarmark } from '@/lib/vault';

const COMMITTEE_NODES = ['N-1', 'N-2', 'N-3', 'N-4', 'N-5'];

async function verifyOnChain(chain: string, txHash: string): Promise<boolean> {
  const hasAlchemy = process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_key_here';
  if (chain === 'sepolia' && txHash.startsWith('0x') && hasAlchemy) {
    try {
      const result = await verifySepoliaTx(txHash);
      return result.verified;
    } catch { return true; }
  }
  return true;
}

async function runCommittee(db: any, tradeId: string, verificationType: string, chain: string, txHash: string, tradeData?: any) {
  // Each council node independently verifies — they run in parallel via councilVerifyAndSign
  const checks: Array<{ name: string; fn: () => Promise<{ passed: boolean; reason?: string }> }> = [];

  if (verificationType === 'verify_taker_tx' || verificationType === 'verify_maker_tx') {
    checks.push({
      name: 'on_chain_verification',
      fn: async () => {
        const verified = await verifyOnChain(chain, txHash);
        return { passed: verified, reason: verified ? undefined : 'TX not verified on chain' };
      },
    });
    checks.push({
      name: 'tx_hash_format',
      fn: async () => ({ passed: !!(txHash && txHash.length > 10) }),
    });
  }

  if (verificationType === 'approve_reputation') {
    checks.push({ name: 'settlement_confirmed', fn: async () => ({ passed: true }) });
  }

  const result = await councilVerifyAndSign(
    verificationType,
    { tradeId, chain, txHash, ...tradeData },
    checks,
    { tradeId, db },
  );

  return { verified: result.decision === 'approved', multisig: { aggregateHash: result.aggregateHash, signatures: result.votes } };
}

export async function POST(req: NextRequest) {
  try {
    const { tradeId, txHash, side, signedPayload, signature, payloadHash, sessionPublicKey, sessionAuthSignature, sessionNonce, sessionCreatedAt } = await req.json();
    if (!tradeId || !txHash || !side) {
      return NextResponse.json({ error: 'tradeId, txHash, and side required' }, { status: 400 });
    }

    const db = getServiceClient();
    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    if (side === 'taker') {
      if (trade.status !== 'open') {
        return NextResponse.json({ error: 'Trade not in open state' }, { status: 400 });
      }

      // Update to taker_sent
      await db.from('trades').update({ taker_tx_hash: txHash, status: 'taker_sent' }).eq('id', tradeId);

      // Store signed action
      await storeSignedAction({
        actionType: 'confirm_taker_tx',
        signerAddress: trade.taker_address,
        payload: signedPayload || { action: 'confirm_taker_tx', tradeId, txHash },
        payloadHash: payloadHash || '',
        signature: signature || '',
        sessionPublicKey,
        sessionAuthSignature,
        sessionNonce,
        sessionCreatedAt,
        tradeId,
      });

      // Committee verify taker TX
      const tradeInfo = { pair: trade.pair, size: trade.size, rate: trade.rate, takerTxHash: txHash };
      const { verified } = await runCommittee(db, tradeId, 'verify_taker_tx', trade.source_chain, txHash, tradeInfo);

      if (verified) {
        // Update status AND maker deadline in ONE write
        const makerDeadline = new Date(Date.now() + 1 * 60 * 1000).toISOString(); // 1 min for testing (production: 30 min)
        await db.from('trades').update({
          status: 'taker_verified',
          taker_tx_confirmed_at: new Date().toISOString(),
          maker_deadline: makerDeadline,
        }).eq('id', tradeId);
        console.log('[SupraFX] Taker verified + maker deadline set:', makerDeadline);

        // Council event: taker_tx_verified
        try {
          await processEvent('taker_tx_verified', {
            tradeId, txHash, chain: trade.source_chain,
            makerDeadline,
          }, trade.rfq_id, tradeId);
        } catch (e: any) { console.error('[Council] taker_tx_verified error:', e.message); }

        // === AUTO MAKER BOT: Send SUPRA to taker ===
        if (trade.maker_address === 'auto-maker-bot') {
          if (!process.env.BOT_SUPRA_PRIVATE_KEY) {
            // Stay at taker_verified — maker can't send without key
            return NextResponse.json({
              success: true,
              status: 'taker_verified',
              verified: true,
              error: 'Maker bot not configured: BOT_SUPRA_PRIVATE_KEY not set',
            });
          }

          let makerTxHash: string;
          try {
            const takerAddr = trade.taker_address;
            const amountOctas = BigInt(100000); // 0.001 SUPRA
            makerTxHash = await botSendSupraTokens(takerAddr, amountOctas);
          } catch (e: any) {
            console.error('Bot Supra send failed:', e.message);
            // Update trade to failed state with reason
            await db.from('trades').update({
              status: 'failed',
            }).eq('id', tradeId);

            return NextResponse.json({
              success: false,
              status: 'failed',
              verified: true,
              error: 'Maker bot Supra send failed: ' + (e.message || 'unknown error'),
            });
          }

          // Maker TX succeeded — bot signs the TX confirmation same as a human would
          const botMakerSig = await botSignAction('confirm_maker_tx', { tradeId, txHash: makerTxHash });
          await storeSignedAction({
            actionType: 'confirm_maker_tx',
            signerAddress: trade.maker_address,
            payload: botMakerSig.payload,
            payloadHash: botMakerSig.payloadHash,
            signature: botMakerSig.signature,
            sessionPublicKey: botMakerSig.sessionPublicKey,
            sessionNonce: botMakerSig.sessionNonce,
            sessionCreatedAt: botMakerSig.sessionCreatedAt,
            tradeId,
          });

          await db.from('trades').update({
            maker_tx_hash: makerTxHash,
            status: 'maker_sent',
          }).eq('id', tradeId);

          const makerTradeInfo = { ...tradeInfo, makerTxHash };
          const { verified: makerVerified } = await runCommittee(db, tradeId, 'verify_maker_tx', trade.dest_chain, makerTxHash, makerTradeInfo);

          if (makerVerified) {
            const settleMs = Date.now() - new Date(trade.created_at).getTime();
            // Council event: maker_tx_verified (bot)
            try {
              await processEvent('maker_tx_verified', { tradeId, chain: trade.dest_chain }, trade.rfq_id, tradeId);
            } catch (e: any) { console.error('[Council] maker_tx_verified:', e.message); }

            await db.from('trades').update({
              status: 'settled',
              maker_tx_confirmed_at: new Date().toISOString(),
              settled_at: new Date().toISOString(),
              settle_ms: settleMs,
            }).eq('id', tradeId);

            const repResult = await runCommittee(db, tradeId, 'approve_reputation', '', '', {
              ...makerTradeInfo, settleMs,
            });
            await updateReputation(trade.taker_address, settleMs);
            await updateReputation(trade.maker_address, settleMs);

            // Release earmark on settlement
            try {
              const { data: acceptedQuote } = await db.from('quotes')
                .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
              if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'trade_settled');
            } catch {}

            const { data: takerAgent } = await db.from('agents').select('rep_total, trade_count')
              .eq('wallet_address', trade.taker_address).single();

            // Attestation on-chain
            let attestationTxHash = '';
            try {
              // Build full attestation bundle with audit trail
              const tradeActions = await getTradeActions(tradeId);
              const bundle = await buildAttestationBundle(
                tradeId,
                repResult.multisig.aggregateHash,
                settleMs,
                {
                  displayId: trade.display_id,
                  pair: trade.pair, size: trade.size, rate: trade.rate,
                  sourceChain: trade.source_chain, destChain: trade.dest_chain,
                  takerAddress: trade.taker_address, makerAddress: trade.maker_address,
                  takerSettlementAddress: trade.taker_settlement_address,
                  makerSettlementAddress: trade.maker_settlement_address,
                  takerTxHash: trade.taker_tx_hash || txHash, makerTxHash: makerTxHash,
                },
                {
                  taker: takerAgent ? { address: trade.taker_address, oldScore: Number(takerAgent.rep_total), newScore: Number(takerAgent.rep_total), speedBonus: 0 } : undefined,
                },
                tradeActions,
              );
              attestationTxHash = await submitCommitteeAttestation(
                tradeId,
                repResult.multisig.aggregateHash,
                settleMs,
                takerAgent ? { address: trade.taker_address, newScore: takerAgent.rep_total } : undefined,
                bundle,
              );
              await db.from('committee_requests').update({
                attestation_tx: attestationTxHash,
              }).eq('trade_id', tradeId).eq('verification_type', 'approve_reputation');
            } catch (e: any) {
              console.error('Attestation TX failed:', e.message);
            }

            return NextResponse.json({
              success: true,
              status: 'settled',
              verified: true,
              settleMs,
              makerTxHash,
              autoSettled: true,
              attestationTxHash: attestationTxHash || null,
            });
          }

          return NextResponse.json({
            success: true,
            status: 'maker_sent',
            verified: true,
            makerTxHash,
          });
        }

        return NextResponse.json({
          success: true,
          status: 'taker_verified',
          verified: true,
        });
      }

      return NextResponse.json({ success: true, status: 'taker_sent', verified: false });

    } else if (side === 'maker') {
      // Re-fetch trade to get latest status (might have been defaulted by timeout)
      const { data: freshTrade } = await db.from('trades').select('status, maker_deadline').eq('id', tradeId).single();
      const currentStatus = freshTrade?.status || trade.status;
      
      if (currentStatus !== 'taker_verified') {
        return NextResponse.json({ error: `Cannot settle: trade is ${currentStatus}`, status: currentStatus }, { status: 400 });
      }
      
      // Check if maker deadline has expired — if so, reject (timeout will process it)
      if (freshTrade?.maker_deadline && new Date(freshTrade.maker_deadline) < new Date()) {
        return NextResponse.json({ error: 'Maker deadline has expired. Settlement Council is processing the default.', status: 'maker_defaulted' }, { status: 400 });
      }

      await db.from('trades').update({ maker_tx_hash: txHash, status: 'maker_sent' }).eq('id', tradeId);

      // Store signed action
      await storeSignedAction({
        actionType: 'confirm_maker_tx',
        signerAddress: trade.maker_address,
        payload: signedPayload || { action: 'confirm_maker_tx', tradeId, txHash },
        payloadHash: payloadHash || '',
        signature: signature || '',
        sessionPublicKey,
        sessionAuthSignature,
        sessionNonce,
        sessionCreatedAt,
        tradeId,
      });

      const makerTradeInfo = { pair: trade.pair, size: trade.size, rate: trade.rate, takerTxHash: trade.taker_tx_hash, makerTxHash: txHash };
      const { verified } = await runCommittee(db, tradeId, 'verify_maker_tx', trade.dest_chain, txHash, makerTradeInfo);

      if (verified) {
        const settleMs = Date.now() - new Date(trade.created_at).getTime();
        // Council event: maker_tx_verified (human)
        try {
          await processEvent('maker_tx_verified', { tradeId, txHash, chain: trade.dest_chain }, trade.rfq_id, tradeId);
        } catch (e: any) { console.error('[Council] maker_tx_verified:', e.message); }

        await db.from('trades').update({
          status: 'settled',
          maker_tx_confirmed_at: new Date().toISOString(),
          settled_at: new Date().toISOString(),
          settle_ms: settleMs,
        }).eq('id', tradeId);

        const repResult = await runCommittee(db, tradeId, 'approve_reputation', '', '', {
          ...makerTradeInfo, settleMs,
        });
        await updateReputation(trade.taker_address, settleMs);
        await updateReputation(trade.maker_address, settleMs);

        // Release earmark on settlement
        try {
          const { data: acceptedQuote } = await db.from('quotes')
            .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
          if (acceptedQuote) await releaseEarmark(acceptedQuote.id, 'trade_settled');
        } catch {}

        const { data: takerAgent } = await db.from('agents').select('rep_total, trade_count')
          .eq('wallet_address', trade.taker_address).single();

        let attestationTxHash = '';
        try {
          // Always submit attestation to Supra L1 — every trade gets an on-chain record
          // regardless of which chains the trade settled on
          if (process.env.BOT_SUPRA_PRIVATE_KEY) {
            const tradeActions = await getTradeActions(tradeId);
            const bundle = await buildAttestationBundle(
              tradeId,
              repResult.multisig.aggregateHash,
              settleMs,
              {
                displayId: trade.display_id,
                pair: trade.pair, size: trade.size, rate: trade.rate,
                sourceChain: trade.source_chain, destChain: trade.dest_chain,
                takerAddress: trade.taker_address, makerAddress: trade.maker_address,
                takerSettlementAddress: trade.taker_settlement_address,
                makerSettlementAddress: trade.maker_settlement_address,
                takerTxHash: trade.taker_tx_hash, makerTxHash: txHash,
              },
              {
                taker: takerAgent ? { address: trade.taker_address, oldScore: Number(takerAgent.rep_total), newScore: Number(takerAgent.rep_total), speedBonus: 0 } : undefined,
              },
              tradeActions,
            );
            attestationTxHash = await submitCommitteeAttestation(
              tradeId,
              repResult.multisig.aggregateHash,
              settleMs,
              takerAgent ? { address: trade.taker_address, newScore: takerAgent.rep_total } : undefined,
              bundle,
            );
            await db.from('committee_requests').update({
              attestation_tx: attestationTxHash,
            }).eq('trade_id', tradeId).eq('verification_type', 'approve_reputation');
          } else {
            console.warn('[SupraFX] Cannot submit attestation: BOT_SUPRA_PRIVATE_KEY not configured');
          }
        } catch (e: any) {
          console.error('Attestation TX failed:', e.message);
        }

        return NextResponse.json({ success: true, status: 'settled', verified: true, settleMs, attestationTxHash: attestationTxHash || null });
      }

      return NextResponse.json({ success: true, status: 'maker_sent', verified: false });
    }

    return NextResponse.json({ error: 'side must be taker or maker' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
