export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getCouncilPublicKeys } from '@/lib/council-sign';

export async function GET() {
  const keys = await getCouncilPublicKeys();
  return NextResponse.json({
    council: {
      name: 'SupraFX Settlement Council',
      threshold: '3-of-5',
      nodes: keys,
      description: 'Each node independently verifies and signs trade actions. 3 of 5 must agree for consensus.',
    },
  });
}
