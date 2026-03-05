/**
 * Vault Operations — Simulated via Database
 * 
 * In production: these operations would interact with an on-chain multisig vault.
 * For now: all operations are database records signed by the Settlement Council.
 * 
 * The Council co-signs every vault operation:
 * - Deposits, withdrawals, earmarks, releases, liquidations
 * - Balance updates always have a Council signature
 */

import { getServiceClient } from './supabase';
import { councilVerifyAndSign } from './council-sign';

const MATCHING_LIMIT_RATIO = 0.9; // 90% of available balance
const DEFAULT_SURCHARGE = 0.10;   // 10% surcharge on maker default

/**
 * Process a deposit into the vault (simulated).
 */
export async function processDeposit(
  makerAddress: string,
  amount: number,
  currency: 'USDC' | 'USDT' = 'USDC',
): Promise<{ success: boolean; balance?: any; error?: string }> {
  const db = getServiceClient();

  // Council verifies the deposit
  const councilResult = await councilVerifyAndSign(
    'vault_deposit',
    { makerAddress, amount, currency },
    [
      { name: 'amount_positive', fn: async () => ({ passed: amount > 0, reason: amount > 0 ? undefined : 'Amount must be positive' }) },
      { name: 'valid_currency', fn: async () => ({ passed: ['USDC', 'USDT'].includes(currency) }) },
    ],
    { db },
  );

  if (councilResult.decision !== 'approved') {
    return { success: false, error: 'Council rejected deposit' };
  }

  // Record the deposit
  const txHash = 'sim_deposit_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({
    maker_address: makerAddress,
    amount,
    currency,
    direction: 'deposit',
    tx_hash: txHash,
    council_signature: councilResult.aggregateHash,
    status: 'confirmed',
  });

  // Update balance
  const balance = await recalculateBalance(makerAddress);
  return { success: true, balance };
}

/**
 * Get the current vault balance for a maker.
 */
export async function getVaultBalance(makerAddress: string): Promise<{
  totalDeposited: number;
  committed: number;
  pendingWithdrawal: number;
  available: number;
  matchingLimit: number;
  currency: string;
} | null> {
  const db = getServiceClient();
  const { data } = await db.from('vault_balances')
    .select('*')
    .eq('maker_address', makerAddress)
    .single();

  if (!data) return null;

  return {
    totalDeposited: Number(data.total_deposited),
    committed: Number(data.committed),
    pendingWithdrawal: Number(data.pending_withdrawal),
    available: Number(data.available),
    matchingLimit: Number(data.matching_limit),
    currency: data.currency,
  };
}

/**
 * Get the matching limit (max value a maker can quote for).
 */
export async function getMatchingLimit(makerAddress: string): Promise<number> {
  const balance = await getVaultBalance(makerAddress);
  return balance?.matchingLimit || 0;
}

/**
 * Earmark balance when Council co-signs a quote.
 * Reduces available balance and matching limit immediately.
 */
export async function earmarkBalance(
  makerAddress: string,
  quoteId: string,
  amount: number,
  currency: string = 'USDC',
): Promise<{ success: boolean; earmarkId?: string; error?: string }> {
  const db = getServiceClient();

  // Check available balance
  const balance = await getVaultBalance(makerAddress);
  if (!balance || balance.matchingLimit < amount) {
    return { success: false, error: `Insufficient matching limit. Available: ${balance?.matchingLimit || 0}, Required: ${amount}` };
  }

  // Council verifies the earmark
  const councilResult = await councilVerifyAndSign(
    'earmark_balance',
    { makerAddress, quoteId, amount, currency, availableBalance: balance.available, matchingLimit: balance.matchingLimit },
    [
      { name: 'sufficient_balance', fn: async () => ({ passed: balance.matchingLimit >= amount }) },
      { name: 'amount_positive', fn: async () => ({ passed: amount > 0 }) },
    ],
    { quoteId, db },
  );

  if (councilResult.decision !== 'approved') {
    return { success: false, error: 'Council rejected earmark' };
  }

  // Create earmark
  const { data: earmark, error } = await db.from('earmarks').insert({
    quote_id: quoteId,
    maker_address: makerAddress,
    amount,
    currency,
    status: 'active',
    council_signature: councilResult.aggregateHash,
  }).select('id').single();

  if (error) return { success: false, error: error.message };

  // Recalculate balance
  await recalculateBalance(makerAddress);
  return { success: true, earmarkId: earmark.id };
}

