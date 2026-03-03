export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const SUPRA_API_KEY = process.env.SUPRA_ORACLE_API_KEY || '9c7f2e4a6b1d8f03a5e9c27d4b6f8a1c3d5e7f902b4a6c8d1e3f5a7b9c0d2e4f';
const BASE_URL = 'https://prod-kline-rest.supra.com';

// Map our app tokens to Supra oracle pair names
const TOKEN_TO_ORACLE: Record<string, string> = {
  ETH: 'eth_usdt',
  SUPRA: 'supra_usdt',
  fxAAVE: 'aave_usdt',
  fxLINK: 'link_usdt',
  fxUSDC: 'usdc_usdt',
  fxUSDT: 'usdt_usd',
  AAVE: 'aave_usdt',
  LINK: 'link_usdt',
  USDC: 'usdc_usdt',
  USDT: 'usdt_usd',
};

export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get('pair');
  if (!pair) {
    return NextResponse.json({ error: 'pair query param required, e.g. ETH/SUPRA' }, { status: 400 });
  }

  const [base, quote] = pair.split('/');
  const basePair = TOKEN_TO_ORACLE[base];
  const quotePair = TOKEN_TO_ORACLE[quote];

  if (!basePair) {
    return NextResponse.json({ error: `Unknown base token: ${base}` }, { status: 400 });
  }

  try {
    // Fetch base token price
    const baseRes = await fetch(`${BASE_URL}/latest?trading_pair=${basePair}`, {
      headers: { 'x-api-key': SUPRA_API_KEY },
      cache: 'no-store',
    });
    const baseData = await baseRes.json();
    const baseInstrument = baseData?.instruments?.[0];

    if (!baseInstrument) {
      return NextResponse.json({ error: `No oracle data for ${basePair}` }, { status: 404 });
    }

    let quoteInstrument = null;
    if (quotePair && quote !== 'fxUSDT' && quote !== 'fxUSDC') {
      // Fetch quote token price for cross rates
      const quoteRes = await fetch(`${BASE_URL}/latest?trading_pair=${quotePair}`, {
        headers: { 'x-api-key': SUPRA_API_KEY },
        cache: 'no-store',
      });
      const quoteData = await quoteRes.json();
      quoteInstrument = quoteData?.instruments?.[0];
    }

    const basePrice = parseFloat(baseInstrument.currentPrice);
    const baseHigh = parseFloat(baseInstrument['24h_high']);
    const baseLow = parseFloat(baseInstrument['24h_low']);
    const baseChange = parseFloat(baseInstrument['24h_change']);
    const baseTime = baseInstrument.time;

    let quotePrice = 1; // default for stablecoin quotes
    let quoteHigh = 1;
    let quoteLow = 1;
    let quoteChange = 0;
    let quoteTime = baseTime;

    if (quoteInstrument) {
      quotePrice = parseFloat(quoteInstrument.currentPrice);
      quoteHigh = parseFloat(quoteInstrument['24h_high']);
      quoteLow = parseFloat(quoteInstrument['24h_low']);
      quoteChange = parseFloat(quoteInstrument['24h_change']);
      quoteTime = quoteInstrument.time;
    }

    // Conversion: how many quote tokens per 1 base token
    const conversionRate = quotePrice > 0 ? basePrice / quotePrice : 0;

    const res = NextResponse.json({
      pair,
      base: {
        token: base,
        oraclePair: basePair,
        price: basePrice,
        high24h: baseHigh,
        low24h: baseLow,
        change24h: baseChange,
        timestamp: baseTime,
      },
      quote: quoteInstrument ? {
        token: quote,
        oraclePair: quotePair,
        price: quotePrice,
        high24h: quoteHigh,
        low24h: quoteLow,
        change24h: quoteChange,
        timestamp: quoteTime,
      } : null,
      conversionRate,
      updatedAt: Date.now(),
    });
    // Add cache-busting headers
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.headers.set('Pragma', 'no-cache');
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
