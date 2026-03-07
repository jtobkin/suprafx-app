export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const SUPRA_API_KEY = process.env.SUPRA_ORACLE_API_KEY || '9c7f2e4a6b1d8f03a5e9c27d4b6f8a1c3d5e7f902b4a6c8d1e3f5a7b9c0d2e4f';
const BASE_URL = 'https://prod-kline-rest.supra.com';

const TOKEN_TO_ORACLE: Record<string, string> = {
  ETH: 'eth_usdt', SUPRA: 'supra_usdt',
  fxAAVE: 'aave_usdt', fxLINK: 'link_usdt', fxUSDC: 'usdc_usdt', fxUSDT: 'usdt_usd',
  AAVE: 'aave_usdt', LINK: 'link_usdt', USDC: 'usdc_usdt', USDT: 'usdt_usd',
  BTC: 'btc_usdt',
};

// Interval presets in seconds
const INTERVALS: Record<string, { seconds: number; points: number }> = {
  '1H': { seconds: 60, points: 60 },       // 1-min candles, 60 points
  '4H': { seconds: 300, points: 48 },      // 5-min candles, 48 points
  '1D': { seconds: 3600, points: 24 },     // 1-hour candles, 24 points
  '1W': { seconds: 14400, points: 42 },    // 4-hour candles, 42 points
};

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const timeframe = req.nextUrl.searchParams.get('timeframe') || '1D';

  if (!token) {
    return NextResponse.json({ error: 'token query param required, e.g. ETH' }, { status: 400 });
  }

  const oraclePair = TOKEN_TO_ORACLE[token];
  if (!oraclePair) {
    return NextResponse.json({ error: `No oracle feed for token: ${token}` }, { status: 400 });
  }

  const preset = INTERVALS[timeframe] || INTERVALS['1D'];
  const endDate = Date.now();
  const startDate = endDate - (preset.seconds * preset.points * 1000);

  try {
    const url = `${BASE_URL}/history?trading_pair=${oraclePair}&startDate=${startDate}&endDate=${endDate}&interval=${preset.seconds}`;
    const res = await fetch(url, {
      headers: { 'x-api-key': SUPRA_API_KEY },
      cache: 'no-store',
    });
    const data = await res.json();

    if (data.status === 'success' && Array.isArray(data.data)) {
      const candles = data.data.map((d: any) => ({
        time: d.timestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      const response = NextResponse.json({ token, oraclePair, timeframe, candles });
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return response;
    }

    return NextResponse.json({ token, oraclePair, timeframe, candles: [], raw: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
