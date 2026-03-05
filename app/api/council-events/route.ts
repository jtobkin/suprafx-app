export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getEventChain } from '@/lib/council-node';

export async function GET(req: NextRequest) {
  const rfqId = req.nextUrl.searchParams.get('rfqId');
  if (!rfqId) return NextResponse.json({ error: 'rfqId required' }, { status: 400 });

  const chain = await getEventChain(rfqId);
  return NextResponse.json(chain);
}
