import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';

const loginAttempts = new Map();

function secretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET || process.env.APP_SECRET || 'dev-secret-finanzas');
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.reset) {
    loginAttempts.set(ip, { count: 1, reset: now + 5 * 60_000 });
    return false;
  }
  rec.count++;
  return rec.count > 10;
}

export function authRouter() {
  const r = Router();
  r.post('/login', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    const email = process.env.AUTH_EMAIL;
    const password = process.env.AUTH_PASSWORD;
    if (!email || !password) {
      return res.status(500).json({ error: 'AUTH_EMAIL/AUTH_PASSWORD no están configurados en el servidor.' });
    }
    const { email: e, password: p } = req.body || {};
    if (String(e || '').trim().toLowerCase() !== email.toLowerCase() || String(p || '') !== password) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const token = await new SignJWT({ u: email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secretKey());
    res.json({ token, email });
  });
  return r;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const { payload } = await jwtVerify(token, secretKey());
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}
