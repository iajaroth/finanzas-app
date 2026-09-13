// Emparejamiento de comercios con marcas: logo SVG (simple-icons) o monograma
export interface Brand {
  key: string;
  name: string;
  color: string;      // color de marca (fondo del monograma)
  file?: string;      // logo en /brands/<file>.svg
  mono?: string;      // siglas para monograma
  match: RegExp;
}

const LIST: Brand[] = [
  // internacionales con logo
  { key: 'netflix', name: 'Netflix', color: '#E50914', file: 'netflix', match: /netflix/i },
  { key: 'uber', name: 'Uber', color: '#111111', file: 'uber', match: /\buber\b/i },
  { key: 'spotify', name: 'Spotify', color: '#1DB954', file: 'spotify', match: /spotify/i },
  { key: 'aliexpress', name: 'AliExpress', color: '#FF4747', file: 'aliexpress', match: /aliexpress/i },
  { key: 'youtube', name: 'YouTube', color: '#FF0000', file: 'youtube', match: /youtube/i },
  { key: 'whatsapp', name: 'WhatsApp', color: '#25D366', file: 'whatsapp', match: /whats/i },
  { key: 'waze', name: 'Waze', color: '#33CCFF', file: 'waze', match: /\bwaze\b/i },
  { key: 'google', name: 'Google', color: '#4285F4', file: 'google', match: /google/i },
  { key: 'apple', name: 'Apple', color: '#111111', file: 'apple', match: /\bapple\b|icloud/i },
  { key: 'anthropic', name: 'Anthropic', color: '#191919', file: 'anthropic', match: /anthropic|claude/i },
  { key: 'carrefour', name: 'Carrefour', color: '#004E9F', file: 'carrefour', match: /carrefour/i },
  { key: 'mcdonalds', name: "McDonald's", color: '#FFC72C', file: 'mcdonalds', match: /mcdonald/i },
  { key: 'starbucks', name: 'Starbucks', color: '#006241', file: 'starbucks', match: /starbucks/i },
  { key: 'paypal', name: 'PayPal', color: '#003087', file: 'paypal', match: /paypal/i },
  { key: 'visa', name: 'Visa', color: '#1A1F71', file: 'visa', match: /\bvisa\b/i },
  { key: 'mastercard', name: 'Mastercard', color: '#EB001B', file: 'mastercard', match: /mastercard/i },
  { key: 'mercadopago', name: 'Mercado Pago', color: '#00B1EA', file: 'mercadopago', match: /mercado ?pago|merpago/i },
  { key: 'ebay', name: 'eBay', color: '#E53238', file: 'ebay', match: /\bebáy?\b|\bebaj\b|\bebáy\b|\bebay\b/i },
  { key: 'nike', name: 'Nike', color: '#111111', file: 'nike', match: /\bnike\b/i },
  { key: 'adidas', name: 'Adidas', color: '#111111', file: 'adidas', match: /adidas/i },
  { key: 'samsung', name: 'Samsung', color: '#1428A0', file: 'samsung', match: /samsung/i },
  { key: 'xiaomi', name: 'Xiaomi', color: '#FF6900', file: 'xiaomi', match: /xiaomi|\bmi store\b/i },
  { key: 'steam', name: 'Steam', color: '#66c0f4', file: 'steam', match: /\bsteam\b/i },
  { key: 'playstation', name: 'PlayStation', color: '#0070D1', file: 'playstation', match: /playstation|\bpsn\b/i },
  { key: 'telegram', name: 'Telegram', color: '#26A5E4', file: 'telegram', match: /telegram/i },
  { key: 'glovo', name: 'Glovo', color: '#00A082', file: 'glovo', match: /glovo/i },
  { key: 'airbnb', name: 'Airbnb', color: '#FF5A5F', file: 'airbnb', match: /airbnb/i },

  // sin logo público: monograma
  { key: 'zai', name: 'Z.ai', color: '#111111', mono: 'Z', match: /\bz\.?ai\b|\bzai\b/i },
  { key: 'openai', name: 'OpenAI', color: '#10A37F', mono: 'AI', match: /openai|chatgpt/i },
  { key: 'xbox', name: 'Xbox', color: '#107C10', mono: 'X', match: /\bxbox\b/i },
  { key: 'shein', name: 'Shein', color: '#F7E017', mono: 'S', match: /shein/i },
  { key: 'temu', name: 'Temu', color: '#FB7701', mono: 'T', match: /\btemu\b/i },
  { key: 'walmart', name: 'Walmart', color: '#0071CE', mono: 'W', match: /walmart/i },
  { key: 'amazon', name: 'Amazon', color: '#FF9900', mono: 'a', match: /amazon/i },
  { key: 'lucid', name: 'Lucid Trading', color: '#c9f53f', mono: 'LT', match: /lucid/i },
  { key: 'd1', name: 'Tiendas D1', color: '#FFDD00', mono: 'D1', match: /\bd1\b|tiendas d1/i },
  { key: 'exito', name: 'Éxito', color: '#FFE600', mono: 'É', match: /\béxito\b|\bexito\b/i },
  { key: 'olivo', name: 'Super Olivo', color: '#6B8E23', mono: 'SO', match: /olivo/i },
  { key: 'fino', name: 'Super Fino', color: '#E4002B', mono: 'SF', match: /super fino/i },
  { key: 'aliss', name: 'Aliss', color: '#D22630', mono: 'AL', match: /aliss/i },
  { key: 'freshmarket', name: 'Fresh Market', color: '#00A651', mono: 'FM', match: /fresh market/i },
  { key: 'ferremarket', name: 'Ferremarket', color: '#8BC53F', mono: 'FR', match: /ferremarket/i },
  { key: 'minisuper', name: 'Minisuper', color: '#F7941D', mono: 'M', match: /minisuper/i },
  { key: 'villasol', name: 'Lácteos Villa Sol', color: '#0F6CB4', mono: 'VS', match: /villa sol|lacteos villa/i },
  { key: 'telecable', name: 'Telecable', color: '#0072BC', mono: 'TC', match: /telecable|cobrolinea/i },
  { key: 'dlc', name: 'DLC', color: '#7A7A7A', mono: 'DLC', match: /\bdlc\b/i },
  { key: 'juanvaldez', name: 'Juan Valdez', color: '#7B4B2A', mono: 'JV', match: /juan valdez/i },
  { key: 'yoha', name: 'Pizza Yoha', color: '#D62828', mono: 'PY', match: /yoha/i },
  { key: 'monchister', name: 'Monchister', color: '#F26522', mono: 'MO', match: /monchister/i },
  { key: 'trululu', name: 'Tienda Trululu', color: '#F7941E', mono: 'TT', match: /trululu/i },
  { key: 'minicuotas', name: 'Minicuotas', color: '#00A3E0', mono: 'MC', match: /minicuotas/i },
  { key: 'sinpe', name: 'SINPE', color: '#0099DF', mono: 'S', match: /sinpe/i },
  { key: 'bac', name: 'BAC', color: '#E4002B', mono: 'BAC', match: /\bbac\b|baccredomatic/i },
  { key: 'davibank', name: 'DaviBank', color: '#ED1C24', mono: 'DB', match: /davibank|davivienda/i },
  { key: 'claro', name: 'Claro', color: '#DA291C', mono: 'C', match: /\bclaro\b/i },
];

export function matchBrand(merchant: string | null | undefined): Brand | null {
  if (!merchant) return null;
  for (const b of LIST) if (b.match.test(merchant)) return b;
  return null;
}

export function readableText(bgHex: string): string {
  const h = bgHex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0c0b' : '#ffffff';
}
