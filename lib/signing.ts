/**
 * SupraFX Session Signing — Real Key Pair Implementation
 * 
 * Chain of trust:
 * 1. At login: generate a session key pair (ECDSA P-256)
 * 2. StarKey signs: "I authorize session key {pubKey} for {address} until {expiry}"
 *    — This is the ONE wallet popup. Stored as sessionAuthorization.
 * 3. All platform actions signed with the session PRIVATE key (no popup)
 * 4. Verification: check action sig against session pubKey, then check
 *    session authorization sig against the Supra address.
 * 
 * The session authorization (signed by real private key) is the anchor.
 * Without it, session key signatures mean nothing.
 * With it, they trace back to the real Supra account.
 */

// Session state (in-memory only)
let sessionKeyPair: CryptoKeyPair | null = null;
let sessionPublicKeyHex: string = "";
let sessionAddress: string = "";
let sessionNonce: string = "";
let sessionCreatedAt: number = 0;
let sessionExpiresAt: number = 0;
let sessionAuthorization: string = ""; // StarKey signature over the authorization message
let sessionAuthMessage: string = "";    // The message StarKey signed

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a new session key pair and return the authorization message
 * that needs to be signed by StarKey.
 */
export async function prepareSession(supraAddress: string): Promise<{
  authMessage: string;
  sessionPublicKey: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}> {
  // Generate ECDSA P-256 key pair
  sessionKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable so we can export the public key
    ["sign", "verify"]
  );

  // Export public key as hex
  const pubKeyBuffer = await crypto.subtle.exportKey("raw", sessionKeyPair.publicKey);
  sessionPublicKeyHex = Array.from(new Uint8Array(pubKeyBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  sessionAddress = supraAddress;
  sessionNonce = crypto.randomUUID();
  sessionCreatedAt = Date.now();
  sessionExpiresAt = sessionCreatedAt + SESSION_TTL_MS;

  // Build the authorization message that StarKey will sign
  sessionAuthMessage = [
    "SupraFX Session Authorization",
    "",
    "Address: " + supraAddress,
    "Session Key: " + sessionPublicKeyHex.slice(0, 32) + "...",
    "Nonce: " + sessionNonce,
    "Created: " + new Date(sessionCreatedAt).toISOString(),
    "Expires: " + new Date(sessionExpiresAt).toISOString(),
  ].join("\n");

  return {
    authMessage: sessionAuthMessage,
    sessionPublicKey: sessionPublicKeyHex,
    nonce: sessionNonce,
    createdAt: sessionCreatedAt,
    expiresAt: sessionExpiresAt,
  };
}

/**
 * Finalize the session with StarKey's signature over the authorization message.
 */
export function finalizeSession(starkeySignature: string): void {
  sessionAuthorization = starkeySignature;
  console.log("[SupraFX] Session finalized. Public key:", sessionPublicKeyHex.slice(0, 16) + "...");
}

/**
 * Check if session is valid.
 */
export function isSessionValid(): boolean {
  if (!sessionKeyPair || !sessionAddress || !sessionAuthorization) return false;
  if (Date.now() > sessionExpiresAt) return false;
  return true;
}

/**
 * Get session info for storage alongside signed actions.
 */
export function getSessionInfo(): {
  address: string;
  sessionPublicKey: string;
  sessionNonce: string;
  sessionCreatedAt: number;
  sessionExpiresAt: number;
  authMessage: string;
  authSignature: string;
} | null {
  if (!isSessionValid()) return null;
  return {
    address: sessionAddress,
    sessionPublicKey: sessionPublicKeyHex,
    sessionNonce: sessionNonce,
    sessionCreatedAt: sessionCreatedAt,
    sessionExpiresAt: sessionExpiresAt,
    authMessage: sessionAuthMessage,
    authSignature: sessionAuthorization,
  };
}

/**
 * Clear the session.
 */
export function clearSession(): void {
  sessionKeyPair = null;
  sessionPublicKeyHex = "";
  sessionAddress = "";
  sessionNonce = "";
  sessionCreatedAt = 0;
  sessionExpiresAt = 0;
  sessionAuthorization = "";
  sessionAuthMessage = "";
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
 * Deterministic JSON serialization.
 */
export function canonicalize(payload: any): string {
  return JSON.stringify(sortKeys(payload));
}

/**
 * Construct a payload for signing.
 */
export function constructPayload(
  action: string,
  signer: string,
  data: Record<string, any>,
): any {
  return {
    action,
    signer,
    data: sortKeys(data),
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    sessionPublicKey: sessionPublicKeyHex,
  };
}

/**
 * Hash a payload using SHA-256.
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
 * Sign a payload with the session PRIVATE key (ECDSA P-256).
 * No wallet popup — uses the in-memory session key.
 */
export async function sessionSign(payload: any): Promise<{
  signature: string;
  payloadHash: string;
}> {
  if (!sessionKeyPair || !isSessionValid()) {
    throw new Error("No valid signing session");
  }

  const canonical = canonicalize(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  const sigBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    sessionKeyPair.privateKey,
    data
  );

  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const payloadHash = await hashPayload(payload);

  return { signature, payloadHash };
}

/**
 * Sign an action. Main function for components to call.
 */
export async function signAction(
  action: string,
  signer: string,
  data: Record<string, any>,
): Promise<{
  payload: any;
  signature: string;
  payloadHash: string;
  sessionPublicKey: string;
  sessionAuthSignature: string;
  sessionAuthMessage: string;
  sessionNonce: string;
  sessionCreatedAt: number;
}> {
  const payload = constructPayload(action, signer, data);
  const { signature, payloadHash } = await sessionSign(payload);
  return {
    payload,
    signature,
    payloadHash,
    sessionPublicKey: sessionPublicKeyHex,
    sessionAuthSignature: sessionAuthorization,
    sessionAuthMessage: sessionAuthMessage,
    sessionNonce: sessionNonce,
    sessionCreatedAt: sessionCreatedAt,
  };
}

// ============================================================
// Server-side verification
// ============================================================

/**
 * Verify a session-signed action on the server.
 * Imports the session public key and verifies the ECDSA signature.
 */
export async function verifySignatureServer(
  payload: any,
  signature: string,
  sessionPublicKeyHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = new Uint8Array(
      sessionPublicKeyHex.match(/.{2}/g)!.map(h => parseInt(h, 16))
    );

    const publicKey = await crypto.subtle.importKey(
      "raw",
      pubKeyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const canonical = canonicalize(payload);
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);

    const sigBytes = new Uint8Array(
      signature.match(/.{2}/g)!.map(h => parseInt(h, 16))
    );

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sigBytes,
      data
    );
  } catch {
    return false;
  }
}
