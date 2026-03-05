export interface Agent {
  id: string;
  wallet_address: string;
  role: 'maker' | 'taker';
  domain: string;
  chains: string[];
  rep_total: number;
  rep_deposit_base: number;
  rep_performance: number;
  rep_speed_bonus: number;
  rep_penalties: number;
  trade_count: number;
  created_at: string;
}

export interface RFQ {
  id: string;
  display_id: string;
  taker_address: string;
  pair: string;
  size: number;
  source_chain: string;
  dest_chain: string;
  max_slippage: number;
  reference_price: number;
  status: 'open' | 'matched' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
}

export interface Trade {
  id: string;
  display_id: string;
  rfq_id: string;
  pair: string;
  size: number;
  rate: number;
  notional: number;
  source_chain: string;
  dest_chain: string;
  taker_address: string;
  maker_address: string;
  status: 'open' | 'matched' | 'taker_sent' | 'taker_verified' | 'maker_sent' | 'maker_verified' | 'settled' | 'failed' | 'taker_timed_out' | 'maker_defaulted' | 'cancelled';
  taker_tx_hash: string | null;
  taker_tx_confirmed_at: string | null;
  maker_tx_hash: string | null;
  maker_tx_confirmed_at: string | null;
  taker_settlement_address: string | null;  // resolved address for source_chain
  maker_settlement_address: string | null;  // resolved address for dest_chain
  settle_ms: number | null;
  created_at: string;
  settled_at: string | null;
  match_confirmed_at: string | null;
  taker_deadline: string | null;
  maker_deadline: string | null;
}

export interface CommitteeVote {
  id: string;
  trade_id: string;
  node_id: string;
  verification_type: string;
  decision: 'approve' | 'reject';
  chain: string;
  tx_hash: string;
  created_at: string;
}

export interface CommitteeRequest {
  id: string;
  trade_id: string;
  verification_type: string;
  status: 'pending' | 'approved' | 'rejected';
  approvals: number;
  rejections: number;
  threshold: number;
  attestation_tx: string | null;
  created_at: string;
}

export interface SValue {
  pair: string;
  price: number;
}

export interface Quote {
  id: string;
  rfq_id: string;
  maker_address: string;
  rate: number;
  status: 'review' | 'pending' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';
  created_at: string;
}
