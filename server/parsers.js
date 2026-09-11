// Detectores de bancos colombianos y extracción de datos desde correos

export const BANK_SENDERS = [
  { bank: 'Bancolombia', re: /bancolombia\.com\.co|bancolombia/i },
  { bank: 'Nequi', re: /nequi\.com\.co|nequi/i },
  { bank: 'Davivienda', re: /davivienda\.com/i },
  { bank: 'DaviBank', re: /davibank\.cr/i },
  { bank: 'BAC Credomatic', re: /baccredomatic|@bac\.|bac\.net/i },
  { bank: 'BBVA', re: /bbva\.com/i },
  { bank: 'Banco de Bogotá', re: /bancobogota\.com\.co|bancodebogota/i },
  { bank: 'Scotiabank Colpatria', re: /scotiabank|colpatria/i },
  { bank: 'Nu', re: /@nu\.com\.co|@nu\.com\.br|nu\.com\.co/i },
  { bank: 'Movii', re: /movii\.com\.co|movii/i },
  { bank: 'Dale!', re: /dale\.com\.co/i },
  { bank: 'Addi', re: /addi\.com\.co|addi/i },
  { bank: 'Mercado Pago', re: /mercadopago\.com/i },
  { bank: 'PayPal', re: /paypal\.com/i },
  { bank: 'Lulobank', re: /lulo\.co|lulobank/i },
  { bank: 'Banco Agrario', re: /bancagrario\.gov\.co|agrario/i },
  { bank: 'Banco Caja Social', re: /casocial\.com|caja social/i },
  { bank: 'Citibank', re: /citi\.com|citibank/i },
  { bank: 'Itaú', re: /itau\.com\.co|itau/i },
  { bank: 'Banco Falabella', re: /bancofalabella\.com\.co|falabella/i },
  { bank: 'Amazon', re: /amazon\.com/i },
  { bank: 'Uber', re: /uber\.com/i },
  { bank: 'Rappi', re: /rappi\.com/i },
];

export function detectBank(fromAddress = '', fromName = '') {
  const hay = `${fromAddress} ${fromName}`;
  for (const b of BANK_SENDERS) if (b.re.test(hay)) return b.bank;
  return '';
}

// bancos mencionados dentro del texto (para SMS reenviados, donde el remitente
// es la app de reenvío y no el banco)
const CONTENT_BANKS = [
  { bank: 'BAC Credomatic', re: /\bBAC\b/ },
  { bank: 'DaviBank', re: /\bdavi\s?bank\b/i },
  { bank: 'Davivienda', re: /\bdavivienda\b/i },
  { bank: 'Bancolombia', re: /\bbancolombia\b/i },
  { bank: 'Nequi', re: /\bnequi\b/i },
];

export function detectBankInText(text = '') {
  if (!text) return '';
  for (const b of CONTENT_BANKS) if (b.re.test(text)) return b.bank;
  return '';
}

// fechas estilo latino dd/mm/yyyy dentro del texto (los SMS traen la fecha del movimiento)
export function extractLatinDate(text = '') {
  const m = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (+mo > 12 || +d > 31) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ---- Montos (formatos es-CO/es-CR, en-US; COP, USD, CRC/₡, COL) ----

function normalizeAmountToken(raw, currencyHint = '') {
  let s = raw.replace(/\s/g, '');
  if (!/^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?$|^\d+[.,]\d{2}$|^\d+$/.test(s)) return null;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  // hint en formato: monedas con decimales al estilo US/EU (USD, EUR)
  const hintIsEn = /USD|US\$|EUR/i.test(currencyHint);
  let cents;
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      cents = BigInt(Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 100));
    } else {
      cents = BigInt(Math.round(parseFloat(s.replace(/,/g, '')) * 100));
    }
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) cents = BigInt(Math.round(parseFloat(s.replace(',', '.')) * 100));
    else cents = BigInt(parseInt(s.replace(/,/g, ''), 10)) * 100n;
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2 && parts[0].length <= 3) {
      // "123.45" — ambiguo: es miles en COP/CRC, decimales en USD/EUR
      if (hintIsEn) cents = BigInt(Math.round(parseFloat(s) * 100));
      else cents = BigInt(parseInt(s.replace(/\./g, ''), 10)) * 100n;
    } else if (parts.length === 2 && parts[1].length <= 2) {
      cents = BigInt(Math.round(parseFloat(s) * 100));
    } else {
      cents = BigInt(parseInt(s.replace(/\./g, ''), 10)) * 100n;
    }
  } else {
    cents = BigInt(parseInt(s, 10)) * 100n;
  }
  const n = Number(cents);
  if (!Number.isFinite(n) || n < 100 || n > 50_000_000_000_00) return null;
  return n;
}

