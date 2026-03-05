/**
 * Settlement Council Node Engine
 * 
 * Simulates 5 independent council nodes that:
 * - Process events and cast votes
 * - Track their own view of each trade's state
 * - Manage independent timers for deadlines
 * - Build and sign attestations when trades reach terminal states
 * 
 * In production: each node would be a separate server.
 * For now: one function simulates all 5 acting independently.
 */

import { getServiceClient } from './supabase';

const COUNCIL_NODES = ['N-1', 'N-2', 'N-3', 'N-4', 'N-5'];
const THRESHOLD = 3;
const TAKER_DEADLINE_MS = 1 * 60 * 1000;  // 1 min for testing (production: 30 min)
const MAKER_DEADLINE_MS = 1 * 60 * 1000;  // 1 min for testing (production: 30 min)

// =====================================================
// HASHING UTILITIES
// =====================================================

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalize(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function computePayloadHash(payload: any): Promise<string> {
  return sha256(canonicalize(payload));
}

async function computeEventHash(eventType: string, payloadHash: string, previousEventHash: string | null, sequence: number): Promise<string> {
  return sha256(`${eventType}:${payloadHash}:${previousEventHash || 'genesis'}:${sequence}`);
}

async function computeVoteHash(eventHash: string, nodeId: string, decision: string): Promise<string> {
  return sha256(`${eventHash}:${nodeId}:${decision}`);
}

async function computeChainHash(eventHashes: string[]): Promise<string> {
  return sha256(eventHashes.join('+'));
}

// Generate a node signature (simulated ECDSA — deterministic for now)
async function nodeSign(nodeId: string, message: string): Promise<string> {
  return sha256(`SupraFX:${nodeId}:sign:${message}`);
}

// =====================================================
// EARMARK COMPUTATION (derived from event chain)
// =====================================================

/**
 * Compute a maker's committed capital by walking the event chain.
 * Active earmarks = quote_registered consensus amounts
 *   MINUS released (quote_withdrawn, rfq_cancelled, match_confirmed for losing quotes,
 *                   taker_timed_out, maker_tx_verified, maker_defaulted)
 */
async function computeMakerEarmarks(db: any, makerAddress: string): Promise<{ totalEarmarked: number; earmarkDetails: Array<{ rfqId: string; quoteId: string; amount: number; status: string }> }> {
  // Get all quote_registered events for this maker that reached consensus
  const { data: quoteEvents } = await db.from('council_event_chain')
    .select('id, rfq_id, payload, consensus_reached, consensus_decision, sequence_number')
    .eq('event_type', 'quote_registered')
    .eq('consensus_reached', true)
    .eq('consensus_decision', 'approved')
    .order('created_at', { ascending: true });

  if (!quoteEvents?.length) return { totalEarmarked: 0, earmarkDetails: [] };

  const earmarks: Array<{ rfqId: string; quoteId: string; amount: number; status: string }> = [];

  for (const evt of quoteEvents) {
    const payload = evt.payload;
    if (payload.makerAddress !== makerAddress) continue;

    const quoteId = payload.quoteId;
    const rfqId = evt.rfq_id;
    const notional = (payload.size || 0) * (payload.rate || 0);
    if (notional <= 0) continue;

    // Check if this earmark has been released by a subsequent event
    const { data: laterEvents } = await db.from('council_event_chain')
      .select('event_type, payload, consensus_reached')
      .eq('rfq_id', rfqId)
      .eq('consensus_reached', true)
      .gt('sequence_number', evt.sequence_number);

    let status = 'active';
    for (const later of laterEvents || []) {
      // Quote withdrawn by this maker
      if (later.event_type === 'quote_withdrawn' && later.payload?.quoteId === quoteId) {
        status = 'released_withdrawn';
        break;
      }
      // RFQ cancelled
      if (later.event_type === 'rfq_cancelled') {
        status = 'released_cancelled';
        break;
      }
      // Match confirmed — release if this quote was NOT the winning one
      if (later.event_type === 'match_confirmed') {
        if (later.payload?.quoteId !== quoteId) {
          status = 'released_not_matched';
        }
        // If this IS the winning quote, check for settlement or timeout
        if (later.payload?.quoteId === quoteId) {
          // Check for terminal events
          for (const term of laterEvents || []) {
            if (term.event_type === 'maker_tx_verified') { status = 'released_settled'; break; }
            if (term.event_type === 'taker_timed_out') { status = 'released_taker_timeout'; break; }
            if (term.event_type === 'maker_defaulted') { status = 'liquidated'; break; }
          }
        }
        break;
      }
    }

    earmarks.push({ rfqId, quoteId, amount: notional, status });
  }

  const totalEarmarked = earmarks
    .filter(e => e.status === 'active')
    .reduce((sum, e) => sum + e.amount, 0);

  return { totalEarmarked, earmarkDetails: earmarks };
}

/**
 * Check if a maker has sufficient vault capacity for a quote.
 * Returns { eligible, availableCapacity, matchingLimit, totalEarmarked }
 */
async function checkMakerCapacity(db: any, makerAddress: string, notionalValue: number): Promise<{
  eligible: boolean;
  availableCapacity: number;
  matchingLimit: number;
  vaultBalance: number;
  totalEarmarked: number;
  reason?: string;
}> {
  // Get vault balance
  const { data: vaultRow } = await db.from('vault_balances')
    .select('total_deposited, available, matching_limit, committed')
    .eq('maker_address', makerAddress)
    .single();

  const vaultBalance = Number(vaultRow?.total_deposited || 0);
  const matchingLimit = Number(vaultRow?.matching_limit || vaultBalance * 0.9);

  // Compute active earmarks from event chain
  const { totalEarmarked } = await computeMakerEarmarks(db, makerAddress);

  const availableCapacity = matchingLimit - totalEarmarked;

  if (vaultBalance <= 0) {
    return { eligible: false, availableCapacity: 0, matchingLimit: 0, vaultBalance, totalEarmarked, reason: 'No security deposit' };
  }
  if (availableCapacity < notionalValue) {
    return { eligible: false, availableCapacity, matchingLimit, vaultBalance, totalEarmarked, reason: `Insufficient capacity: need ${notionalValue.toFixed(2)}, available ${availableCapacity.toFixed(2)}` };
  }

  return { eligible: true, availableCapacity, matchingLimit, vaultBalance, totalEarmarked };
}

// =====================================================
// CORE: PROCESS AN EVENT
// =====================================================

export interface ProcessEventResult {
  eventId: string;
  eventHash: string;
  consensusReached: boolean;
  consensusDecision: 'approved' | 'rejected' | 'pending';
  approvals: number;
  rejections: number;
  votes: Array<{ nodeId: string; decision: string; signature: string; reason?: string }>;
}

/**
 * Process a new event in the council event chain.
 * All 5 nodes independently verify and vote.
 * Returns consensus result.
 */
export async function processEvent(
  eventType: string,
  payload: any,
  rfqId: string,
  tradeId?: string | null,
  checks?: Array<{ name: string; fn: () => Promise<{ passed: boolean; reason?: string }> }>,
): Promise<ProcessEventResult> {
  const db = getServiceClient();
  const now = new Date();

  // Get the previous event in the chain for this RFQ
  const { data: prevEvent } = await db.from('council_event_chain')
    .select('event_hash, sequence_number')
    .eq('rfq_id', rfqId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .single();

  const sequence = (prevEvent?.sequence_number || 0) + 1;
  const previousEventHash = prevEvent?.event_hash || null;

  // Compute hashes
  const payloadHash = await computePayloadHash(payload);
  const eventHash = await computeEventHash(eventType, payloadHash, previousEventHash, sequence);

  // Determine deadline if this event sets one
  let deadline: string | null = null;
  let deadlineType: string | null = null;
  if (eventType === 'match_confirmed') {
    deadline = new Date(now.getTime() + TAKER_DEADLINE_MS).toISOString();
    deadlineType = 'taker_send';
  } else if (eventType === 'taker_tx_verified') {
    deadline = new Date(now.getTime() + MAKER_DEADLINE_MS).toISOString();
    deadlineType = 'maker_send';
  }

  // Create the event in the chain
  const { data: event, error: eventErr } = await db.from('council_event_chain').insert({
    rfq_id: rfqId,
    trade_id: tradeId || null,
    event_type: eventType,
    sequence_number: sequence,
    payload,
    payload_hash: payloadHash,
    previous_event_hash: previousEventHash,
    event_hash: eventHash,
    deadline,
    deadline_type: deadlineType,
  }).select('id').single();

  if (eventErr) {
    // Sequence conflict — event already exists (race condition)
    // Fetch the existing event
    const { data: existing } = await db.from('council_event_chain')
      .select('id, event_hash, consensus_reached')
      .eq('rfq_id', rfqId).eq('sequence_number', sequence).single();
    if (existing) {
      const { data: existingVotes } = await db.from('council_node_votes_v2')
        .select('node_id, decision, signature').eq('event_id', existing.id);
      return {
        eventId: existing.id,
        eventHash: existing.event_hash,
        consensusReached: existing.consensus_reached,
        approvals: (existingVotes || []).filter((v: any) => v.decision === 'approve').length,
        rejections: (existingVotes || []).filter((v: any) => v.decision === 'reject').length,
        votes: (existingVotes || []).map((v: any) => ({ nodeId: v.node_id, decision: v.decision, signature: v.signature, reason: v.reason })),
        consensusDecision: existing.consensus_reached ? 'approved' : 'pending',
      };
    }
    throw new Error(`Failed to create event: ${eventErr.message}`);
  }

  const eventId = event.id;

  // Each node votes independently
  const votes: Array<{ nodeId: string; decision: string; signature: string; reason?: string }> = [];
  let approvals = 0;
  let rejections = 0;

  for (const nodeId of COUNCIL_NODES) {
    let decision = 'approve';
    let reason: string | undefined;

    // Auto-add vault capacity check for quote_registered
    const allChecks = [...(checks || [])];
    if (eventType === 'quote_registered' && payload.makerAddress && payload.rate && payload.makerAddress !== 'auto-maker-bot') {
      const rfqSize = payload.size || 0;
      const quoteRate = payload.rate || 0;
      const notional = rfqSize * quoteRate;
      if (notional > 0) {
        allChecks.push({
          name: 'vault_capacity',
          fn: async () => {
            const cap = await checkMakerCapacity(db, payload.makerAddress, notional);
            return {
              passed: cap.eligible,
              reason: cap.reason || undefined,
            };
          },
        });
      }
    }

    // Auto-add vault capacity check for match_confirmed (re-verify at match time)
    if (eventType === 'match_confirmed' && payload.makerAddress && payload.rate && payload.size && payload.makerAddress !== 'auto-maker-bot') {
      const notional = payload.size * payload.rate;
      allChecks.push({
        name: 'vault_capacity_at_match',
        fn: async () => {
          const cap = await checkMakerCapacity(db, payload.makerAddress, notional);
          return {
            passed: cap.eligible,
            reason: cap.reason || undefined,
          };
        },
      });
    }

    // Run checks
    for (const check of allChecks) {
      try {
        const result = await check.fn();
        if (!result.passed) {
          decision = 'reject';
          reason = result.reason || check.name;
          break;
        }
      } catch (e: any) {
        decision = 'reject';
        reason = e.message;
        break;
      }
    }

    const voteHash = await computeVoteHash(eventHash, nodeId, decision);
    const signature = await nodeSign(nodeId, voteHash);

    // Store the vote
    await db.from('council_node_votes_v2').insert({
      event_id: eventId,
      trade_id: tradeId || null,
      rfq_id: rfqId,
      event_type: eventType,
      event_hash: eventHash,
      node_id: nodeId,
      decision,
      reason,
      vote_hash: voteHash,
      signature,
    });

    if (decision === 'approve') approvals++;
    else rejections++;

    votes.push({ nodeId, decision, signature, reason });

    // Update this node's view
    await db.from('council_node_views').upsert({
      node_id: nodeId,
      rfq_id: rfqId,
      trade_id: tradeId || null,
      current_phase: eventType,
      latest_event_hash: eventHash,
      latest_sequence: sequence,
      taker_deadline: deadlineType === 'taker_send' ? deadline : undefined,
      maker_deadline: deadlineType === 'maker_send' ? deadline : undefined,
      updated_at: now.toISOString(),
    }, { onConflict: 'node_id,rfq_id' });
  }

  // Check consensus — both approval and rejection require majority
  const approvalConsensus = approvals >= THRESHOLD;
  const rejectionConsensus = rejections >= THRESHOLD;
  const consensusReached = approvalConsensus || rejectionConsensus;
  const consensusDecision = approvalConsensus ? 'approved' : rejectionConsensus ? 'rejected' : 'pending';

  if (consensusReached) {
    await db.from('council_event_chain').update({
      consensus_reached: true,
      consensus_decision: consensusDecision,
      consensus_at: now.toISOString(),
    }).eq('id', eventId);
  }

  // Update node views with votes seen
  for (const nodeId of COUNCIL_NODES) {
    const { data: view } = await db.from('council_node_views')
      .select('votes_seen_per_event, consensus_confirmed_per_event')
      .eq('node_id', nodeId).eq('rfq_id', rfqId).single();

    const votesSeen = view?.votes_seen_per_event || {};
    const consensusConfirmed = view?.consensus_confirmed_per_event || {};

    // Each node "sees" all votes (simulated — in production they'd receive broadcasts)
    votesSeen[eventHash] = votes.filter(v => v.decision === 'approve').map(v => v.nodeId);
    consensusConfirmed[eventHash] = approvalConsensus;

    await db.from('council_node_views').update({
      votes_seen_per_event: votesSeen,
      consensus_confirmed_per_event: consensusConfirmed,
    }).eq('node_id', nodeId).eq('rfq_id', rfqId);
  }

  // Also write to legacy committee tables for backward compatibility
  if (tradeId) {
    await db.from('committee_requests').upsert({
      trade_id: tradeId,
      verification_type: eventType,
      status: consensusDecision,
      approvals,
      rejections,
      threshold: THRESHOLD,
      resolved_at: now.toISOString(),
    }, { onConflict: 'trade_id,verification_type' });

    for (const vote of votes) {
      try {
        await db.from('committee_votes').insert({
          trade_id: tradeId,
          node_id: vote.nodeId,
          verification_type: eventType,
          decision: vote.decision,
          chain: '',
          tx_hash: '',
          signature: vote.signature,
        });
      } catch {} // ignore duplicates
    }
  }

  return { eventId, eventHash, consensusReached, consensusDecision, approvals, rejections, votes };
}

// =====================================================
// DEADLINE CHECKING
// =====================================================

/**
 * Check all trades for expired deadlines.
 * Each node independently evaluates and votes on timeouts.
 */
export async function checkDeadlines(): Promise<string[]> {
  const db = getServiceClient();
  const now = new Date();
  const processed: string[] = [];

  // Find events with expired deadlines where no timeout event exists yet
  const { data: expiredEvents } = await db.from('council_event_chain')
    .select('*')
    .eq('consensus_reached', true)
    .not('deadline', 'is', null)
    .lt('deadline', now.toISOString())
    .in('deadline_type', ['taker_send', 'maker_send']);

  for (const event of expiredEvents || []) {
    // Check if a timeout or verification event already exists at the next sequence
    const nextSeq = event.sequence_number + 1;
    const { data: nextEvent } = await db.from('council_event_chain')
      .select('id, event_type')
      .eq('rfq_id', event.rfq_id)
      .eq('sequence_number', nextSeq)
      .single();

    if (nextEvent) continue; // Already handled (either verified or timed out)

    // Determine timeout type
    const isTrakerTimeout = event.deadline_type === 'taker_send';
    const timeoutType = isTrakerTimeout ? 'taker_timed_out' : 'maker_defaulted';

    // Get trade info
    const tradeId = event.trade_id;
    if (!tradeId) continue;

    const { data: trade } = await db.from('trades').select('*').eq('id', tradeId).single();
    if (!trade) continue;

    // Verify trade is still in the right status
    const expectedStatus = isTrakerTimeout ? 'open' : 'taker_verified';
    if (trade.status !== expectedStatus) continue;

    // Atomic claim on the trade status
    const targetStatus = isTrakerTimeout ? 'taker_timed_out' : 'maker_defaulted';
    const { data: claimed } = await db.from('trades')
      .update({ status: targetStatus })
      .eq('id', tradeId).eq('status', expectedStatus).select('id');
    if (!claimed?.length) continue;

    // Build timeout payload
    const partyAddress = isTrakerTimeout ? trade.taker_address : trade.maker_address;
    const payload: any = {
      tradeId, party: partyAddress,
      deadline: event.deadline,
      expiredAt: now.toISOString(),
      type: timeoutType,
    };

    if (!isTrakerTimeout) {
      const tradeValue = trade.size * trade.rate;
      payload.tradeValue = tradeValue;
      payload.penaltyPercent = '67%';
    } else {
      payload.penaltyPercent = '33%';
    }

    // Process the timeout event through the council
    const result = await processEvent(timeoutType, payload, event.rfq_id, tradeId);

    if (result.consensusReached) {
      // Apply penalty
      const { applyTimeoutPenalty } = await import('./reputation');
      const penaltyType = isTrakerTimeout ? 'taker_timeout' : 'maker_default';
      await applyTimeoutPenalty(partyAddress, penaltyType as any);

      // Earmark / liquidation
      if (isTrakerTimeout) {
        const { releaseEarmark } = await import('./vault');
        const { data: q } = await db.from('quotes')
          .select('id').eq('rfq_id', trade.rfq_id).eq('status', 'accepted').single();
        if (q) await releaseEarmark(q.id, 'taker_timed_out');
      } else {
        const { liquidateForDefaultWithAuth } = await import('./vault');
        const tradeValue = trade.size * trade.rate;
        await liquidateForDefaultWithAuth(tradeId, tradeValue, trade.maker_address, trade.taker_address, result.eventHash);
      }

      // Record timeout
      const { recordTimeout } = await import('./vault');
      await recordTimeout(partyAddress);

      // Store in signed_actions for audit trail
      const { storeSignedAction } = await import('./signed-actions');
      await storeSignedAction({
        actionType: `council_${timeoutType}`,
        signerAddress: 'council-approved',
        payload: { ...payload, councilEventHash: result.eventHash, consensus: `${result.approvals}/${result.rejections}` },
        payloadHash: result.eventHash,
        signature: result.eventHash,
        tradeId,
        rfqId: event.rfq_id,
      });

      // Build attestation (posts to Supra internally)
      try {
        await buildAttestation(event.rfq_id, tradeId, timeoutType);
      } catch (e: any) { console.error('[Council] Attestation error:', e.message); }

      processed.push(`${timeoutType}:${tradeId}`);
    }
  }

  return processed;
}

// =====================================================
// ATTESTATION
// =====================================================

/**
 * Build and sign attestation for a completed trade.
 * Each node verifies the full chain and its vote coverage before signing.
 */
export async function buildAttestation(
  rfqId: string,
  tradeId: string,
  outcome: string,
): Promise<{ chainHash: string; attestationId: string; signatures: number; attestationTxHash?: string } | null> {
  const db = getServiceClient();

  // Load the full event chain
  const { data: events } = await db.from('council_event_chain')
    .select('*')
    .eq('rfq_id', rfqId)
    .order('sequence_number', { ascending: true });

  if (!events?.length) return null;

  // Verify chain integrity
  for (let i = 0; i < events.length; i++) {
    if (i === 0 && events[i].previous_event_hash !== null) return null;
    if (i > 0 && events[i].previous_event_hash !== events[i - 1].event_hash) return null;
  }

  // Compute chain hash
  const eventHashes = events.map(e => e.event_hash);
  const chainHash = await computeChainHash(eventHashes);

  // Each node checks if it has seen 3+ votes on every event
  const nodeSignatures: Array<{ nodeId: string; signature: string; signedAt: string }> = [];

  for (const nodeId of COUNCIL_NODES) {
    const { data: view } = await db.from('council_node_views')
      .select('consensus_confirmed_per_event')
      .eq('node_id', nodeId).eq('rfq_id', rfqId).single();

    if (!view) continue;

    const confirmed = view.consensus_confirmed_per_event || {};
    let allConfirmed = true;
    for (const event of events) {
      if (!confirmed[event.event_hash]) {
        allConfirmed = false;
        break;
      }
    }

    if (allConfirmed) {
      const sig = await nodeSign(nodeId, chainHash);
      nodeSignatures.push({ nodeId, signature: sig, signedAt: new Date().toISOString() });
    }
  }

  if (nodeSignatures.length < THRESHOLD) return null;

  // Build event summary (no signatures, just facts)
  const eventSummary = events.map(e => ({
    eventType: e.event_type,
    sequence: e.sequence_number,
    payloadHash: e.payload_hash,
    eventHash: e.event_hash,
    consensusAt: e.consensus_at,
  }));

  // Store attestation
  const { data: att } = await db.from('council_attestations').insert({
    trade_id: tradeId,
    rfq_id: rfqId,
    chain_hash: chainHash,
    event_summary: eventSummary,
    outcome,
    node_signatures: nodeSignatures,
  }).select('id').single();

  const attestationId = att?.id || '';

  // Post chain hash to Supra blockchain
  let attestationTxHash = '';
  try {
    if (process.env.BOT_SUPRA_PRIVATE_KEY) {
      const { submitCommitteeAttestation } = await import('./bot-wallets');
      attestationTxHash = await submitCommitteeAttestation(tradeId, chainHash);
      if (attestationTxHash && attestationId) {
        await db.from('council_attestations').update({
          attestation_tx_hash: attestationTxHash,
          posted_to_chain: true,
          posted_at: new Date().toISOString(),
        }).eq('id', attestationId);
      }
      console.log('[Council] Attestation posted to Supra:', attestationTxHash);
    }
  } catch (e: any) {
    console.error('[Council] Supra post error:', e.message);
  }

  return {
    chainHash,
    attestationId,
    signatures: nodeSignatures.length,
    attestationTxHash,
  };
}

// =====================================================
// GET EVENT CHAIN (for UI / audit trail)
// =====================================================

export async function getEventChain(rfqId: string) {
  const db = getServiceClient();

  const { data: events } = await db.from('council_event_chain')
    .select('*')
    .eq('rfq_id', rfqId)
    .order('sequence_number', { ascending: true });

  const { data: votes } = await db.from('council_node_votes_v2')
    .select('*')
    .eq('rfq_id', rfqId)
    .order('created_at', { ascending: true });

  return {
    events: events || [],
    votes: votes || [],
  };
}
