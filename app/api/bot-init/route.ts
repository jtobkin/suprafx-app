export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPRA_MAKER = process.env.DEMO_MAKER_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a";
const EVM_BOT = process.env.DEMO_BOT_EVM_ADDRESS || "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE";
const SUPRA_BOT = process.env.DEMO_BOT_SUPRA_ADDRESS || "0x8622e15E71DdfBCF25721B7D82B729D235201EE3";

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function POST() {
  const db = getDb();
  const results: string[] = [];

  // Register maker bot agent
  const { data: existing } = await db.from("agents")
    .select("wallet_address")
    .eq("wallet_address", SUPRA_MAKER)
    .single();

  if (!existing) {
    await db.from("agents").upsert({
      wallet_address: SUPRA_MAKER,
      name: "SupraFX Bot",
      role: "maker",
      status: "active",
      chains: ["sepolia", "supra-testnet"],
      rep_deposit_base: 5,
      rep_total: 5,
      rep_performance: 0,
      rep_speed: 0,
      rep_penalties: 0,
    }, { onConflict: "wallet_address" });
    results.push("Created maker agent: " + SUPRA_MAKER.slice(0, 12));
  } else {
    results.push("Maker agent exists");
  }

  // Link EVM address — write to both tables matching the link-address API format

  // 1. address_links (legacy table: supra_address, evm_address, evm_verified_at)
  try {
    await db.from("address_links").upsert({
      supra_address: SUPRA_MAKER,
      evm_address: EVM_BOT,
      evm_verified_at: new Date().toISOString(),
    }, { onConflict: "supra_address" });
    results.push("Linked in address_links");
  } catch (e: any) {
    results.push("address_links: " + (e.message || "skip"));
  }

  // 2. linked_addresses (new table: supra_address, linked_address, chain, wallet_provider, verified_at)
  try {
    await db.from("linked_addresses").upsert({
      supra_address: SUPRA_MAKER,
      linked_address: EVM_BOT,
      chain: "sepolia",
      wallet_provider: "bot",
      verified_at: new Date().toISOString(),
    }, { onConflict: "supra_address,chain" });
    results.push("Linked EVM in linked_addresses");
  } catch (e: any) {
    results.push("linked_addresses evm: " + (e.message || "skip"));
  }

  // 3. Supra self-link in linked_addresses
  try {
    await db.from("linked_addresses").upsert({
      supra_address: SUPRA_MAKER,
      linked_address: SUPRA_MAKER,
      chain: "supra-testnet",
      wallet_provider: "bot",
      verified_at: new Date().toISOString(),
    }, { onConflict: "supra_address,chain" });
    results.push("Linked Supra in linked_addresses");
  } catch (e: any) {
    results.push("linked_addresses supra: " + (e.message || "skip"));
  }

  // Also ensure vault exists for the bot
  const { data: vault } = await db.from("vault_balances")
    .select("maker_address")
    .eq("maker_address", SUPRA_MAKER)
    .single();

  if (!vault) {
    await db.from("vault_balances").upsert({
      maker_address: SUPRA_MAKER,
      total_deposited: 10000,
      available: 10000,
      committed: 0,
      matching_limit: 9000,
      pending_withdrawal: 0,
    }, { onConflict: "maker_address" });
    results.push("Created vault with 10,000 deposit");
  } else {
    results.push("Vault exists");
  }

  return NextResponse.json({ initialized: true, results });
}
