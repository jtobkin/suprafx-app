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

  // Link EVM address for the maker bot — try both table formats
  const linkTables = ["linked_addresses", "address_links"];
  for (const table of linkTables) {
    try {
      await db.from(table).upsert({
        supra_address: SUPRA_MAKER,
        linked_address: EVM_BOT,
        chain: "sepolia",
        wallet_provider: "bot",
        verified_at: new Date().toISOString(),
      }, { onConflict: "supra_address,chain" });
      results.push(`Linked EVM in ${table}`);
    } catch (e: any) {
      // Table may not exist, ignore
    }
  }

  // Also try the evm_links / link format (some APIs use this)
  try {
    await db.from("evm_links").upsert({
      supra_address: SUPRA_MAKER,
      evm_address: EVM_BOT,
      evm_verified_at: new Date().toISOString(),
      evm_signature: "bot-auto-link",
    }, { onConflict: "supra_address" });
    results.push("Linked via evm_links");
  } catch { /* table may not exist */ }

  // Link Supra address
  for (const table of linkTables) {
    try {
      await db.from(table).upsert({
        supra_address: SUPRA_MAKER,
        linked_address: SUPRA_MAKER,
        chain: "supra-testnet",
        wallet_provider: "bot",
        verified_at: new Date().toISOString(),
      }, { onConflict: "supra_address,chain" });
    } catch { /* ignore */ }
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
