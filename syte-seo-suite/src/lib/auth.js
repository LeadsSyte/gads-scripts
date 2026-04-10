// Shared lock screen — decrypts the embedded Claude API key using AES-GCM + PBKDF2.
// Layout: [16 bytes salt][12 bytes iv][ciphertext+tag]

export const ENCRYPTED_KEY_B64 =
  'XOQMdgQ9C42E1F4wGt9aaRQWmNLBD4QBy4SAhES1uqbv5MR8uY5PjNavx0u58cy6RpqORVnDkYXDtrfeIiEwgQJY+HTEjl+D1JhVeN8A6iUnwMvLisjW6rto21YBpbRdfPzMdPNBK/Pk42PZa9iIYB5zo07UC6xxcwjrDgaVR3bP6wcum8/N3TPz6axf2UPaBtH/+taFL7s=';

const SESSION_KEY = 'syte-suite-api-key';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function decryptApiKey(password) {
  const raw = b64ToBytes(ENCRYPTED_KEY_B64);
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ct = raw.slice(28);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return new TextDecoder().decode(plain);
}

export function getStoredApiKey() {
  return sessionStorage.getItem(SESSION_KEY);
}

export function setStoredApiKey(k) {
  sessionStorage.setItem(SESSION_KEY, k);
}

export function clearStoredApiKey() {
  sessionStorage.removeItem(SESSION_KEY);
}
