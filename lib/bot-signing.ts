/**
 * Server-side signing for the auto-maker bot.
 * Same process as human users — constructs payloads, signs with HMAC,
 * stores in signed_actions. The bot has no privileges over humans.
 */

import { canonicalize } from './signing';

// Bot session state (initialized once per cold start)
let botSessionKey: CryptoKey | null = null;
let botSessionNonce: string = '';
let botSessionCreatedAt: number = 0;
const BOT_ADDRESS = 'auto-maker-bot';

async function ensureBotSession(): Promise<void> {
  // Re-init if no session or older than 24h
  if (botSessionKey && Date.now() - botSessionCreatedAt < 24 * 60 * 60 * 1000) return;

  botSessionNonce = crypto.randomUUID();
  botSessionCreatedAt = Date.now();

  const encoder = new TextEncoder();
  botSessionKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(BOT_ADDRESS + ':' + botSessionNonce + ':' + botSessionCreatedAt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Sign a bot action. Same payload structure and signing process as human users.
 */
export async function botSignAction(
  action: string,
  data: Record<string, any>,
): Promise<{
  payload: any;
  signature: string;
  payloadHash: string;
  sessionNonce: string;
  sessionCreatedAt: number;
}> {
  await ensureBotSession();

  const payload = {
    action,
    signer: BOT_ADDRESS,
    data,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    sessionNonce: botSessionNonce,
  };

  const canonical = canonicalize(payload);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(canonical);

  const sigBuffer = await crypto.subtle.sign('HMAC', botSessionKey!, encoded);
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const payloadHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    payload,
    signature,
    payloadHash,
    sessionNonce: botSessionNonce,
    sessionCreatedAt: botSessionCreatedAt,
  };
}
