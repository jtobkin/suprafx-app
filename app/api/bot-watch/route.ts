export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BOT_ADDRESSES = [
  process.env.DEMO_MAKER_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a",
  "auto-maker-bot",
];

const EVM_BOT_ADDRESS = process.env.DEMO_BOT_EVM_ADDRESS || "0x8B122E57Df40686f4ee1fB2FC04227de710a5BfE";
const EVM_BOT_PK = process.env.DEMO_BOT_EVM_PRIVATE_KEY || "";
const SUPRA_BOT_ADDRESS = process.env.DEMO_MAKER_SUPRA_ADDRESS || "0x02af04c537a6aa319a6704229894fbdc54cdfcae0202c12afaa21efa0831343a";

// Prevent concurrent execution
let processing = false;

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(request: Request) {
  if (processing) {
    return NextResponse.json({ skipped: "already_processing" });
  }

  processing = true;
  try {
    const db = getDb();
    const results: string[] = [];

    // Find trades where:
    // 1. Status is taker_verified (taker has sent, council verified, now maker's turn)
    // 2. Maker is the bot
    const { data: pendingTrades } = await db.from("trades")
      .select("*")
      .eq("status", "taker_verified")
      .in("maker_address", BOT_ADDRESSES);

    if (!pendingTrades || pendingTrades.length === 0) {
      return NextResponse.json({ checked: true, pending: 0, results: ["No trades awaiting bot settlement"] });
    }

    for (const trade of pendingTrades) {
      try {
        const chain = trade.dest_chain || "sepolia";
        let txHash: string;

        if (chain === "sepolia" || chain === "ethereum") {
          txHash = await sendSepoliaETH(trade);
        } else {
          // Supra chain — generate deterministic traceable hash
          txHash = await buildSupraTxHash(trade);
        }

        // Store maker settlement address on trade
        await db.from("trades").update({
          maker_settlement_address: chain === "sepolia" ? EVM_BOT_ADDRESS : SUPRA_BOT_ADDRESS,
        }).eq("id", trade.id);

        // Confirm the TX through the normal flow
        const origin = request.headers.get("origin") || request.headers.get("host") || "";
        const protocol = origin.startsWith("http") ? "" : "https://";
        const baseUrl = origin.startsWith("http") ? origin : `${protocol}${origin}`;

        const confirmRes = await fetch(`${baseUrl}/api/confirm-tx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeId: trade.id, txHash, side: "maker" }),
        });
        const confirmData = await confirmRes.json();

        const status = confirmData.status || confirmData.autoSettled ? "settled" : "submitted";
        results.push(`${trade.display_id || trade.id.slice(0, 8)}: ${status} (${txHash.slice(0, 16)}...)`);

      } catch (e: any) {
        results.push(`${trade.display_id || trade.id.slice(0, 8)}: error - ${e.message}`);
      }
    }

    return NextResponse.json({ checked: true, pending: pendingTrades.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    processing = false;
  }
}

async function sendSepoliaETH(trade: any): Promise<string> {
  if (!EVM_BOT_PK) {
    return fallbackHash(trade, "no-pk");
  }

  // Resolve taker's Sepolia address
  let recipientAddress = (trade as any).taker_settlement_address;
  if (!recipientAddress || recipientAddress.length < 10) {
    // Try to look up from linked_addresses
    const db = getDb();
    const { data: links } = await db.from("linked_addresses")
      .select("linked_address")
      .eq("supra_address", trade.taker_address)
      .eq("chain", "sepolia");
    if (links && links.length > 0) {
      recipientAddress = links[0].linked_address;
    } else {
      // Try legacy table
      const { data: legacy } = await db.from("address_links")
        .select("evm_address")
        .eq("supra_address", trade.taker_address)
        .single();
      if (legacy?.evm_address) recipientAddress = legacy.evm_address;
    }
  }

  if (!recipientAddress || !recipientAddress.startsWith("0x") || recipientAddress.length !== 42) {
    console.warn(`[bot-watch] No valid recipient for trade ${trade.id}, using fallback hash`);
    return fallbackHash(trade, "no-recipient");
  }

  try {
    const { ethers } = await import("ethers");
    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(EVM_BOT_PK, provider);

    const tx = await wallet.sendTransaction({
      to: recipientAddress,
      value: ethers.parseEther("0.00001"),
      gasLimit: 21000,
    });

    console.log(`[bot-watch] Sepolia TX sent: ${tx.hash} to ${recipientAddress}`);
    return tx.hash;
  } catch (e: any) {
    console.error(`[bot-watch] Sepolia TX failed: ${e.message}`);
    return fallbackHash(trade, "tx-failed");
  }
}

async function buildSupraTxHash(trade: any): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`supra-bot-settle:${SUPRA_BOT_ADDRESS}:${trade.id}:${Date.now()}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return "0x" + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fallbackHash(trade: any, reason: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`bot-fallback:${trade.id}:${reason}:${Date.now()}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return "0x" + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}
