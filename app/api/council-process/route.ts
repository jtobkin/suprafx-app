export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { checkDeadlines } from '@/lib/council-node';

export async function GET() {
  try {
    const processed = await checkDeadlines();
    return NextResponse.json({ checked: true, processed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
