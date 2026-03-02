export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};

  // Check env vars
  checks.BOT_SUPRA_PRIVATE_KEY = process.env.BOT_SUPRA_PRIVATE_KEY ? 'set (' + process.env.BOT_SUPRA_PRIVATE_KEY.slice(0, 6) + '...)' : 'NOT SET';
  checks.BOT_EVM_PRIVATE_KEY = process.env.BOT_EVM_PRIVATE_KEY ? 'set' : 'NOT SET';
  checks.BOT_SUPRA_ADDRESS = process.env.BOT_SUPRA_ADDRESS || 'NOT SET';
  checks.BOT_EVM_ADDRESS = process.env.BOT_EVM_ADDRESS || 'NOT SET';
  checks.ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY ? 'set' : 'NOT SET';

  // Test Supra SDK import
  try {
    // @ts-ignore
    const sdk = await import('supra-l1-sdk');
    checks.supraSDK = 'loaded';

    // Test client init
    try {
      const client = await Promise.race([
        sdk.SupraClient.init('https://rpc-testnet.supra.com/'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      checks.supraRPC = 'connected';

      // Test account from key
      if (process.env.BOT_SUPRA_PRIVATE_KEY) {
        try {
          const account = new sdk.SupraAccount(
            Uint8Array.from(Buffer.from(process.env.BOT_SUPRA_PRIVATE_KEY, 'hex'))
          );
          checks.botAddress = account.address().toString();
          
          // Check balance
          try {
            const info = await (client as any).getAccountInfo(account.address());
            checks.accountInfo = 'exists';
            checks.sequenceNumber = info?.sequence_number?.toString() || 'unknown';
          } catch (e: any) {
            checks.accountInfo = 'NOT FOUND — bot wallet may not be funded: ' + (e.message || '').slice(0, 100);
          }
        } catch (e: any) {
          checks.botAccount = 'ERROR: ' + e.message;
        }
      }
    } catch (e: any) {
      checks.supraRPC = 'FAILED: ' + e.message;
    }
  } catch (e: any) {
    checks.supraSDK = 'FAILED: ' + e.message;
  }

  return NextResponse.json(checks);
}
