import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { JWT_SECRET } from './common';
import type { AuthSession } from './common';

function refreshClaimKeyMaterial(tokenHash: string): Buffer {
  return createHash('sha256').update(`${JWT_SECRET}\0${tokenHash}`).digest();
}

/** 会话族 claim 加密落库：IdempotencyRecord 只存密文，不落原始 access/refresh token。 */
export function encryptRefreshClaim(session: AuthSession, tokenHash: string): string {
  const key = refreshClaimKeyMaterial(tokenHash);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptRefreshClaim(payload: string, tokenHash: string): AuthSession | null {
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', refreshClaimKeyMaterial(tokenHash), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as AuthSession;
  } catch {
    return null;
  }
}

export function refreshClaimKey(tokenHash: string, userId: string): string {
  return createHash('sha256').update(['auth.refresh', tokenHash, userId].join('\0')).digest('hex');
}