/**
 * Release an earmark (quote withdrawn, rejected, trade settled, taker timed out).
 */
export async function releaseEarmark(
  quoteId: string,
  reason: 'quote_withdrawn' | 'rfq_cancelled' | 'quote_rejected' | 'trade_settled' | 'taker_timed_out',
): Promise<{ success: boolean }> {
  const db = getServiceClient();

  const { data: earmark } = await db.from('earmarks')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('status', 'active')
    .single();

  if (!earmark) return { success: true }; // Already released or doesn't exist

  await db.from('earmarks').update({
    status: 'released',
    release_reason: reason,
    released_at: new Date().toISOString(),
  }).eq('id', earmark.id);

  await recalculateBalance(earmark.maker_address);
  return { success: true };
}

/**
 * Liquidate a maker's deposit after default.
 * Trade value + 10% surcharge deducted.
 * Taker repaid the trade value.
 */
/**
 * Lightweight liquidation — uses an existing council authorization hash.
 * No second council vote. Called by timeout-trade which already has council approval.
 */
export async function liquidateForDefaultWithAuth(
  tradeId: string,
  tradeValue: number,
  makerAddress: string,
  takerAddress: string,
  councilHash: string,
  currency: string = 'USDC',
): Promise<{ success: boolean; liquidatedAmount?: number; takerRepaid?: number; councilSurcharge?: number; error?: string }> {
  const db = getServiceClient();
  const surcharge = tradeValue * DEFAULT_SURCHARGE;
  const totalDeducted = tradeValue + surcharge;

  // Liquidate the earmark
  const { data: earmark } = await db.from('earmarks')
    .select('*').eq('trade_id', tradeId).eq('status', 'active').single();
  if (earmark) {
    await db.from('earmarks').update({ status: 'liquidated', release_reason: 'maker_defaulted', released_at: new Date().toISOString() }).eq('id', earmark.id);
  }

  // Deduct from maker
  const txHash = 'sim_liquidation_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({ maker_address: makerAddress, amount: totalDeducted, currency, direction: 'withdrawal', tx_hash: txHash, council_signature: councilHash, status: 'completed' });

  // Credit taker
  const repayTxHash = 'sim_repayment_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({ maker_address: takerAddress, amount: tradeValue, currency, direction: 'deposit', tx_hash: repayTxHash, council_signature: councilHash, status: 'completed' });
  await recalculateBalance(takerAddress);

  // Council surcharge
  const surchargeTxHash = 'sim_surcharge_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({ maker_address: 'council-treasury', amount: surcharge, currency, direction: 'deposit', tx_hash: surchargeTxHash, council_signature: councilHash, status: 'completed' });

  await recalculateBalance(makerAddress);
  return { success: true, liquidatedAmount: totalDeducted, takerRepaid: tradeValue, councilSurcharge: surcharge };
}

