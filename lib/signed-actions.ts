import { getServiceClient } from './supabase';
import { verifySignatureServer } from './signing';

/**
 * Store a signed action in the audit trail.
 */
export async function storeSignedAction(params: {
  actionType: string;
  signerAddress: string;
  payload: any;
  payloadHash: string;
  signature: string;
  sessionPublicKey?: string;       // ECDSA P-256 public key for this session
  sessionAuthSignature?: string;   // StarKey signature authorizing the session key
  sessionNonce?: string;
  sessionCreatedAt?: number;
  tradeId?: string;
  rfqId?: string;
  quoteId?: string;
  verify?: boolean;
}): Promise<{ id: string; verified: boolean }> {
  const db = getServiceClient();

  let verified = false;

  // Verify ECDSA signature if session public key provided
  if (params.verify && params.sessionPublicKey && params.signature) {
    verified = await verifySignatureServer(
      params.payload,
      params.signature,
      params.sessionPublicKey,
    );
  } else if (params.signature && params.signature.length > 10) {
    // Mark as having a signature even if not verified server-side
    verified = true;
  }

  const { data, error } = await db.from('signed_actions').insert({
    action_type: params.actionType,
    signer_address: params.signerAddress,
    payload_json: params.payload,
    payload_hash: params.payloadHash,
    signature: params.signature,
    session_public_key: params.sessionPublicKey || null,
    session_auth_signature: params.sessionAuthSignature || null,
    session_nonce: params.sessionNonce || null,
    session_created_at: params.sessionCreatedAt || null,
    trade_id: params.tradeId || null,
    rfq_id: params.rfqId || null,
    quote_id: params.quoteId || null,
    verified,
  }).select('id').single();

  if (error) {
    console.error('[SupraFX] Failed to store signed action:', error.message);
    return { id: '', verified };
  }

  return { id: data.id, verified };
}

/**
 * Get all signed actions for a trade, in chronological order.
 */
export async function getTradeActions(tradeId: string): Promise<any[]> {
  const db = getServiceClient();
  try {
    const { data } = await db.from('signed_actions')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}
