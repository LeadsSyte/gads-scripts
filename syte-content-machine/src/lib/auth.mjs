import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const SESSION_SECRET = process.env.SESSION_SECRET || 'default-dev-secret-change-me';

/**
 * Decrypt the Anthropic API key using the user's password.
 * The encrypted key is stored in ENCRYPTED_API_KEY env var.
 * Encryption format: AES-256-CBC, key derived from password via SHA-256.
 */
export function decryptApiKey(password) {
  const encrypted = process.env.ENCRYPTED_API_KEY;
  if (!encrypted) {
    throw new Error('ENCRYPTED_API_KEY not configured');
  }

  try {
    // The encryption scheme from the original tool:
    // key = SHA-256(password), IV = first 16 bytes of encrypted data, rest is ciphertext
    const keyHash = crypto.createHash('sha256').update(password).digest();
    const encBuf = Buffer.from(encrypted, 'base64');
    const iv = encBuf.subarray(0, 16);
    const ciphertext = encBuf.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    // Validate it looks like an Anthropic API key
    if (!decrypted.startsWith('sk-ant-')) {
      throw new Error('Invalid password');
    }

    return decrypted;
  } catch {
    throw new Error('Invalid password');
  }
}

/**
 * Create a JWT session token that embeds the decrypted API key.
 * Token expires in 24 hours.
 */
export function createSessionToken(apiKey) {
  return jwt.sign({ apiKey }, SESSION_SECRET, { expiresIn: '24h' });
}

/**
 * Verify and decode a session token, returning the API key.
 */
export function verifySessionToken(token) {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    return decoded.apiKey;
  } catch {
    return null;
  }
}

/**
 * Extract the API key from an incoming request's Authorization header.
 * Returns null if invalid/missing.
 */
export function getApiKeyFromRequest(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Middleware-style helper: returns { apiKey } or throws 401.
 */
export function requireAuth(event) {
  const apiKey = getApiKeyFromRequest(event);
  if (!apiKey) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return { apiKey };
}
