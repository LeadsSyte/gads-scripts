// Shared Lock Screen auth helpers.
// Decrypts the embedded API key using AES-GCM + PBKDF2 (SHA-256, 100k iterations).
//
// Layout of the base64 blob:
//   bytes  0-15  : salt
//   bytes 16-27  : iv
//   bytes 28+    : ciphertext (includes GCM tag)

export const ENCRYPTED_API_KEY_B64 =
  'XOQMdgQ9C42E1F4wGt9aaRQWmNLBD4QBy4SAhES1uqbv5MR8uY5PjNavx0u58cy6RpqORVnDkYXDtrfeIiEwgQJY+HTEjl+D1JhVeN8A6iUnwMvLisjW6rto21YBpbRdfPzMdPNBK/Pk42PZa9iIYB5zo07UC6xxcwjrDgaVR3bP6wcum8/N3TPz6axf2UPaBtH/+taFL7s=';

const SESSION_KEY = 'syte-suite:anthropic-key';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

export async function unlockWithPassword(password) {
  const raw = b64ToBytes(ENCRYPTED_API_KEY_B64);
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);
  const key = await deriveKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  const apiKey = new TextDecoder().decode(plainBuf).trim();
  if (!apiKey.startsWith('sk-')) {
    throw new Error('Decryption failed');
  }
  sessionStorage.setItem(SESSION_KEY, apiKey);
  return apiKey;
}

export function getStoredApiKey() {
  return sessionStorage.getItem(SESSION_KEY);
}

export function clearApiKey() {
  sessionStorage.removeItem(SESSION_KEY);
}
