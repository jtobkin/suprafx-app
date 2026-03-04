/**
 * Server-side signing for the auto-maker bot.
 * Same ECDSA P-256 key pair approach as human users.
 * The bot generates its own key pair and self-authorizes (no wallet).
 */

import { canonicalize } from './signing';

const BOT_ADDRESS = 'auto-maker-bot';

let botKeyPair: CryptoKeyPair | null = null;
let botPublicKeyHex: string = '';
let botSessionNonce: string = '';
let botSessionCreatedAt: number = 0;

async function ensureBotSession(): Promise<void> {
  if (botKeyPair && Date.now() - botSessionCreatedAt < 24 * 60 * 60 * 1000) return;

  botKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const pubKeyBuffer = await crypto.subtle.exportKey('raw', botKeyPair.publicKey);
  botPublicKeyHex = Array.from(new Uint8Array(pubKeyBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  botSessionNonce = crypto.randomUUID();
  botSessionCreatedAt = Date.now();
}

export async function botSignAction(
  action: string,
  data: Record<string, any>,
): Promise<{
  payload: any;
  signature: string;
  payloadHash: string;
  sessionPublicKey: string;
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
    sessionPublicKey: botPublicKeyHex,
  };

  const canonical = canonicalize(payload);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(canonical);

  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    botKeyPair!.privateKey,
    encoded
  );

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
    sessionPublicKey: botPublicKeyHex,
    sessionNonce: botSessionNonce,
    sessionCreatedAt: botSessionCreatedAt,
  };
}
