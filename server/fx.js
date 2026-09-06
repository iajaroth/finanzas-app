// Tipo de cambio USD→CRC con caché.
// Fuentes (en orden): BCCR oficial (si hay correo+token registrados),
// API de Hacienda (gratis, tasa del día), tasa manual en ajustes.
import { db, getSetting, setSetting } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS fx_rates (
  date TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  source TEXT DEFAULT ''
)`);

const insRate = db.prepare('INSERT OR REPLACE INTO fx_rates (date, rate, source) VALUES (?, ?, ?)');
const getRateRow = db.prepare('SELECT rate, source FROM fx_rates WHERE date = ?');

function bccrConfig() {
  const email = process.env.BCCR_EMAIL || getSetting('bccr_email') || '';
  const token = process.env.BCCR_TOKEN || getSetting('bccr_token') || '';
  return { email, token, configured: Boolean(email && token) };
}

export function fxStatus() {
  return { ...bccrConfig(), has_token: Boolean(bccrConfig().token) };
}

function crcDate(dateIso) {
  // fecha en zona horaria de Costa Rica (UTC-6) para elegir la tasa correcta
  const d = new Date(new Date(dateIso).getTime() - 6 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function toDdMmYyyy(dateIso) {
  const [y, m, d] = dateIso.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchBccr(dateIso) {
  const { email, token } = bccrConfig();
  const url = `https://indicadoreseconomicos.bccr.fi.cr/indicadoreseconomicos/WebServices/wsindicadoreseconomicos.asmx/ObtenerIndicadoresEconomicosXML` +
    `?FechaInicio=${encodeURIComponent(toDdMmYyyy(dateIso))}&FechaFinal=${encodeURIComponent(toDdMmYyyy(dateIso))}` +
    `&Nombre=318&Subniveles=N&Correo=${encodeURIComponent(email)}&Token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`BCCR ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<NUM_VALOR>([\d.]+)<\/NUM_VALOR>/i);
  if (!m) throw new Error('BCCR sin datos para esa fecha');
  const rate = parseFloat(m[1]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('BCCR valor inválido');
  return { rate, source: 'BCCR' };
}

async function fetchHacienda(dateIso) {
  const res = await fetch('https://api.hacienda.go.cr/tc/indicadores', { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Hacienda ${res.status}`);
  const data = await res.json();
  const venta = Number(data?.dolar?.venta);
  if (!Number.isFinite(venta) || venta <= 0) throw new Error('Hacienda sin venta');
  return { rate: venta, source: 'Hacienda (día)' };
}

// Devuelve { rate, source } — colones por dólar para la fecha indicada (ISO).
export async function getUsdRate(dateIso) {
  const date = crcDate(dateIso || new Date().toISOString());
  const cached = getRateRow.get(date);
  if (cached) return { rate: cached.rate, source: cached.source };

  if (bccrConfig().configured) {
    try {
      const r = await fetchBccr(date);
      insRate.run(date, r.rate, r.source);
      return r;
    } catch { /* cae a Hacienda */ }
  }
  try {
    const r = await fetchHacienda(date);
    insRate.run(date, r.rate, r.source);
    return r;
  } catch { /* cae a manual */ }

  const manual = parseFloat(getSetting('usd_rate_manual') || '0');
  if (Number.isFinite(manual) && manual > 0) {
    const r = { rate: manual, source: 'manual' };
    insRate.run(date, r.rate, r.source);
    return r;
  }
  // último recurso: cualquier tasa reciente cacheada
  const any = db.prepare('SELECT rate, source FROM fx_rates ORDER BY date DESC LIMIT 1').get();
  if (any) return { rate: any.rate, source: `${any.source} (reciente)` };
  return { rate: 0, source: 'indisponible' };
}

export function setManualRate(rate) {
  if (Number.isFinite(rate) && rate > 0) setSetting('usd_rate_manual', String(rate));
}
