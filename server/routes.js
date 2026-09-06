import { Router } from 'express';
import { db, getSetting, setSetting, allSettings } from './db.js';
import { azureStatus, authorizeUrl, makeState, exchangeCode, connectionStatus, disconnect, listMessages, getMessageBody, refreshAccountEmail } from './graph.js';
import { parseBankEmail, detectBank } from './parsers.js';
import { getUsdRate, fxStatus } from './fx.js';

// ---------- helpers ----------

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start, end: `${endMonth}-01` };
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const TX_SELECT = `
  SELECT t.*, a.name AS account_name, a.kind AS account_kind, a.color AS account_color,
         c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         a2.name AS transfer_to_name
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts a2 ON a2.id = t.transfer_to_id
  LEFT JOIN categories c ON c.id = t.category_id`;

function txById(id) {
  return db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
}

function computeBalances() {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY created_at').all();
  const agg = db.prepare(`
    SELECT account_id AS id,
      SUM(CASE WHEN type = 'income' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS inc,
      SUM(CASE WHEN type = 'expense' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS exp
    FROM transactions WHERE account_id IS NOT NULL GROUP BY account_id`).all();
  const toAgg = db.prepare(`
    SELECT transfer_to_id AS id, SUM(amount * COALESCE(fx_rate,1)) AS transferred FROM transactions
    WHERE type = 'transfer' AND transfer_to_id IS NOT NULL GROUP BY transfer_to_id`).all();
  const fromAgg = db.prepare(`
    SELECT account_id AS id, SUM(amount * COALESCE(fx_rate,1)) AS transferred FROM transactions
    WHERE type = 'transfer' AND account_id IS NOT NULL GROUP BY account_id`).all();
  const inc = Object.fromEntries(agg.map((r) => [r.id, r.inc || 0]));
  const exp = Object.fromEntries(agg.map((r) => [r.id, r.exp || 0]));
  const tin = Object.fromEntries(toAgg.map((r) => [r.id, r.transferred || 0]));
  const tout = Object.fromEntries(fromAgg.map((r) => [r.id, r.transferred || 0]));
  return accounts.map((a) => {
    let balance;
    if (a.kind === 'credit_card') {
      const debt = (exp[a.id] || 0) - (inc[a.id] || 0) - (tin[a.id] || 0);
      balance = Math.max(debt, 0);
    } else {
      balance = a.opening_balance + (inc[a.id] || 0) - (exp[a.id] || 0) - (tout[a.id] || 0) + (tin[a.id] || 0);
    }
    const available = a.kind === 'credit_card' ? a.credit_limit - balance : null;
    return { ...a, balance, available };
  });
}

// ---------- router (protegido) ----------

