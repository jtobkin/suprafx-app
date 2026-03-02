-- SupraFX MVP Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- AGENTS (registered wallets)
-- ============================================
create table agents (
  id uuid default gen_random_uuid() primary key,
  wallet_address text not null unique,
  role text not null check (role in ('maker', 'taker')),
  domain text, -- e.g. fastmaker.supra
  chains text[] default '{}',
  -- reputation
  rep_total numeric(10,2) default 0,
  rep_deposit_base numeric(10,2) default 0,
  rep_performance numeric(10,2) default 0,
  rep_speed_bonus numeric(10,2) default 0,
  rep_penalties numeric(10,2) default 0,
  trade_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- RFQS (orderbook entries)
-- ============================================
create table rfqs (
  id uuid default gen_random_uuid() primary key,
  display_id text not null unique, -- RFQ-001, RFQ-002
  taker_address text not null references agents(wallet_address),
  pair text not null, -- ETH/USDC
  size numeric(18,8) not null,
  source_chain text not null, -- sepolia
  dest_chain text not null, -- supra-testnet
  max_slippage numeric(6,4) default 0.005,
  reference_price numeric(18,2), -- S-value at creation
  status text not null default 'open' check (status in ('open', 'matched', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- QUOTES (maker responses to RFQs)
-- ============================================
create table quotes (
  id uuid default gen_random_uuid() primary key,
  rfq_id uuid not null references rfqs(id),
  maker_address text not null references agents(wallet_address),
  rate numeric(18,6) not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz default now()
);

-- ============================================
-- TRADES (full lifecycle)
-- ============================================
create table trades (
  id uuid default gen_random_uuid() primary key,
  display_id text not null unique, -- T-240301-001
  rfq_id uuid references rfqs(id),
  pair text not null,
  size numeric(18,8) not null,
  rate numeric(18,6) not null,
  notional numeric(18,2) generated always as (size * rate) stored,
  source_chain text not null,
  dest_chain text not null,
  taker_address text not null references agents(wallet_address),
  maker_address text not null references agents(wallet_address),
  -- status progression: open → taker_sent → taker_verified → maker_sent → maker_verified → settled | failed
  status text not null default 'open' check (status in (
    'open', 'taker_sent', 'taker_verified', 'maker_sent', 'maker_verified', 'settled', 'failed'
  )),
  -- on-chain TX hashes
  taker_tx_hash text,
  taker_tx_confirmed_at timestamptz,
  maker_tx_hash text,
  maker_tx_confirmed_at timestamptz,
  -- timing
  settle_ms integer, -- total settlement time in ms
  created_at timestamptz default now(),
  settled_at timestamptz,
  failed_at timestamptz,
  failure_reason text
);

-- ============================================
-- COMMITTEE VOTES (3-of-5 verification)
-- ============================================
create table committee_votes (
  id uuid default gen_random_uuid() primary key,
  trade_id uuid not null references trades(id),
  node_id text not null, -- N-1 through N-5
  verification_type text not null check (verification_type in (
    'verify_taker_tx', 'verify_maker_tx', 'approve_reputation', 'approve_liquidation'
  )),
  decision text not null check (decision in ('approve', 'reject')),
  chain text, -- which chain was verified
  tx_hash text, -- which TX was verified
  signature text, -- Ed25519 signature
  created_at timestamptz default now(),
  -- prevent duplicate votes
  unique(trade_id, node_id, verification_type)
);

-- ============================================
-- COMMITTEE REQUESTS (aggregate view)
-- ============================================
create table committee_requests (
  id uuid default gen_random_uuid() primary key,
  trade_id uuid not null references trades(id),
  verification_type text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approvals integer default 0,
  rejections integer default 0,
  threshold integer default 3,
  created_at timestamptz default now(),
  resolved_at timestamptz,
  unique(trade_id, verification_type)
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_rfqs_status on rfqs(status);
create index idx_rfqs_pair on rfqs(pair);
create index idx_trades_status on trades(status);
create index idx_trades_taker on trades(taker_address);
create index idx_trades_maker on trades(maker_address);
create index idx_committee_votes_trade on committee_votes(trade_id);
create index idx_committee_requests_trade on committee_requests(trade_id);
create index idx_committee_requests_status on committee_requests(status);

-- ============================================
-- AUTO-UPDATE updated_at
-- ============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger agents_updated_at
  before update on agents
  for each row execute function update_updated_at();

-- ============================================
-- ENABLE REALTIME
-- ============================================
alter publication supabase_realtime add table rfqs;
alter publication supabase_realtime add table trades;
alter publication supabase_realtime add table committee_votes;
alter publication supabase_realtime add table committee_requests;

-- ============================================
-- RLS POLICIES (permissive for MVP)
-- ============================================
alter table agents enable row level security;
alter table rfqs enable row level security;
alter table quotes enable row level security;
alter table trades enable row level security;
alter table committee_votes enable row level security;
alter table committee_requests enable row level security;

-- Allow all reads (public orderbook + blotter)
create policy "Public read agents" on agents for select using (true);
create policy "Public read rfqs" on rfqs for select using (true);
create policy "Public read quotes" on quotes for select using (true);
create policy "Public read trades" on trades for select using (true);
create policy "Public read votes" on committee_votes for select using (true);
create policy "Public read requests" on committee_requests for select using (true);

-- Allow inserts/updates via service role (API routes use service key)
create policy "Service insert agents" on agents for insert with check (true);
create policy "Service update agents" on agents for update using (true);
create policy "Service insert rfqs" on rfqs for insert with check (true);
create policy "Service update rfqs" on rfqs for update using (true);
create policy "Service insert quotes" on quotes for insert with check (true);
create policy "Service update quotes" on quotes for update using (true);
create policy "Service insert trades" on trades for insert with check (true);
create policy "Service update trades" on trades for update using (true);
create policy "Service insert votes" on committee_votes for insert with check (true);
create policy "Service insert requests" on committee_requests for insert with check (true);
create policy "Service update requests" on committee_requests for update using (true);

-- ============================================
-- SEED: S-VALUES CONFIG TABLE
-- ============================================
create table s_values (
  pair text primary key,
  price numeric(18,2) not null,
  updated_at timestamptz default now()
);

insert into s_values (pair, price) values
  ('ETH/USDC', 2500.00),
  ('BTC/USDC', 65000.00),
  ('SUPRA/USDC', 0.15);

alter table s_values enable row level security;
create policy "Public read s_values" on s_values for select using (true);
create policy "Service update s_values" on s_values for update using (true);

-- ============================================
-- SEQUENCE FOR DISPLAY IDS
-- ============================================
create sequence rfq_seq start 1;
create sequence trade_seq start 1;

create or replace function generate_rfq_id()
returns trigger as $$
begin
  new.display_id = 'RFQ-' || lpad(nextval('rfq_seq')::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create or replace function generate_trade_id()
returns trigger as $$
begin
  new.display_id = 'T-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('trade_seq')::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create trigger rfq_display_id before insert on rfqs
  for each row execute function generate_rfq_id();

create trigger trade_display_id before insert on trades
  for each row execute function generate_trade_id();
