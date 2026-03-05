export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET() {
  const db = getServiceClient();
  
  const [reqResult, voteResult] = await Promise.all([
    db.from('committee_requests').select('*').order('created_at', { ascending: false }).limit(50),
    db.from('committee_votes').select('*').order('created_at', { ascending: false }).limit(200),
  ]);

  return NextResponse.json({
    requests: reqResult.data || [],
    votes: voteResult.data || [],
  });
}
