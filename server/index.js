import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter, requireAuth } from './auth.js';
import { apiRouter, smsWebhookRouter } from './routes.js';
import { startNightlyCron } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// CORS abierto: la API usa token Bearer (sin cookies), necesario para la app APK
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', authRouter());
// webhook de SMS Gate: público pero protegido por su propio token (SMS_WEBHOOK_TOKEN)
app.use('/api/sms', smsWebhookRouter());
app.use('/api', requireAuth, apiRouter());

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ---- cliente estático (SPA) ----
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`finanzas · escuchando en http://0.0.0.0:${PORT}`);
  startNightlyCron(); // sync diario a las 10 pm hora de Costa Rica
  if (!process.env.JWT_SECRET || !process.env.APP_SECRET) {
    console.warn('⚠ JWT_SECRET/APP_SECRET no definidos: usa secretos fijos en producción.');
  }
});
