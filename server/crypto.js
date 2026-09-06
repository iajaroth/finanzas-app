import crypto from 'node:crypto';

// AES-256-GCM para tokens OAuth en reposo, derivado de APP_SECRET
function keyFrom(secret) {
  return crypto.scryptSync(secret || 'finanzas-fallback', 'finanzas-salt-v1', 32);
}

export function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(process.env.APP_SECRET), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decrypt(payload) {
  if (!payload) return '';
  try {
    const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(process.env.APP_SECRET), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
