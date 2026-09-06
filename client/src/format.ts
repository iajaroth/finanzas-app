const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const CURRENCY_LOCALE: Record<string, string> = {
  COP: 'es-CO', USD: 'en-US', EUR: 'es-ES', MXN: 'es-MX', ARS: 'es-AR', CLP: 'es-CL', PEN: 'es-PE', BRL: 'pt-BR',
};

export function formatMoney(cents: number, currency = 'COP', opts: { sign?: boolean } = {}): string {
  const value = cents / 100;
  const locale = CURRENCY_LOCALE[currency] || 'es-CO';
  const hasCents = cents % 100 !== 0;
  const str = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(Math.abs(value));
  if (opts.sign && value > 0) return `+${str}`;
  if (opts.sign && value < 0) return `−${str}`;
  return value < 0 ? `−${str}` : str;
}

// parsea "45.000", "45,000.50", "45000" a centavos
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  let num: number;
  if (hasComma && hasDot) {
    const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
    num = lastC > lastD ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/,/g, ''));
  } else if (hasComma) {
    const parts = s.split(',');
    num = parts.length === 2 && parts[1].length <= 2 ? parseFloat(s.replace(',', '.')) : parseFloat(s.replace(/,/g, ''));
  } else if (hasDot) {
    const parts = s.split('.');
    num = parts.length === 2 && parts[1].length <= 2 && parts[0].length <= 3 ? parseFloat(s) : parseFloat(s.replace(/\./g, ''));
  } else {
    num = parseFloat(s);
  }
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-').map(Number);
  const names = long ? MONTHS_LONG : MONTHS;
  return `${names[m - 1]} ${y}`;
}

export function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Hoy';
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso === yesterday) return 'Ayer';
  const [, m, day] = iso.split('-').map(Number);
  const year = iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : '';
  return `${day} ${MONTHS[m - 1]}${year}`;
}

export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
