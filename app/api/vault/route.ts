export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { processDeposit, getVaultBalance, requestWithdrawal, processWithdrawal } from '@/lib/vault';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 });

  const balance = await getVaultBalance(address);
  return NextResponse.json({ balance });
}

export async function POST(req: NextRequest) {
  try {
    const { action, makerAddress, amount, currency, withdrawalId } = await req.json();

    if (action === 'deposit') {
      if (!makerAddress || !amount) {
        return NextResponse.json({ error: 'makerAddress and amount required' }, { status: 400 });
      }
      const result = await processDeposit(makerAddress, parseFloat(amount), currency || 'USDC');
      return NextResponse.json(result);
    }

    if (action === 'request_withdrawal') {
      if (!makerAddress || !amount) {
        return NextResponse.json({ error: 'makerAddress and amount required' }, { status: 400 });
      }
      const result = await requestWithdrawal(makerAddress, parseFloat(amount), currency || 'USDC');
      return NextResponse.json(result);
    }

    if (action === 'process_withdrawal') {
      if (!withdrawalId) {
        return NextResponse.json({ error: 'withdrawalId required' }, { status: 400 });
      }
      const result = await processWithdrawal(withdrawalId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action. Available: deposit, request_withdrawal, process_withdrawal' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
