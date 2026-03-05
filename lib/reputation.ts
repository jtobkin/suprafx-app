import { getServiceClient } from './supabase';

const DEPOSIT_BASE = 5.0;

// Settlement rewards based on speed
const SPEED_TIERS = [
  { maxMs: 5 * 60 * 1000, bonus: 5.0 },    // under 5 min
  { maxMs: 15 * 60 * 1000, bonus: 3.0 },   // under 15 min
  { maxMs: 30 * 60 * 1000, bonus: 1.0 },   // under 30 min
];

/**
 * Update reputation after a successful settlement.
 */
export async function updateReputation(
  walletAddress: string,
  settleMs: number | null,
) {
  const db = getServiceClient();
  const { data: agent } = await db.from('agents').select('*').eq('wallet_address', walletAddress).single();
  if (!agent) return;

  const newTradeCount = (agent.trade_count || 0) + 1;

  // Calculate speed bonus
  let speedBonus = 0;
  if (settleMs && settleMs > 0) {
    for (const tier of SPEED_TIERS) {
      if (settleMs <= tier.maxMs) { speedBonus = tier.bonus; break; }
    }
  }

  const newTotal = Math.max(0,
    (agent.rep_deposit_base || DEPOSIT_BASE) +
    (agent.rep_performance || 0) + speedBonus +
    (agent.rep_speed_bonus || 0) -
    (agent.rep_penalties || 0)
  );

  await db.from('agents').update({
    trade_count: newTradeCount,
    rep_speed_bonus: (agent.rep_speed_bonus || 0) + speedBonus,
    rep_total: newTotal,
  }).eq('wallet_address', walletAddress);

  return { oldScore: Number(agent.rep_total), newScore: newTotal, tradeCount: newTradeCount };
}

/**
 * Apply a timeout penalty.
 * Taker timeout: -33% of current score
 * Maker default: -67% of current score
 */
export async function applyTimeoutPenalty(
  walletAddress: string,
  penaltyType: 'taker_timeout' | 'maker_default',
): Promise<{ oldScore: number; newScore: number; penaltyAmount: number }> {
  const db = getServiceClient();
  const { data: agent } = await db.from('agents').select('*').eq('wallet_address', walletAddress).single();
  if (!agent) return { oldScore: 0, newScore: 0, penaltyAmount: 0 };

  const oldScore = Number(agent.rep_total) || DEPOSIT_BASE;
  const penaltyPct = penaltyType === 'taker_timeout' ? 0.33 : 0.67;
  const penaltyAmount = oldScore * penaltyPct;
  const newPenalties = (agent.rep_penalties || 0) + penaltyAmount;
  const newScore = Math.max(0, oldScore - penaltyAmount);

  await db.from('agents').update({
    rep_penalties: newPenalties,
    rep_total: newScore,
  }).eq('wallet_address', walletAddress);

  return { oldScore, newScore, penaltyAmount };
}
