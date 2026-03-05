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
// CORE: PROCESS AN EVENT
// =====================================================

export interface ProcessEventResult {
  eventId: string;
  eventHash: string;
  consensusReached: boolean;
  approvals: number;
  rejections: number;
  votes: Array<{ nodeId: string; decision: string; signature: string }>;
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
        votes: (existingVotes || []).map((v: any) => ({ nodeId: v.node_id, decision: v.decision, signature: v.signature })),
      };
    }
    throw new Error(`Failed to create event: ${eventErr.message}`);
  }

  const eventId = event.id;

  // Each node votes independently
  const votes: Array<{ nodeId: string; decision: string; signature: string }> = [];
  let approvals = 0;
  let rejections = 0;

  for (const nodeId of COUNCIL_NODES) {
    let decision = 'approve';
    let reason: string | undefined;

    // Run checks if provided
    if (checks) {
      for (const check of checks) {
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

    votes.push({ nodeId, decision, signature });

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

  // Check consensus
  const consensusReached = approvals >= THRESHOLD;
  if (consensusReached) {
    await db.from('council_event_chain').update({
      consensus_reached: true,
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
    consensusConfirmed[eventHash] = (votesSeen[eventHash]?.length || 0) >= THRESHOLD;

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
      status: consensusReached ? 'approved' : 'rejected',
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

  return { eventId, eventHash, consensusReached, approvals, rejections, votes };
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
): Promise<{ chainHash: string; attestationId: string; signatures: number } | null> {
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

  return {
    chainHash,
    attestationId: att?.id || '',
    signatures: nodeSignatures.length,
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
