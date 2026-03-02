import { getServiceClient } from './supabase';

const SPEED_THRESHOLD_MS = 30000; // 30 seconds
const SPEED_BONUS = 2.0;
const PERFORMANCE_PER_TRADE = 10.0;
const DEPOSIT_BASE = 5.0;

export async function updateReputation(
  walletAddress: string,
  settleMs: number | null
) {
  const db = getServiceClient();

  const { data: agent } = await db
    .from('agents')
    .select('*')
    .eq('wallet_address', walletAddress)
    .single();

  if (!agent) return;

  const newTradeCount = (agent.trade_count || 0) + 1;
  const newPerformance = (agent.rep_performance || 0) + PERFORMANCE_PER_TRADE;
  const speedBonus = settleMs && settleMs < SPEED_THRESHOLD_MS ? SPEED_BONUS : 0;
  const newSpeedBonus = (agent.rep_speed_bonus || 0) + speedBonus;
  const depositBase = agent.rep_deposit_base || DEPOSIT_BASE;

  const total = depositBase + newPerformance + newSpeedBonus - (agent.rep_penalties || 0);

  await db.from('agents').update({
    trade_count: newTradeCount,
    rep_performance: newPerformance,
    rep_speed_bonus: newSpeedBonus,
    rep_total: total,
  }).eq('wallet_address', walletAddress);
}