export async function liquidateForDefault(
  tradeId: string,
  tradeValue: number,
  makerAddress: string,
  takerAddress: string,
  currency: string = 'USDC',
): Promise<{ success: boolean; liquidatedAmount?: number; takerRepaid?: number; councilSurcharge?: number; error?: string }> {
  const db = getServiceClient();

  const surcharge = tradeValue * DEFAULT_SURCHARGE;
  const totalDeducted = tradeValue + surcharge;

  // Council signs the liquidation
  const councilResult = await councilVerifyAndSign(
    'liquidate_default',
    { tradeId, makerAddress, takerAddress, tradeValue, surcharge, totalDeducted, currency },
    [
      { name: 'trade_value_positive', fn: async () => ({ passed: tradeValue > 0 }) },
      { name: 'maker_has_balance', fn: async () => {
        const bal = await getVaultBalance(makerAddress);
        return { passed: (bal?.totalDeposited || 0) > 0, reason: 'Maker has no vault balance' };
      }},
    ],
    { tradeId, db },
  );

  if (councilResult.decision !== 'approved') {
    return { success: false, error: 'Council rejected liquidation' };
  }

  // Liquidate the earmark
  const { data: earmark } = await db.from('earmarks')
    .select('*')
    .eq('trade_id', tradeId)
    .eq('status', 'active')
    .single();

  if (earmark) {
    await db.from('earmarks').update({
      status: 'liquidated',
      release_reason: 'maker_defaulted',
      released_at: new Date().toISOString(),
    }).eq('id', earmark.id);
  }

  // Record the withdrawal (liquidation from maker)
  const txHash = 'sim_liquidation_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({
    maker_address: makerAddress,
    amount: totalDeducted,
    currency,
    direction: 'withdrawal',
    tx_hash: txHash,
    council_signature: councilResult.aggregateHash,
    status: 'completed',
  });

  // Credit the taker with the trade value (repayment)
  const repayTxHash = 'sim_repayment_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({
    maker_address: takerAddress,  // taker receives into their vault
    amount: tradeValue,
    currency,
    direction: 'deposit',
    tx_hash: repayTxHash,
    council_signature: councilResult.aggregateHash,
    status: 'completed',
  });

  // Ensure taker has a vault balance record
  await recalculateBalance(takerAddress);

  // Credit the Council with the surcharge
  const surchargeTxHash = 'sim_surcharge_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({
    maker_address: 'council-treasury',
    amount: surcharge,
    currency,
    direction: 'deposit',
    tx_hash: surchargeTxHash,
    council_signature: councilResult.aggregateHash,
    status: 'completed',
  });

  await recalculateBalance(makerAddress);
  return { success: true, liquidatedAmount: totalDeducted, takerRepaid: tradeValue, councilSurcharge: surcharge };
}

/**
 * Request a withdrawal from the vault.
 */
export async function requestWithdrawal(
  makerAddress: string,
  amount: number,
  currency: string = 'USDC',
): Promise<{ success: boolean; requestId?: string; eligibleAt?: string; error?: string }> {
  const db = getServiceClient();

  const balance = await getVaultBalance(makerAddress);
  if (!balance || balance.available < amount) {
    return { success: false, error: `Insufficient available balance. Available: ${balance?.available || 0}` };
  }

  // Check for active trades
  const { data: activeTrades } = await db.from('trades')
    .select('id')
    .eq('maker_address', makerAddress)
    .in('status', ['open', 'taker_sent', 'taker_verified', 'maker_sent'])
    .limit(1);

  const hasActiveTrades = activeTrades && activeTrades.length > 0;

  const councilResult = await councilVerifyAndSign(
    'request_withdrawal',
    { makerAddress, amount, currency, hasActiveTrades },
    [
      { name: 'sufficient_balance', fn: async () => ({ passed: balance.available >= amount }) },
      { name: 'amount_positive', fn: async () => ({ passed: amount > 0 }) },
    ],
    { db },
  );

  if (councilResult.decision !== 'approved') {
    return { success: false, error: 'Council rejected withdrawal request' };
  }

  const eligibleAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const { data: request, error } = await db.from('withdrawal_requests').insert({
    maker_address: makerAddress,
    amount,
    currency,
    status: hasActiveTrades ? 'queued' : 'pending',
    council_signature: councilResult.aggregateHash,
    eligible_at: eligibleAt,
  }).select('id').single();

  if (error) return { success: false, error: error.message };

  // Update pending withdrawal in balance
  await recalculateBalance(makerAddress);
  return { success: true, requestId: request.id, eligibleAt };
}

/**
 * Process a withdrawal after 12-hour cooling period.
 */