const CURRENCY_PREFIX = /USD|US\$|COP|CRC|COL|EUR|MXN|₡|\$|€/;
const CURRENCY_SUFFIX = /COP|USD|CRC|COL|EUR|Colones|colones/;

// detecta la moneda del token encontrado: CRC por defecto, USD si el marcador lo indica
function currencyOf(marker = '', base = 'CRC') {
  if (/USD|US\$/i.test(marker)) return 'USD';
  if (/€/i.test(marker)) return 'EUR';
  if (/COP/i.test(marker)) return 'COP';
  if (/₡|CRC|COL/i.test(marker)) return 'CRC';
  return base; // "$" ambiguo → moneda base del usuario
}

export function parseAmount(text, base = 'CRC') {
  if (!text) return null;
  const re = new RegExp(`(${CURRENCY_PREFIX.source})\\s*([0-9][0-9.,\\s]{0,23})|([0-9][0-9.,]{0,23})\\s*(${CURRENCY_SUFFIX.source})`, 'gi');
  let m;
  const candidates = [];
  while ((m = re.exec(text)) !== null) {
    const hint = m[1] || m[4] || '';
    const raw = (m[2] || m[3] || '').trim().replace(/[.,;\s]+$/, '');
    const amt = normalizeAmountToken(raw, hint);
    if (amt) candidates.push({ cents: amt, currency: currencyOf(hint, base) });
  }
  return candidates[0] ?? null;
}

// ---- Tipo (gasto / ingreso) ----

const INCOME_RE = [
  /transferencia recibida/i, /recibiste/i, /recibió un/i, /recibio un/i, /abono/i, /abonó/i,
  /te enviaron/i, /te envi[óo]/i, /ingres[oó]/i, /dep[óo]sito/i, /consignaci[óo]n/i,
  /reembolso/i, /devoluci[óo]n/i, /recargaste/i, /pago recibido/i, /pago aprobado/i,
  /recibida/i, /acredit/i, /revers/i,
];
const EXPENSE_RE = [
  /compra aprobada/i, /compra por/i, /compraste/i, /compra de/i, /\bcompra\b/i, /pagaste/i,
  /pago realizado/i, /pago de/i, /retiro/i, /d[ée]bito/i, /cobro/i, /consumo/i, /enviaste/i,
  /uso de (tu|la|tarjeta)/i, /adquiriste/i, /suscripci[óo]n/i, /cargo/i, /descont/i,
  /transacci[óo]n (aprobada|realizada)/i, /notificaci[óo]n de transacci[óo]n/i,
];

export function parseType(text) {
  // reglas fuertes primero:
  // - "Ha recibido X por SINPE Móvil" de un tercero = SIEMPRE ingreso
  if (/ha\s+recibido\s+[\d.,]+\s+colones\s+de\s+\S+.*sinpe\s*m[óo]vil/i.test(text) || /recib[íi][óo]\s+una\s+transferencia|transferencia\s+recibida|abono\s+recibido|dep[óo]sito\s+recibido|sinpe\s+recibido/i.test(text)) return 'income';
  // - "transferencia SINPE ... ha sido procesada" = movimiento propio entre bancos = transferencia
  if (/transferencia\s+sinpe/i.test(text) && /ha\s+sido\s+procesada/i.test(text)) return 'transfer';
  // - envíos/débitos enviados = gastos
  if (/env[íi]o\s+exitoso\s+de\s+d[ée]bito|transferencia\s+enviada|enviaste\s+una\s+transferencia|salida\s+por\s+transferencia/i.test(text)) return 'expense';
  let income = 0, expense = 0;
  for (const re of INCOME_RE) if (re.test(text)) income++;
  for (const re of EXPENSE_RE) if (re.test(text)) expense++;
  if (income === 0 && expense === 0) return null;
  if (income > expense) return 'income';
  if (expense > income) return 'expense';
  return 'expense'; // desempate: la mayoría de alertas bancarias son gastos
}

// ---- Comercio / detalle ----

const NOISE_WORDS = /\s+(?:por|el|la|de|del|con|tu|tarjeta|fecha|hoy|d[ií]a|aprobada|aprobado|realizado|mediante)\b.*$/i;

