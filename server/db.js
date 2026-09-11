import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'finanzas.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bank',
  bank TEXT DEFAULT '',
  last4 TEXT DEFAULT '',
  currency TEXT DEFAULT 'CRC',
  opening_balance INTEGER DEFAULT 0,
  credit_limit INTEGER DEFAULT 0,
  color TEXT DEFAULT 'gold',
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense',
  icon TEXT DEFAULT 'tag',
  color TEXT DEFAULT 'gold'
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  transfer_to_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  merchant TEXT DEFAULT '',
  description TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  occurred_at TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(occurred_at);

CREATE TABLE IF NOT EXISTS email_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_email TEXT DEFAULT '',
  access_token TEXT DEFAULT '',
  refresh_token TEXT DEFAULT '',
  expires_at INTEGER DEFAULT 0,
  connected_at TEXT
);

CREATE TABLE IF NOT EXISTS email_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE,
  bank TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  snippet TEXT DEFAULT '',
  weblink TEXT DEFAULT '',
  type TEXT,
  amount INTEGER,
  merchant TEXT DEFAULT '',
  occurred_at TEXT,
  category_id INTEGER,
  account_id INTEGER,
  confidence REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  transaction_id INTEGER,
  received_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at INTEGER
);
`);

// migraciones suaves: columnas de moneda
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
ensureColumn('transactions', 'currency', "TEXT DEFAULT 'CRC'");
ensureColumn('transactions', 'fx_rate', 'REAL DEFAULT 1');
ensureColumn('email_imports', 'currency', "TEXT DEFAULT 'CRC'");

const DEFAULT_SETTINGS = {
  currency: 'CRC',
  monthly_budget: '0',
  auto_approve: '0',
  sender_filters: '',
  sync_days: '30',
  last_sync_at: '',
  azure_client_id: '',
  azure_client_secret: '',
  bccr_email: '',
  bccr_token: '',
  usd_rate_manual: '0',
  openrouter_key: '',
  openrouter_model: 'z-ai/glm-5.3-flash',
  sms_webhook_token: '',
  sms_sender_filter: '+50670701222',
};

const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

const EXPENSE_CATEGORIES = [
  ['Supermercado', 'cart', 'gold'],
  ['Restaurantes', 'utensils', 'coral'],
  ['Transporte', 'car', 'sky'],
  ['Hogar', 'home', 'violet'],
  ['Servicios', 'plug', 'sand'],
  ['Salud', 'heart', 'mint'],
  ['Educación', 'book', 'teal'],
  ['Entretenimiento', 'clapperboard', 'plum'],
  ['Suscripciones', 'repeat', 'sky'],
  ['Viajes', 'plane', 'violet'],
  ['Ropa', 'shirt', 'coral'],
  ['Tecnología', 'cpu', 'gold'],
  ['Otros gastos', 'tag', 'sand'],
];
const INCOME_CATEGORIES = [
  ['Salario', 'banknote', 'mint'],
  ['Freelance', 'laptop', 'sky'],
  ['Inversiones', 'trending-up', 'gold'],
  ['Reembolsos', 'undo', 'teal'],
  ['Otros ingresos', 'plus', 'sand'],
];

const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (catCount === 0) {
  const ins = db.prepare('INSERT INTO categories (name, kind, icon, color) VALUES (?, ?, ?, ?)');
  for (const [name, icon, color] of EXPENSE_CATEGORIES) ins.run(name, 'expense', icon, color);
  for (const [name, icon, color] of INCOME_CATEGORIES) ins.run(name, 'income', icon, color);
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));
}
export function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
