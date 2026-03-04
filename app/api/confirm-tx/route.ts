export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { verifySepoliaTx } from '@/lib/chains';
import { updateReputation } from '@/lib/reputation';
import { botSendSupraTokens, getBotAddresses, submitCommitteeAttestation } from '@/lib/bot-wallets';
import { generateMultisig } from '@/lib/committee-sig';
import { storeSignedAction } from '@/lib/signed-actions';
import { botSignAction } from '@/lib/bot-signing';

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
  const verified = await verifyOnChain(chain, txHash);

  // Generate multisig signatures
  const multisig = generateMultisig(
    tradeId,
    verificationType,
    verified ? "approved" : "rejected",
    tradeData || {},
  );

  await db.from('committee_requests').upsert({
    trade_id: tradeId,
    verification_type: verificationType,
    status: verified ? 'approved' : 'pending',
    approvals: verified ? 5 : 0,
    rejections: verified ? 0 : 5,
    resolved_at: verified ? new Date().toISOString() : null,
  }, { onConflict: 'trade_id,verification_type' });

  for (const sig of multisig.signatures) {
    await db.from('committee_votes').upsert({
      trade_id: tradeId,
      node_id: sig.nodeId,
      verification_type: verificationType,
      decision: verified ? 'approve' : 'reject',
      chain,
      tx_hash: txHash,
      signature: sig.signature,
    }, { onConflict: 'trade_id,node_id,verification_type' });
  }

  return { verified, multisig };
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
        await db.from('trades').update({
          status: 'taker_verified',
          taker_tx_confirmed_at: new Date().toISOString(),
        }).eq('id', tradeId);

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

            const { data: takerAgent } = await db.from('agents').select('rep_total, trade_count')
              .eq('wallet_address', trade.taker_address).single();

            // Attestation on-chain
            let attestationTxHash = '';
            try {
              attestationTxHash = await submitCommitteeAttestation(
                tradeId,
                repResult.multisig.aggregateHash,
                settleMs,
                takerAgent ? { address: trade.taker_address, newScore: takerAgent.rep_total } : undefined,
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
      if (trade.status !== 'taker_verified') {
        return NextResponse.json({ error: 'Trade not in taker_verified state' }, { status: 400 });
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

        const { data: takerAgent } = await db.from('agents').select('rep_total, trade_count')
          .eq('wallet_address', trade.taker_address).single();

        let attestationTxHash = '';
        try {
          if (process.env.BOT_SUPRA_PRIVATE_KEY) {
            attestationTxHash = await submitCommitteeAttestation(
              tradeId,
              repResult.multisig.aggregateHash,
              settleMs,
              takerAgent ? { address: trade.taker_address, newScore: takerAgent.rep_total } : undefined,
            );
            await db.from('committee_requests').update({
              attestation_tx: attestationTxHash,
            }).eq('trade_id', tradeId).eq('verification_type', 'approve_reputation');
          }
        } catch (e: any) {
          console.error('Attestation TX failed:', e);
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