const MERCHANT_NORMALIZE = [
  [/^UBER\b/i, 'Uber'], [/^RAPPI\b/i, 'Rappi'], [/^D1\b/i, 'Tiendas D1'], [/^ARA\b/i, 'Tiendas Ara'],
  [/^EXITO|^ÉXITO/i, 'Éxito'], [/^JUMBO/i, 'Jumbo'], [/^OLIMPICA|^OLÍMPICA/i, 'Olimpica'],
  [/^CARREFOUR/i, 'Carrefour'], [/^NETFLIX/i, 'Netflix'], [/^SPOTIFY/i, 'Spotify'],
  [/^MERPAGO|^MERCADOPAGO/i, 'Mercado Pago'], [/^MERCADO ?LIBRE/i, 'Mercado Libre'],
  [/^AMAZON/i, 'Amazon'], [/^GOOGLE/i, 'Google'], [/^APPLE/i, 'Apple'], [/^STEAM/i, 'Steam'],
  [/^CLARO/i, 'Claro'], [/^MOVISTAR/i, 'Movistar'], [/^TIGO/i, 'Tigo'], [/^EPM\b/i, 'EPM'],
  [/^CRUZ VERDE/i, 'Cruz Verde'], [/^FARMATODO/i, 'Farmatodo'], [/^PETRO/i, 'Estación de gasolina'],
  [/^DIDIPASS|^DIDI/i, 'Didi'], [/^CABIFY/i, 'Cabify'], [/^STARBUCKS/i, 'Starbucks'],
  [/^MCDONALD/i, "McDonald's"], [/^CORONA\b|^CORFACOL/i, 'Corona'],
];

