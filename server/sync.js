// Sincronización de correo en segundo plano (compartida por el API y el cron nocturno)
import { db, getSetting, setSetting } from './db.js';
import { listMessages, getMessageBody } from './graph.js';
import { parseBankEmail, detectBank } from './parsers.js';
import { getUsdRate } from './fx.js';
import { classifyWithAI, openRouterStatus } from './openrouter.js';

export const syncState = {
  running: false,
  started_at: null,
  last_result: null,
  last_error: null,
  processed: 0,
  total: 0,
};

export async function runSync() {
  const now = Date.now();
  const lastSync = getSetting('last_sync_at');
  const days = Number(getSetting('sync_days') || 30);
  let sinceMs;
  if (lastSync) {
    const prev = Date.parse(lastSync);
    // re-sincroniza con 6h de solapamiento para no perder nada en la frontera
    sinceMs = Math.min(now - 6 * 3600_000, prev);
  } else {
    sinceMs = now - days * 86400_000;
  }
  const sinceIso = new Date(sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const messages = await listMessages(sinceIso, 800);
  const extra = (getSetting('sender_filters') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const result = { scanned: messages.length, created: 0, pending: 0, skipped: 0 };
  syncState.total = messages.length;
  syncState.processed = 0;
  const insImport = db.prepare(`
    INSERT OR IGNORE INTO email_imports (message_id, bank, from_email, subject, snippet, weblink, type, amount, merchant, occurred_at, category_id, account_id, confidence, status, received_at, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0').all();
  const cats = db.prepare('SELECT * FROM categories').all();
  const baseCurrency = getSetting('currency') || 'CRC';
  const isExtraSender = (m) => extra.some((f) => m.toLowerCase().includes(f.toLowerCase()));
  for (const msg of messages) {
    syncState.processed++;
    const exists = db.prepare('SELECT id FROM email_imports WHERE message_id = ?').get(msg.id);
    if (exists) { result.skipped++; continue; }
    // pre-filtro: solo correos de bancos/comercios conocidos o dominios extra del usuario
    const bankish = detectBank(msg.from, msg.fromName) || isExtraSender(msg.from);
    if (!bankish) continue;
    let parsed = parseBankEmail({ subject: msg.subject, preview: msg.preview, fromAddress: msg.from, fromName: msg.fromName, receivedAt: msg.receivedAt, base: baseCurrency });
    if (!parsed) {
      // el monto suele estar en el cuerpo (p. ej. BAC, Davivienda CR)
      try {
        const body = await getMessageBody(msg.id);
        parsed = parseBankEmail({ subject: msg.subject, preview: msg.preview, body, fromAddress: msg.from, fromName: msg.fromName, receivedAt: msg.receivedAt, base: baseCurrency });
      } catch { /* sin cuerpo disponible */ }
    }
    if (!parsed) continue;
    // anti-duplicado entre canales: el mismo movimiento puede llegar por correo
    // del banco Y por SMS reenviado (distinto remitente e id). Si hay otro registro
    // con el mismo monto, mismo día y recibido a <20 min, es el mismo movimiento.
    const thisT = Date.parse(msg.receivedAt || '') || 0;
    if (thisT) {
      const dupWin = db.prepare(
        "SELECT received_at FROM email_imports WHERE status != 'rejected' AND amount = ? AND occurred_at = ?"
      ).all(parsed.amount, parsed.occurred_at);
      if (dupWin.some((w) => Math.abs(Date.parse(w.received_at || '') - thisT) < 20 * 60_000)) {
        result.skipped++;
        continue;
      }
    }
    // con varias tarjetas por banco: matchea por últimos 4 dígitos; si el banco
    // tiene una sola cuenta, asigna esa; si es ambiguo, deja sin cuenta
    const matchAccount = () => {
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const pb = norm(parsed.bank);
      const sameBank = (a) => {
        const ab = norm(a.bank);
        return (ab && pb && (ab.includes(pb) || pb.includes(ab))) || norm(a.name).includes(pb);
      };
      if (parsed.last4) {
        const byLast4 = accounts.filter((a) => a.last4 === parsed.last4);
        if (byLast4.length === 1) return byLast4[0];
        const byBoth = byLast4.find(sameBank);
        if (byBoth) return byBoth;
      }
      const bankAccounts = accounts.filter(sameBank);
      return bankAccounts.length === 1 ? bankAccounts[0] : null;
    };
    const acc = matchAccount();
    // clasificación con IA (opcional): corrige tipo y detecta transferencias propias
    let ai = null;
    if (openRouterStatus().configured) {
      ai = await classifyWithAI({ subject: msg.subject, snippet: `${msg.preview} ${parsed.merchant}`, fromEmail: msg.from, accounts });
    }
    // tipo de cambio si la moneda difiere de la base
    let fxRate = 1;
    if (parsed.currency !== baseCurrency) {
      fxRate = (await getUsdRate(parsed.occurred_at)).rate || 0;
    }
    const categoryId = cats.find((c) => c.name === parsed.category_name)?.id || null;
    // la IA puede sobreescribir tipo/cuentas cuando está segura
    const validAcc = (id) => accounts.some((a) => a.id === id);
    let effType = parsed.type;
    let effFrom = acc?.id ?? null;
    let effTo = null;
    let effCat = categoryId;
    let confThreshold = parsed.confidence;
    if (ai && ai.confianza >= 0.6) {
      if (ai.tipo === 'transfer' && validAcc(ai.cuenta_origen) && validAcc(ai.cuenta_destino)) {
        effType = 'transfer';
        effFrom = ai.cuenta_origen;
        effTo = ai.cuenta_destino;
        effCat = null;
      } else if (ai.tipo === 'income' || ai.tipo === 'expense') {
        effType = ai.tipo;
        const accId = ai.tipo === 'income' ? ai.cuenta_destino : ai.cuenta_origen;
        if (validAcc(accId)) effFrom = accId;
      }
      confThreshold = ai.confianza;
    }
    const auto = getSetting('auto_approve') === '1' && confThreshold >= 0.7;
    const importStatus = auto ? 'approved' : 'pending';
    const info = insImport.run(
      msg.id, parsed.bank, msg.from, msg.subject, msg.preview.slice(0, 280), msg.weblink,
      effType, parsed.amount, parsed.merchant, parsed.occurred_at, effCat, effFrom,
      parsed.confidence, importStatus, msg.receivedAt, parsed.currency
    );
    if (info.changes === 0) { result.skipped++; continue; }
    const importId = info.lastInsertRowid;
    if (auto) {
      const txInfo = db.prepare(
        'INSERT INTO transactions (account_id, transfer_to_id, category_id, type, amount, currency, fx_rate, merchant, description, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(effFrom, effTo, effType === 'transfer' ? null : effCat, effType, parsed.amount, parsed.currency, fxRate, parsed.merchant,
        `[Correo] ${parsed.bank}${parsed.merchant ? ` · ${parsed.merchant}` : ''}${ai?.razon ? ` · IA: ${ai.razon}` : ''}`,
        parsed.occurred_at, 'email');
      db.prepare('UPDATE email_imports SET transaction_id = ? WHERE id = ?').run(txInfo.lastInsertRowid, importId);
      result.created++;
    } else {
      result.pending++;
    }
  }
  setSetting('last_sync_at', new Date(now).toISOString());
  return result;
}

export function startSync() {
  if (syncState.running) return { started: true, already_running: true };
  syncState.running = true;
  syncState.started_at = new Date().toISOString();
  syncState.last_error = null;
  runSync()
    .then((result) => { syncState.last_result = result; })
    .catch((e) => { syncState.last_error = e.message; })
    .finally(() => { syncState.running = false; });
  return { started: true };
}

// cron nocturno: sincroniza a diario a las 10:00 pm hora de Costa Rica
export function startNightlyCron() {
  if (globalThis.__finanzasCron) return;
  globalThis.__finanzasCron = setInterval(async () => {
    try {
      const crNow = new Date(Date.now() - 6 * 3600_000); // UTC-6
      const hhmm = crNow.toISOString().slice(11, 16);
      const today = crNow.toISOString().slice(0, 10);
      if (hhmm < '22:00' || hhmm > '22:15') return;
      if (getSetting('last_cron_sync') === today) return;
      const connected = db.prepare('SELECT refresh_token FROM email_tokens WHERE id = 1').get();
      if (!connected?.refresh_token) return;
      setSetting('last_cron_sync', today);
      console.log('[cron 10pm] sincronizando el día…');
      const result = await runSync();
      console.log(`[cron 10pm] listo: ${result.created} creadas, ${result.pending} pendientes, ${result.skipped} duplicadas`);
    } catch (e) {
      console.error('[cron 10pm]', e.message);
    }
  }, 60_000);
}