export async function processWithdrawal(
  withdrawalId: string,
): Promise<{ success: boolean; error?: string }> {
  const db = getServiceClient();

  const { data: request } = await db.from('withdrawal_requests')
    .select('*')
    .eq('id', withdrawalId)
    .single();

  if (!request) return { success: false, error: 'Withdrawal not found' };
  if (request.status === 'completed') return { success: false, error: 'Already completed' };
  if (new Date(request.eligible_at) > new Date()) {
    return { success: false, error: 'Cooling period not elapsed' };
  }

  // Check for active trades
  const { data: activeTrades } = await db.from('trades')
    .select('id')
    .eq('maker_address', request.maker_address)
    .in('status', ['open', 'taker_sent', 'taker_verified', 'maker_sent'])
    .limit(1);

  if (activeTrades && activeTrades.length > 0) {
    return { success: false, error: 'Active trades exist. Withdrawal queued.' };
  }

  // Execute withdrawal
  const txHash = 'sim_withdrawal_' + crypto.randomUUID().slice(0, 12);
  await db.from('vault_deposits').insert({
    maker_address: request.maker_address,
    amount: request.amount,
    currency: request.currency,
    direction: 'withdrawal',
    tx_hash: txHash,
    status: 'completed',
  });

  await db.from('withdrawal_requests').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', withdrawalId);

  await recalculateBalance(request.maker_address);
  return { success: true };
}

/**
 * Recalculate a maker's vault balance from the ledger.
 */
async function recalculateBalance(makerAddress: string): Promise<any> {
  const db = getServiceClient();

  // Sum deposits
  const { data: deposits } = await db.from('vault_deposits')
    .select('amount, direction')
    .eq('maker_address', makerAddress)
    .in('status', ['confirmed', 'completed']);

  let totalDeposited = 0;
  for (const d of deposits || []) {
    if (d.direction === 'deposit') totalDeposited += Number(d.amount);
    else totalDeposited -= Number(d.amount);
  }
  totalDeposited = Math.max(0, totalDeposited);

  // Sum active earmarks
  const { data: earmarks } = await db.from('earmarks')
    .select('amount')
    .eq('maker_address', makerAddress)
    .eq('status', 'active');

  const committed = (earmarks || []).reduce((sum: number, e: any) => sum + Number(e.amount), 0);

  // Sum pending withdrawals
  const { data: pendingWds } = await db.from('withdrawal_requests')
    .select('amount')
    .eq('maker_address', makerAddress)
    .in('status', ['pending', 'queued', 'processing']);

  const pendingWithdrawal = (pendingWds || []).reduce((sum: number, w: any) => sum + Number(w.amount), 0);

  const available = Math.max(0, totalDeposited - committed - pendingWithdrawal);
  const matchingLimit = available * MATCHING_LIMIT_RATIO;

  const { data } = await db.from('vault_balances').upsert({
    maker_address: makerAddress,
    total_deposited: totalDeposited,
    committed,
    pending_withdrawal: pendingWithdrawal,
    available,
    matching_limit: matchingLimit,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'maker_address' }).select().single();

  return data;
}

/**
 * Record a timeout and check for ban.
 */
export async function recordTimeout(
  agentAddress: string,
): Promise<{ timeoutCount: number; banned: boolean }> {
  const db = getServiceClient();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Upsert timeout count
  const { data: existing } = await db.from('timeout_tracking')
    .select('*')
    .eq('agent_address', agentAddress)
    .eq('month', month)
    .single();

  const newCount = (existing?.timeout_count || 0) + 1;
  const banned = newCount >= 3;

  await db.from('timeout_tracking').upsert({
    agent_address: agentAddress,
    month,
    timeout_count: newCount,
    last_timeout_at: new Date().toISOString(),
    banned_at: banned ? new Date().toISOString() : existing?.banned_at || null,
  }, { onConflict: 'agent_address,month' });

  return { timeoutCount: newCount, banned };
}

/**
 * Check if an agent is banned this month.
 */
export async function isAgentBanned(agentAddress: string): Promise<boolean> {
  const db = getServiceClient();
  const month = new Date().toISOString().slice(0, 7);

  const { data } = await db.from('timeout_tracking')
    .select('banned_at')
    .eq('agent_address', agentAddress)
    .eq('month', month)
    .single();

  return !!data?.banned_at;
}
