export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { checkDeadlines } from '@/lib/council-node';

// Server-side lock to prevent concurrent checkDeadlines execution
// (multiple clients or cron can hit this endpoint simultaneously)
let processing = false;
let lastProcessed = 0;
const MIN_INTERVAL_MS = 15000; // At least 15s between runs

export async function GET() {
  // Skip if already processing or ran too recently
  if (processing) {
    return NextResponse.json({ checked: false, skipped: 'already_processing' });
  }

  const now = Date.now();
  if (now - lastProcessed < MIN_INTERVAL_MS) {
    return NextResponse.json({ checked: false, skipped: 'too_recent', nextIn: MIN_INTERVAL_MS - (now - lastProcessed) });
  }

  processing = true;
  try {
    const processed = await checkDeadlines();
    lastProcessed = Date.now();
    return NextResponse.json({ checked: true, processed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    processing = false;
  }
}
