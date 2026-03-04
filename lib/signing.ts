/**
 * SupraFX Session Signing
 * 
 * Signs platform actions (RFQ, quote, accept, cancel) silently in the browser.
 * No wallet popup — the session key is derived from the wallet connection.
 * Wallet popups only happen for real token transfers (settle).
 * 
 * How it works:
 * 1. On wallet connect, we get the user's Supra address
 * 2. We derive a session signing key from the address + a random nonce + timestamp
 * 3. All platform actions are signed with this key using HMAC-SHA256
 * 4. The backend can verify signatures against the session
 * 5. Session expires on page close or after 24 hours
 */

// Session state (in-memory only, never persisted)
let sessionKey: CryptoKey | null = null;
let sessionNonce: string = "";
let sessionAddress: string = "";
let sessionCreatedAt: number = 0;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Initialize a signing session for the connected wallet.
 * Called once on wallet connect. No popup.
 */
export async function initSession(supraAddress: string): Promise<{
  nonce: string;
  createdAt: number;
}> {
  sessionNonce = crypto.randomUUID();
  sessionAddress = supraAddress;
  sessionCreatedAt = Date.now();

  // Derive a signing key from the address + nonce
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(supraAddress + ":" + sessionNonce + ":" + sessionCreatedAt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  sessionKey = keyMaterial;

  return { nonce: sessionNonce, createdAt: sessionCreatedAt };
}

/**
 * Check if session is valid (exists and not expired).
 */
export function isSessionValid(): boolean {
  if (!sessionKey || !sessionAddress) return false;
  if (Date.now() - sessionCreatedAt > SESSION_TTL_MS) return false;
  return true;
}

/**
 * Get the current session info.
 */
export function getSessionInfo(): {
  address: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
} | null {
  if (!isSessionValid()) return null;
  return {
    address: sessionAddress,
    nonce: sessionNonce,
    createdAt: sessionCreatedAt,
    expiresAt: sessionCreatedAt + SESSION_TTL_MS,
  };
}

/**
 * Clear the session (on disconnect or expiry).
 */
export function clearSession(): void {
  sessionKey = null;
  sessionNonce = "";
  sessionAddress = "";
  sessionCreatedAt = 0;
}

/**
 * Construct a deterministic payload for signing.
 * The payload is JSON-serialized with sorted keys for consistency.
 */
export function constructPayload(
  action: string,
  signer: string,
  data: Record<string, any>,
): {
  action: string;
  signer: string;
  data: Record<string, any>;
  timestamp: string;
  nonce: string;
  sessionNonce: string;
} {
  return {
    action,
    signer,
    data: sortKeys(data),
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    sessionNonce,
  };
}

/**
 * Sort object keys recursively for deterministic serialization.
 */
function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Deterministic JSON string for hashing.
 */
export function canonicalize(payload: any): string {
  return JSON.stringify(sortKeys(payload));
}

/**
 * Hash a payload to a hex string using SHA-256.
 */
export async function hashPayload(payload: any): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalize(payload));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sign a payload with the session key. No wallet popup.
 * Returns the signature as a hex string.
 */
export async function sessionSign(payload: any): Promise<{
  signature: string;
  payloadHash: string;
}> {
  if (!sessionKey || !isSessionValid()) {
    throw new Error("No valid signing session. Please reconnect your wallet.");
  }

  const canonical = canonicalize(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  const sigBuffer = await crypto.subtle.sign("HMAC", sessionKey, data);
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const payloadHash = await hashPayload(payload);

  return { signature, payloadHash };
}

/**
 * Construct, sign, and return a complete signed action.
 * This is the main function components should call.
 */
export async function signAction(
  action: string,
  signer: string,
  data: Record<string, any>,
): Promise<{
  payload: ReturnType<typeof constructPayload>;
  signature: string;
  payloadHash: string;
}> {
  const payload = constructPayload(action, signer, data);
  const { signature, payloadHash } = await sessionSign(payload);
  return { payload, signature, payloadHash };
}

// ============================================================
// Server-side verification (for use in API routes)
// ============================================================

/**
 * Verify a signed payload on the server side.
 * The server reconstructs the HMAC key from the session info
 * and verifies the signature matches.
 */
export async function verifySignatureServer(
  payload: any,
  signature: string,
  signerAddress: string,
  sessionNonce: string,
  sessionCreatedAt: number,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signerAddress + ":" + sessionNonce + ":" + sessionCreatedAt),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const canonical = canonicalize(payload);
    const data = encoder.encode(canonical);
    const sigBytes = new Uint8Array(
      signature.match(/.{2}/g)!.map(h => parseInt(h, 16))
    );

    return await crypto.subtle.verify("HMAC", keyMaterial, sigBytes, data);
  } catch {
    return false;
  }
}