export function extractMerchant(subject = '', preview = '') {
  let text = subject || preview || '';
  const m = text.match(/\b(?:en|En|EN|en línea|en linea|at|via|en www\.)\s+((?:[A-ZÁÉÍÓÚÑÜ0-9][A-Za-zÁÉÍÓÚÑÜ0-9.'"&\- ]{1,38}))/);
  let merchant = m ? m[1] : '';
  if (!merchant) {
    // PATRON MAYUSCULAS seguido de contexto: "TIENDA X" en el asunto
    const up = text.match(/\b([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 .,&'"-]{3,38})\b/);
    merchant = up ? up[1] : '';
  }
  merchant = merchant.replace(NOISE_WORDS, '')
    .replace(/\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}[\s-].*$/, '') // fechas/horas arrastradas
    .replace(/\s{2,}/g, ' ').replace(/[.,;:]+$/, '').trim();
  if (!merchant) return '';
  for (const [re, name] of MERCHANT_NORMALIZE) {
    if (re.test(merchant)) return name;
  }
  return merchant.length > 40 ? merchant.slice(0, 40) : merchant;
}

// ---- Últimos 4 dígitos de tarjeta ----

export function extractLast4(text = '') {
  const m = text.match(/(?:\*{2,}|x{2,}|•{2,}|\*{4,}|XXXX\s?)(\d{4})|terminada en\s+(\d{4})|\.(\d{4})[\s.,]|en línea\s+\*+(\d{4})/i);
  return m ? (m[1] || m[2] || m[3] || m[4]) : '';
}

// ---- Categoría sugerida por comercio/palabra clave ----

const CATEGORY_RULES = [
  ['Transporte', /uber|didi|cabify|taxi|gasolin|petro|combustib|parquead|peaje|metro|transmilenio|sitr/i],
  ['Supermercado', /supermerc|super\s(olivo|fino|mas)\b|d1\b|tiendas ara|exito|éxito|jumbo|olimpica|olímpica|carrefour|mercadona|wal-mart|walmart|costco|arian|la rebaja|supertienda|surtidor/i],
  ['Restaurantes', /restaurante|mcdonald|burger|pizza|sushi|cafe|café|starbucks|juan valdez|comida|rappi restaurant/i],
  ['Suscripciones', /netflix|spotify|disney|hbo|max\b|prime video|crunchyroll|youtube premium|apple music|deezer|canva|notion|openai|chatgpt|claude|icloud|onedrive|dropbox/i],
  ['Tecnología', /apple|google play|steam|microsoft|xbox|playstation|nintendo|amazon web|aws|hosting|dominio|go daddy|namecheap|software|tienda m/i],
  ['Servicios', /epm\b|claro|movistar|tigo|acueducto|energ[ií]|gas natural|internet|tel[eé]fono|seguro|aseguradora|arrendamiento|administraci[óo]n/i],
  ['Salud', /farmacia|cruz verde|farmatodo|droguer|cl[ií]nica|hospital|odont|m[eé]dico|salud|eps\b|prepaid|gimnasio|smart fit|bodytech/i],
  ['Educación', /universidad|colegio|academia|curso|udemy|coursera|platzi|domestika|libros|librer[ií]a|matr[ií]cula/i],
  ['Viajes', /hotel|avianca|aerol[ií]nea|latam|viva air|jetsmart|booking|airbnb|despegar|vuelo|aeropuerto|turismo/i],
  ['Ropa', /zara|h&hm|h&m|nike|adidas|forever 21|prendas|ropa|calzado|zapater[ií]a/i],
  ['Hogar', /arriendo|renta|hipoteca|muebles|ferreter[ií]a|construcció|sodimac|homecenter|decoraci[óo]n|electrodom/i],
  ['Entretenimiento', /cine|cinemark|teatro|concierto|boleter[ií]a|tiquete|parque|juego|playstation store|xbox store|steam/i],
];

export function guessCategory(merchant = '', text = '', kind = 'expense') {
  const hay = `${merchant} ${text}`;
  for (const [name, re] of CATEGORY_RULES) {
    if (re.test(hay)) return name;
  }
  return kind === 'income' ? 'Otros ingresos' : 'Otros gastos';
}

// ---- Parser principal ----

// correos publicitarios: ofrecen montos ("te prestatamos ₡500.000") que no son movimientos
export function isMarketing(subject = '', from = '', text = '') {
  // emojis en el asunto = promo (las alertas reales no usan emojis)
  if (/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]/u.test(subject)) return true;
  // remitentes de campañas (p. ej. info@info.baccredomatic.net)
  if (/@(info|promociones|promo|marketing|news|newsletter|campaigns|email)\./i.test(from)) return true;
  // lenguaje de oferta
  if (/solic[íi]t[ae]l[oa]?|aprov[ée]ch|promoci[óo]n\s|descuento\s|sin\s+inter[ée]ses|d[áa]te\s+ese\s+gusto|tenerle\s+al\s+tanto|no\s+te\s+lo\s+pierdas|oferta\s+exclusiva|prestamo\s+preaprobado|compra\s+ahora\s+y\s+pag[áa]/i.test(text)) return true;
  return false;
}

export function parseBankEmail({ subject = '', preview = '', body = '', fromAddress = '', fromName = '', receivedAt, base = 'CRC' }) {
  if (isMarketing(subject, fromAddress, `${subject} ${preview} ${body}`.slice(0, 1500))) return null;
  const bank = detectBank(fromAddress, fromName);
  const text = `${subject} ${preview}`;
  const searchText = body ? `${text} ${body.replace(/\s{2,}/g, ' ').slice(0, 4000)}` : text;
  // una transacción denegada/rechazada no es un gasto real
  if (/transacci[óo]n\s+(denegada|rechazada|fallida)|compra\s+(denegada|rechazada)|no\s+fue\s+(aprobada|posible)/i.test(searchText)) return null;
  const amount =
    parseAmount(subject, base) ??
    parseAmount(preview, base) ??
    (body ? parseAmount(body.replace(/\s{2,}/g, ' ').slice(0, 600), base) : null) ??
    (body ? parseAmount(body.replace(/\s{2,}/g, ' '), base) : null);
  if (!amount) return null;
  const type = parseType(searchText);
  if (!type) return null;
  const merchant = type === 'transfer' ? '' : (extractMerchant(subject, preview) || (body ? extractMerchant(body.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 300), '') : ''));
  const last4 = extractLast4(searchText);
  // banco por contenido cuando el remitente no es el banco (SMS reenviados)
  const effBank = bank || detectBankInText(searchText);
  // fecha del movimiento: prefiere la fecha dentro del texto (dd/mm/yyyy) sobre la de recepción
  const occurred = extractLatinDate(searchText) || (receivedAt || new Date().toISOString()).slice(0, 10);
  let confidence = 0.35;
  if (effBank) confidence += 0.3;
  if (type) confidence += 0.15;
  if (merchant) confidence += 0.1;
  if (last4) confidence += 0.05;
  const categoryName = guessCategory(merchant, text, type);
  return {
    bank: effBank, amount: amount.cents, currency: amount.currency, type, merchant, last4,
    occurred_at: occurred,
    category_name: categoryName,
    confidence: Math.min(confidence, 0.95),
  };
}
