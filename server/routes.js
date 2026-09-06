import { Router } from 'express';
import { db, getSetting, setSetting, allSettings } from './db.js';
import { azureStatus, authorizeUrl, makeState, exchangeCode, connectionStatus, disconnect, listMessages, getMessageBody, refreshAccountEmail } from './graph.js';
import { parseBankEmail, detectBank } from './parsers.js';
import { getUsdRate, fxStatus } from './fx.js';
import { classifyWithAI, openRouterStatus } from './openrouter.js';
import { syncState, startSync } from './sync.js';

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
      'INSERT INTO accounts (name, kind, bank, last4, opening_balance, credit_limit, color, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), kind, bank || '', String(last4 || ''), Number(opening_balance) || 0, Number(credit_limit) || 0, color || 'gold', getSetting('currency') || 'CRC');
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
  });
  r.put('/accounts/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const b = req.body || {};
    db.prepare(
      'UPDATE accounts SET name = ?, kind = ?, bank = ?, last4 = ?, opening_balance = ?, credit_limit = ?, color = ?, archived = ?, currency = ? WHERE id = ?'
    ).run(
      b.name?.trim() ?? a.name, b.kind ?? a.kind, b.bank ?? a.bank, String(b.last4 ?? a.last4),
      Number(b.opening_balance ?? a.opening_balance) || 0, Number(b.credit_limit ?? a.credit_limit) || 0,
      b.color ?? a.color, b.archived === undefined ? a.archived : (b.archived ? 1 : 0), b.currency ?? a.currency, a.id
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
  // sync en segundo plano (server/sync.js): responde al instante, progreso en /email/status
  r.post('/email/sync', (req, res) => {
    const status = connectionStatus();
    if (!status.configured) return res.status(400).json({ error: 'Outlook no configurado. Falta el Client ID/Secret de Azure.' });
    if (!status.connected) return res.status(400).json({ error: 'Conecta tu cuenta de Outlook primero.' });
    res.json(startSync());
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

  // reclasifica con IA los movimientos de correo que quedaron sin cuenta
  r.post('/email/ai/reclassify', async (_req, res) => {
    if (!openRouterStatus().configured) return res.status(400).json({ error: 'Configura tu API key de OpenRouter en Ajustes primero.' });
    const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0').all();
    if (!accounts.length) return res.status(400).json({ error: 'Crea tus cuentas primero.' });
    const rows = db.prepare(`
      SELECT t.id AS tx_id, i.subject, i.snippet, i.from_email
      FROM transactions t JOIN email_imports i ON i.transaction_id = t.id
      WHERE t.source = 'email' AND t.account_id IS NULL
      ORDER BY t.occurred_at DESC LIMIT 60`).all();
    const valid = (id) => accounts.some((a) => a.id === id);
    let updated = 0, transfers = 0, skipped = 0;
    for (const row of rows) {
      const ai = await classifyWithAI({ subject: row.subject, snippet: row.snippet, fromEmail: row.from_email, accounts });
      if (!ai) { skipped++; continue; }
      if (ai.tipo === 'transfer' && valid(ai.cuenta_origen) && valid(ai.cuenta_destino) && ai.confianza >= 0.6) {
        db.prepare("UPDATE transactions SET type = 'transfer', account_id = ?, transfer_to_id = ?, category_id = NULL, notes = ? WHERE id = ?")
          .run(ai.cuenta_origen, ai.cuenta_destino, `IA: ${ai.razon}`, row.tx_id);
        transfers++;
      } else if ((ai.tipo === 'income' || ai.tipo === 'expense') && ai.confianza >= 0.6) {
        const acc = ai.tipo === 'income' ? ai.cuenta_destino : ai.cuenta_origen;
        db.prepare('UPDATE transactions SET type = ?, account_id = ?, notes = ? WHERE id = ?')
          .run(ai.tipo, valid(acc) ? acc : null, `IA: ${ai.razon}`, row.tx_id);
      } else { skipped++; continue; }
      updated++;
    }
    res.json({ processed: rows.length, updated, transfers, skipped });
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
      openrouter: { has_key: Boolean(s.openrouter_key), model: s.openrouter_model, configured: Boolean(s.openrouter_key) },
    });
  });
  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const allowed = ['currency', 'monthly_budget', 'auto_approve', 'sender_filters', 'sync_days', 'azure_client_id', 'azure_client_secret', 'last_sync_at', 'bccr_email', 'bccr_token', 'usd_rate_manual', 'bccr_endpoint', 'openrouter_key', 'openrouter_model'];
    for (const k of allowed) {
      if (b[k] !== undefined) {
        if (k === 'azure_client_secret' && String(b[k]).startsWith('••')) continue; // no sobreescribir con máscara
        if (k === 'bccr_token' && String(b[k]).startsWith('••')) continue;
        if (k === 'openrouter_key' && String(b[k]).startsWith('••')) continue;
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

  // ---- IA: recopilación semanal + chat ----
  function weekContext() {
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const end = iso(now);
    const start = iso(new Date(now.getTime() - 7 * 86400_000));
    const prevStart = iso(new Date(now.getTime() - 14 * 86400_000));
    const agg = (s, e) => db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount*COALESCE(fx_rate,1) END),0) AS inc,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount*COALESCE(fx_rate,1) END),0) AS exp,
             COUNT(*) AS n
      FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`).get(s, e);
    const thisWeek = agg(start, end);
    const prevWeek = agg(prevStart, start);
    const byCat = db.prepare(`
      SELECT c.name, SUM(t.amount*COALESCE(t.fx_rate,1)) AS total
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type='expense' AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY c.id ORDER BY total DESC LIMIT 5`).all(start, end);
    const topTx = db.prepare(`
      SELECT COALESCE(NULLIF(merchant,''),description,'—') AS m, amount*COALESCE(fx_rate,1) AS total, occurred_at
      FROM transactions WHERE type='expense' AND occurred_at >= ? AND occurred_at < ?
      ORDER BY total DESC LIMIT 3`).all(start, end);
    const balances = computeBalances().map((a) => ({ name: a.name, kind: a.kind, balance: a.balance }));
    const budget = Number(getSetting('monthly_budget') || 0) / 100;
    return { start, end, thisWeek, prevWeek, byCat, topTx, balances, budget };
  }

  r.post('/ai/insights', async (_req, res) => {
    const ctx = weekContext();
    const crc = (c) => '₡' + Math.round(c / 100).toLocaleString('es-CR');
    const fmtLocal = () => {
      const delta = ctx.thisWeek.exp - ctx.prevWeek.exp;
      const pct = ctx.prevWeek.exp > 0 ? Math.round((delta / ctx.prevWeek.exp) * 100) : null;
      const lines = [];
      lines.push(`Esta semana registraste ${ctx.thisWeek.n} movimientos: ingresos por ${crc(ctx.thisWeek.inc)} y gastos por ${crc(ctx.thisWeek.exp)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct}% vs la semana anterior)` : ''}.`);
      for (const c of ctx.byCat.slice(0, 3)) lines.push(`Tu mayor gasto fue en ${c.name}: ${crc(c.total)}.`);
      if (ctx.topTx[0]) lines.push(`El movimiento más fuerte: ${ctx.topTx[0].m} por ${crc(ctx.topTx[0].total)} (${ctx.topTx[0].occurred_at}).`);
      if (ctx.budget > 0) {
        const spentMonth = db.prepare(`SELECT COALESCE(SUM(amount*COALESCE(fx_rate,1)),0) AS s FROM transactions WHERE type='expense' AND occurred_at >= ?`).get(ctx.end.slice(0, 7) + '-01').s / 100;
        lines.push(`Vas ${crc(spentMonth)} de tu presupuesto mensual de ${crc(ctx.budget * 100)}.`);
      }
      return lines;
    };
    const local = fmtLocal();
    if (!openRouterStatus().configured) {
      return res.json({ source: 'local', insights: local, note: 'Activa la IA en Ajustes para análisis más detallado.' });
    }
    try {
      const { key, model } = openRouterStatus();
      const prompt = `Contexto financiero del usuario (últimos 7 días, ${ctx.start} a ${ctx.end}):
Ingresos: ${crc(ctx.thisWeek.inc)} | Gastos: ${crc(ctx.thisWeek.exp)} | Movimientos: ${ctx.thisWeek.n}
Semana anterior: ingresos ${crc(ctx.prevWeek.inc)} | gastos ${crc(ctx.prevWeek.exp)}
Top categorías: ${ctx.byCat.map((c) => `${c.name} ${crc(c.total)}`).join(', ')}
Mayores movimientos: ${ctx.topTx.map((t) => `${t.m} ${crc(t.total)}`).join(', ')}
Saldos: ${ctx.balances.map((b) => `${b.name} ${crc(b.balance)}`).join(', ')}${ctx.budget ? ` | Presupuesto mensual: ${crc(ctx.budget * 100)}` : ''}

Escribe 3 observaciones breves y accionables en español de Costa Rica, una por línea empezando con "•". Sé específico con montos y compara contra la semana anterior. Sin saludos, sin markdown.`;
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://financiera.jbsautomation.online', 'X-Title': 'finanzas' },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok && r.status !== 200) throw new Error(`OpenRouter ${r.status}`);
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || '';
      const insights = text.split('\n').map((l) => l.replace(/^[•\-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 5);
      if (!insights.length) throw new Error('respuesta vacía');
      res.json({ source: 'ai', insights });
    } catch {
      res.json({ source: 'local', insights: local, note: 'La IA no respondió; este resumen es local.' });
    }
  });

  r.post('/ai/chat', async (req, res) => {
    if (!openRouterStatus().configured) {
      return res.status(400).json({ error: 'Configura tu API key de OpenRouter en Ajustes para usar el asistente.' });
    }
    const question = String(req.body?.question || '').slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Escribe una pregunta.' });
    const ctx = weekContext();
    const crc = (c) => '₡' + Math.round(c / 100).toLocaleString('es-CR');
    const recent = db.prepare(`
      SELECT occurred_at, type, amount*COALESCE(fx_rate,1) AS crc, COALESCE(NULLIF(merchant,''),description,'—') AS m
      FROM transactions WHERE occurred_at >= date('now','-30 days')
      ORDER BY occurred_at DESC LIMIT 120`).all()
      .map((t) => `${t.occurred_at} ${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '⇄'} ${crc(t.crc)} ${t.m}`).join('\n');
    const { key, model } = openRouterStatus();
    const sys = `Eres el asistente financiero personal del usuario (Costa Rica, moneda CRC). Responde en español, breve y concreto (máx 120 palabras), con montos reales de sus datos.
Saldos: ${ctx.balances.map((b) => `${b.name} ${crc(b.balance)}`).join(', ')}.
Semana actual: ingresos ${crc(ctx.thisWeek.inc)}, gastos ${crc(ctx.thisWeek.exp)}. Semana previa: gastos ${crc(ctx.prevWeek.exp)}.
Top categorías de la semana: ${ctx.byCat.map((c) => `${c.name} ${crc(c.total)}`).join(', ') || 'ninguna'}.
Movimientos de los últimos 30 días (fecha tipo monto concepto):
${recent}`;
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://financiera.jbsautomation.online', 'X-Title': 'finanzas' },
        body: JSON.stringify({
          model, temperature: 0.3, max_tokens: 260,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: question }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`OpenRouter ${r.status}`);
      const data = await r.json();
      const answer = data.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error('respuesta vacía');
      res.json({ answer });
    } catch (e) {
      res.status(502).json({ error: `La IA no respondió: ${e.message}` });
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