export function apiRouter() {
  const r = Router();

  // ---- cuentas ----
  r.get('/accounts', (_req, res) => {
    const archived = db.prepare('SELECT * FROM accounts WHERE archived = 1 ORDER BY name').all();
    res.json({ items: computeBalances(), archived });
  });
  r.post('/accounts', (req, res) => {
    const { name, kind = 'bank', bank = '', last4 = '', opening_balance = 0, credit_limit = 0, color = 'gold' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!['bank', 'cash', 'credit_card', 'wallet'].includes(kind)) return res.status(400).json({ error: 'Tipo inválido' });
    const info = db.prepare(
      'INSERT INTO accounts (name, kind, bank, last4, opening_balance, credit_limit, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), kind, bank || '', String(last4 || ''), Number(opening_balance) || 0, Number(credit_limit) || 0, color || 'gold');
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
  });
  r.put('/accounts/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const b = req.body || {};
    db.prepare(
      'UPDATE accounts SET name = ?, kind = ?, bank = ?, last4 = ?, opening_balance = ?, credit_limit = ?, color = ?, archived = ? WHERE id = ?'
    ).run(
      b.name?.trim() ?? a.name, b.kind ?? a.kind, b.bank ?? a.bank, String(b.last4 ?? a.last4),
      Number(b.opening_balance ?? a.opening_balance) || 0, Number(b.credit_limit ?? a.credit_limit) || 0,
      b.color ?? a.color, b.archived === undefined ? a.archived : (b.archived ? 1 : 0), a.id
    );
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id));
  });
  r.delete('/accounts/:id', (req, res) => {
    db.prepare('UPDATE transactions SET account_id = NULL WHERE account_id = ?').run(req.params.id);
    db.prepare('UPDATE transactions SET transfer_to_id = NULL WHERE transfer_to_id = ?').run(req.params.id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- categorías ----
  r.get('/categories', (_req, res) => {
    res.json({ items: db.prepare('SELECT * FROM categories ORDER BY kind, name').all() });
  });
  r.post('/categories', (req, res) => {
    const { name, kind = 'expense', icon = 'tag', color = 'gold' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const info = db.prepare('INSERT INTO categories (name, kind, icon, color) VALUES (?, ?, ?, ?)').run(name.trim(), kind, icon, color);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  });
  r.put('/categories/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Categoría no encontrada' });
    const b = req.body || {};
    db.prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?')
      .run(b.name?.trim() ?? c.name, b.icon ?? c.icon, b.color ?? c.color, c.id);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(c.id));
  });
  r.delete('/categories/:id', (req, res) => {
    db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- transacciones ----
  r.get('/transactions', (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];
    if (q.month && MONTH_RE.test(q.month)) {
      const { start, end } = monthRange(q.month);
      where.push('t.occurred_at >= ? AND t.occurred_at < ?');
      params.push(start, end);
    }
    if (q.account_id) { where.push('(t.account_id = ? OR t.transfer_to_id = ?)'); params.push(q.account_id, q.account_id); }
    if (q.category_id) { where.push('t.category_id = ?'); params.push(q.category_id); }
    if (q.type && ['income', 'expense', 'transfer'].includes(q.type)) { where.push('t.type = ?'); params.push(q.type); }
    if (q.q) { where.push('(t.merchant LIKE ? OR t.description LIKE ? OR t.notes LIKE ?)'); const like = `%${q.q}%`; params.push(like, like, like); }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM transactions t ${W}`).get(...params).n;
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;
    const items = db.prepare(`${TX_SELECT} ${W} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json({ items, total });
  });
  function validateTx(body) {
    const type = body.type;
    if (!['income', 'expense', 'transfer'].includes(type)) return 'Tipo inválido';
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return 'Monto inválido';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.occurred_at || '')) return 'Fecha inválida';
    if (type === 'transfer' && !body.transfer_to_id) return 'Falta la cuenta de destino';
    return null;
  }
  // resuelve fx_rate para transacciones en moneda distinta a la base
  async function resolveFx(body) {
    const base = getSetting('currency') || 'CRC';
    const currency = body.currency || base;
    if (currency === base) return { currency: base, fx_rate: 1 };
    if (Number(body.fx_rate) > 0) return { currency, fx_rate: Number(body.fx_rate) };
    const { rate } = await getUsdRate(body.occurred_at);
    return { currency, fx_rate: rate || 0 };
  }
  r.post('/transactions', async (req, res) => {
    const b = req.body || {};
    const err = validateTx(b);
    if (err) return res.status(400).json({ error: err });
    const { currency, fx_rate } = await resolveFx(b);
    const info = db.prepare(
      'INSERT INTO transactions (account_id, transfer_to_id, category_id, type, amount, currency, fx_rate, merchant, description, notes, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(b.account_id || null, b.transfer_to_id || null, b.type === 'transfer' ? null : (b.category_id || null),
      b.type, Math.round(Number(b.amount)), currency, fx_rate, b.merchant || '', b.description || '', b.notes || '', b.occurred_at, b.source || 'manual');
    res.json(txById(info.lastInsertRowid));
  });
  r.put('/transactions/:id', async (req, res) => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'No encontrada' });
    const b = { ...t, ...(req.body || {}) };
    const err = validateTx(b);
    if (err) return res.status(400).json({ error: err });
    const { currency, fx_rate } = await resolveFx(b);
    db.prepare(
      `UPDATE transactions SET account_id = ?, transfer_to_id = ?, category_id = ?, type = ?, amount = ?, currency = ?, fx_rate = ?,
       merchant = ?, description = ?, notes = ?, occurred_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(b.account_id || null, b.transfer_to_id || null, b.type === 'transfer' ? null : (b.category_id || null),
      b.type, Math.round(Number(b.amount)), currency, fx_rate, b.merchant || '', b.description || '', b.notes || '', b.occurred_at, t.id);
    res.json(txById(t.id));
  });
  r.delete('/transactions/:id', (req, res) => {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- resumen (dashboard) ----
  r.get('/summary', (req, res) => {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : currentMonth();
    const { start, end } = monthRange(month);
    const totals = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'income' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS income,
        SUM(CASE WHEN type = 'expense' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS expense
      FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`).get(start, end);
    const byCategory = db.prepare(`
      SELECT c.id AS category_id, c.name, c.icon, c.color, SUM(t.amount * COALESCE(t.fx_rate,1)) AS total
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY c.id ORDER BY total DESC`).all(start, end);
    const months = [];
    const [y, m] = month.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const trend = months.map((mo) => {
      const { start: s, end: e } = monthRange(mo);
      const row = db.prepare(`
        SELECT SUM(CASE WHEN type = 'income' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS income,
               SUM(CASE WHEN type = 'expense' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS expense
        FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`).get(s, e);
      return { month: mo, income: row.income || 0, expense: row.expense || 0 };
    });
    const balances = computeBalances();
    const totalBalance = balances.reduce((acc, a) => acc + (a.kind === 'credit_card' ? -a.balance : a.balance), 0);
    const recent = db.prepare(`${TX_SELECT} ORDER BY t.occurred_at DESC, t.id DESC LIMIT 8`).all();
    const budget = Number(getSetting('monthly_budget') || 0);
    const pending = db.prepare("SELECT COUNT(*) AS n FROM email_imports WHERE status = 'pending'").get().n;
    res.json({
      month,
      income: totals.income || 0,
      expense: totals.expense || 0,
      net: (totals.income || 0) - (totals.expense || 0),
      total_balance: totalBalance,
      by_category: byCategory,
      trend,
      recent,
      budget: budget > 0 ? { amount: Math.round(budget * 100), spent: totals.expense || 0 } : null,
      pending_imports: pending,
    });
  });

  // ---- estadísticas ----
  r.get('/stats', (req, res) => {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : currentMonth();
    const { start, end } = monthRange(month);
    const byCategory = db.prepare(`
      SELECT c.id AS category_id, c.name, c.icon, c.color, SUM(t.amount * COALESCE(t.fx_rate,1)) AS total, COUNT(*) AS n
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY c.id ORDER BY total DESC`).all(start, end);
    const byAccount = db.prepare(`
      SELECT a.id AS account_id, a.name, a.kind, a.color, COALESCE(a.bank, '') AS bank, SUM(t.amount * COALESCE(t.fx_rate,1)) AS total
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY a.id ORDER BY total DESC`).all(start, end);
    const topMerchants = db.prepare(`
      SELECT COALESCE(NULLIF(t.merchant, ''), t.description, 'Sin detalle') AS merchant, SUM(t.amount * COALESCE(t.fx_rate,1)) AS total, COUNT(*) AS n
      FROM transactions t
      WHERE t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY merchant ORDER BY total DESC LIMIT 10`).all(start, end);
    // últimos 12 meses
    const [y, m] = month.split('-').map(Number);
    const byMonth = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      const mo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const { start: s, end: e } = monthRange(mo);
      const row = db.prepare(`
        SELECT SUM(CASE WHEN type = 'income' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS income,
               SUM(CASE WHEN type = 'expense' THEN amount * COALESCE(fx_rate,1) ELSE 0 END) AS expense
        FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`).get(s, e);
      byMonth.push({ month: mo, income: row.income || 0, expense: row.expense || 0 });
    }
    res.json({ month, by_category: byCategory, by_account: byAccount, top_merchants: topMerchants, by_month: byMonth });
  });

  // ---- correo ----
  r.get('/email/status', (_req, res) => {
    res.json({
      ...connectionStatus(),
      last_sync_at: getSetting('last_sync_at'),
      auto_approve: getSetting('auto_approve') === '1',
      sync_days: Number(getSetting('sync_days') || 30),
      sender_filters: getSetting('sender_filters'),
      pending: db.prepare("SELECT COUNT(*) AS n FROM email_imports WHERE status = 'pending'").get().n,
      syncing: syncState.running,
      sync_started_at: syncState.started_at,
      sync_processed: syncState.processed,
      sync_total: syncState.total,
      last_sync_result: syncState.last_result,
      last_sync_error: syncState.last_error,
    });
  });
  r.get('/email/authorize', async (_req, res) => {
    const az = azureStatus();
    if (!az.configured) return res.status(400).json({ error: 'Configura primero el Client ID y Secret de Azure.', ...az });
    const state = await makeState();
    res.json({ url: authorizeUrl(state) });
  });
  r.post('/email/exchange', async (req, res) => {
    const { code, state } = req.body || {};
    if (!code || !state) return res.status(400).json({ error: 'Faltan code/state' });
    try {
      await exchangeCode(code, state);
      const email = await refreshAccountEmail();
      res.json({ ok: true, email });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  r.post('/email/disconnect', (_req, res) => {
    disconnect();
    res.json({ ok: true });
  });
  r.post('/email/settings', (req, res) => {
    const b = req.body || {};
    if (b.auto_approve !== undefined) setSetting('auto_approve', b.auto_approve ? '1' : '0');
    if (b.sync_days !== undefined) setSetting('sync_days', String(Number(b.sync_days) || 30));
    if (b.sender_filters !== undefined) setSetting('sender_filters', String(b.sender_filters || ''));
    res.json({ ok: true });
  });
  // sync en segundo plano: el arranque responde al instante y el progreso se consulta en /email/status
  let syncState = { running: false, started_at: null, last_result: null, last_error: null, processed: 0, total: 0 };

  async function runSync() {
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
    const messages = await listMessages(sinceIso, 300);
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
      // dedupe: copias del mismo correo en varias carpetas tienen id distinto pero mismos datos
      const dup = db.prepare("SELECT id FROM email_imports WHERE status != 'rejected' AND amount = ? AND occurred_at = ? AND bank = ? AND merchant = ?")
        .get(parsed.amount, parsed.occurred_at, parsed.bank, parsed.merchant);
      if (dup) { result.skipped++; continue; }
      // tipo de cambio si la moneda difiere de la base
      let fxRate = 1;
      if (parsed.currency !== baseCurrency) {
        fxRate = (await getUsdRate(parsed.occurred_at)).rate || 0;
      }
      const categoryId = cats.find((c) => c.name === parsed.category_name)?.id || null;
      const acc = accounts.find((a) =>
        parsed.last4 && a.last4 === parsed.last4 ? true :
        parsed.bank && (a.bank.toLowerCase().includes(parsed.bank.toLowerCase()) || parsed.bank.toLowerCase().includes(a.bank.toLowerCase()))
      ) || null;
      const auto = getSetting('auto_approve') === '1' && parsed.confidence >= 0.7;
      const importStatus = auto ? 'approved' : 'pending';
      const info = insImport.run(
        msg.id, parsed.bank, msg.from, msg.subject, msg.preview.slice(0, 280), msg.weblink,
        parsed.type, parsed.amount, parsed.merchant, parsed.occurred_at, categoryId, acc?.id || null,
        parsed.confidence, importStatus, msg.receivedAt, parsed.currency
      );
      if (info.changes === 0) { result.skipped++; continue; }
      const importId = info.lastInsertRowid;
      if (auto) {
        const txInfo = db.prepare(
          'INSERT INTO transactions (account_id, category_id, type, amount, currency, fx_rate, merchant, description, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(acc?.id || null, categoryId, parsed.type, parsed.amount, parsed.currency, fxRate, parsed.merchant,
          `[Correo] ${parsed.bank}${parsed.merchant ? ` · ${parsed.merchant}` : ''}`,
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

  r.post('/email/sync', (req, res) => {
    const status = connectionStatus();
    if (!status.configured) return res.status(400).json({ error: 'Outlook no configurado. Falta el Client ID/Secret de Azure.' });
    if (!status.connected) return res.status(400).json({ error: 'Conecta tu cuenta de Outlook primero.' });
    if (syncState.running) return res.json({ started: true, already_running: true });
    syncState.running = true;
    syncState.started_at = new Date().toISOString();
    syncState.last_error = null;
    runSync()
      .then((result) => { syncState.last_result = result; })
      .catch((e) => { syncState.last_error = e.message; })
      .finally(() => { syncState.running = false; });
    res.json({ started: true });
  });
  // diagnóstico: últimos correos y por qué el parser los aceptó o descartó
  r.get('/email/recent', async (req, res) => {
    const days = Number(req.query.days) || 7;
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      const messages = await listMessages(sinceIso, Number(req.query.limit) || 100);
      const extraS = (getSetting('sender_filters') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const items = [];
      for (const m of messages) {
        const bankish = detectBank(m.from, m.fromName) || extraS.some((f) => m.from.toLowerCase().includes(f.toLowerCase()));
        let parsed = parseBankEmail({ subject: m.subject, preview: m.preview, fromAddress: m.from, fromName: m.fromName, receivedAt: m.receivedAt });
        let bodyChecked = false;
        if (bankish && !parsed) {
          try {
            const body = await getMessageBody(m.id);
            parsed = parseBankEmail({ subject: m.subject, preview: m.preview, body, fromAddress: m.from, fromName: m.fromName, receivedAt: m.receivedAt });
            bodyChecked = true;
          } catch { /* sin cuerpo */ }
        }
        items.push({
          from: m.from,
          fromName: m.fromName,
          subject: m.subject,
          receivedAt: m.receivedAt,
          bankish,
          bodyChecked,
          detected: Boolean(parsed),
          amount: parsed?.amount ?? null,
          type: parsed?.type ?? null,
          bank: parsed?.bank ?? '',
          merchant: parsed?.merchant ?? '',
          confidence: parsed?.confidence ?? 0,
        });
      }
      res.json({ items });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
  r.get('/email/imports', (req, res) => {
    const status = req.query.status || 'pending';
    const W = status === 'all' ? '' : `WHERE i.status = '${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending'}'`;
    const items = db.prepare(`
      SELECT i.*, c.name AS category_name, a.name AS account_name
      FROM email_imports i
      LEFT JOIN categories c ON c.id = i.category_id
      LEFT JOIN accounts a ON a.id = i.account_id
      ${W} ORDER BY i.received_at DESC LIMIT 200`).all();
    res.json({ items });
  });
  r.patch('/email/imports/:id', async (req, res) => {
    const imp = db.prepare('SELECT * FROM email_imports WHERE id = ?').get(req.params.id);
    if (!imp) return res.status(404).json({ error: 'No encontrado' });
    const { action, ...fields } = req.body || {};
    if (action === 'reject') {
      db.prepare("UPDATE email_imports SET status = 'rejected' WHERE id = ?").run(imp.id);
      return res.json({ ok: true });
    }
    if (action === 'edit') {
      db.prepare('UPDATE email_imports SET type = ?, amount = ?, merchant = ?, category_id = ?, account_id = ?, occurred_at = ? WHERE id = ?')
        .run(fields.type ?? imp.type, Number(fields.amount) || imp.amount, fields.merchant ?? imp.merchant,
          fields.category_id ?? imp.category_id, fields.account_id ?? imp.account_id, fields.occurred_at ?? imp.occurred_at, imp.id);
      return res.json({ ok: true });
    }
    if (action === 'approve') {
      if (imp.status === 'approved') return res.status(400).json({ error: 'Ya aprobada' });
      const type = fields.type ?? imp.type;
      const amount = Number(fields.amount ?? imp.amount);
      const occurred_at = fields.occurred_at ?? imp.occurred_at;
      if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
      const base = getSetting('currency') || 'CRC';
      const currency = fields.currency ?? imp.currency ?? base;
      let fxRate = 1;
      if (currency !== base) fxRate = (await getUsdRate(occurred_at)).rate || 0;
      const info = db.prepare(
        'INSERT INTO transactions (account_id, category_id, type, amount, currency, fx_rate, merchant, description, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(fields.account_id ?? imp.account_id ?? null, fields.category_id ?? imp.category_id ?? null, type, Math.round(amount),
        currency, fxRate, fields.merchant ?? imp.merchant ?? '',
        `[Correo] ${imp.bank}${imp.subject ? ` · ${imp.subject.slice(0, 80)}` : ''}`,
        occurred_at, 'email');
      db.prepare("UPDATE email_imports SET status = 'approved', transaction_id = ?, type = ?, amount = ?, merchant = ?, category_id = ?, account_id = ?, occurred_at = ? WHERE id = ?")
        .run(info.lastInsertRowid, type, Math.round(amount), fields.merchant ?? imp.merchant ?? '',
          fields.category_id ?? imp.category_id ?? null, fields.account_id ?? imp.account_id ?? null, occurred_at, imp.id);
      return res.json({ ok: true, transaction_id: info.lastInsertRowid });
    }
    res.status(400).json({ error: 'Acción inválida' });
  });
  r.post('/email/imports/approve-all', async (req, res) => {
    const base = getSetting('currency') || 'CRC';
    const pending = db.prepare("SELECT * FROM email_imports WHERE status = 'pending' AND confidence >= ?").all(Number(req.body?.min_confidence ?? 0.7));
    let approved = 0;
    for (const imp of pending) {
      const currency = imp.currency || base;
      let fxRate = 1;
      if (currency !== base) fxRate = (await getUsdRate(imp.occurred_at)).rate || 0;
      const info = db.prepare(
        'INSERT INTO transactions (account_id, category_id, type, amount, currency, fx_rate, merchant, description, occurred_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(imp.account_id, imp.category_id, imp.type, imp.amount, currency, fxRate, imp.merchant,
        `[Correo] ${imp.bank}${imp.subject ? ` · ${imp.subject.slice(0, 80)}` : ''}`, imp.occurred_at, 'email');
      db.prepare("UPDATE email_imports SET status = 'approved', transaction_id = ? WHERE id = ?").run(info.lastInsertRowid, imp.id);
      approved++;
    }
    res.json({ approved });
  });
  r.delete('/email/imports/:id', (req, res) => {
    db.prepare('DELETE FROM email_imports WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- ajustes ----
  r.get('/settings', (_req, res) => {
    const s = allSettings();
    const az = azureStatus();
    const fx = fxStatus();
    res.json({
      currency: s.currency,
      monthly_budget: Number(s.monthly_budget || 0),
      auto_approve: s.auto_approve === '1',
      sender_filters: s.sender_filters,
      sync_days: Number(s.sync_days || 30),
      last_sync_at: s.last_sync_at,
      azure: { client_id: az.client_id, has_secret: az.has_secret, redirect_uri: az.redirect_uri, configured: az.configured },
      bccr: { email: fx.email, has_token: fx.has_token, configured: fx.configured },
      usd_rate_manual: Number(s.usd_rate_manual || 0),
    });
  });
  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const allowed = ['currency', 'monthly_budget', 'auto_approve', 'sender_filters', 'sync_days', 'azure_client_id', 'azure_client_secret', 'last_sync_at', 'bccr_email', 'bccr_token', 'usd_rate_manual', 'bccr_endpoint'];
    for (const k of allowed) {
      if (b[k] !== undefined) {
        if (k === 'azure_client_secret' && String(b[k]).startsWith('••')) continue; // no sobreescribir con máscara
        if (k === 'bccr_token' && String(b[k]).startsWith('••')) continue;
        setSetting(k, k === 'auto_approve' ? (b[k] ? '1' : '0') : b[k]);
      }
    }
    res.json({ ok: true });
  });

  // ---- tipo de cambio ----
  r.get('/fx/usd', async (req, res) => {
    try {
      const r = await getUsdRate(req.query.date || new Date().toISOString());
      res.json({ ...r, date: (req.query.date || new Date().toISOString()).slice(0, 10) });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // ---- exportar ----
  r.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="finanzas-export-${currentMonth()}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      accounts: db.prepare('SELECT * FROM accounts').all(),
      categories: db.prepare('SELECT * FROM categories').all(),
      transactions: db.prepare('SELECT * FROM transactions').all(),
    });
  });

  return r;
}
