// Clasificación de correos bancarios con IA (OpenRouter), opcional.
// Decide income/expense/transfer y mapea cuentas propias para transferencias.
import { getSetting } from './db.js';

export function openRouterConfig() {
  const key = process.env.OPENROUTER_KEY || getSetting('openrouter_key') || '';
  const model = getSetting('openrouter_model') || 'openai/gpt-4o-mini';
  return { key, model, configured: Boolean(key) };
}

export function openRouterStatus() {
  return openRouterConfig();
}

// Devuelve { tipo, cuenta_origen, cuenta_destino, confianza, razon } o null.
export async function classifyWithAI({ subject = '', snippet = '', fromEmail = '', accounts = [] }) {
  const { key, model, configured } = openRouterConfig();
  if (!configured || !accounts.length) return null;
  const accountList = accounts
    .map((a) => `- id ${a.id}: "${a.name}" (${a.bank || 'sin banco'}, ${a.kind === 'credit_card' ? 'tarjeta de crédito' : a.kind === 'bank' ? 'cuenta débito' : a.kind})`)
    .join('\n');
  const sys = `Clasificas notificaciones bancarias personales de un usuario en Costa Rica.
Cuentas propias del usuario:
${accountList}

Devuelve ÚNICAMENTE un JSON válido, sin texto extra:
{"tipo":"income|expense|transfer","cuenta_origen":<id o null>,"cuenta_destino":<id o null>,"confianza":<0.0-1.0>,"razon":"<máx 12 palabras>"}

Reglas:
- income: dinero que ENTRA al usuario desde un tercero (SINPE recibido, abono, pago de cliente, salario). cuenta_destino = la cuenta propia que lo recibió; cuenta_origen = null.
- expense: compra, pago o cobro a un tercero (comercios, suscripciones, retiros). cuenta_origen = la cuenta/tarjeta propia con la que se pagó; cuenta_destino = null.
- transfer: movimiento entre DOS cuentas propias del usuario (enviarse dinero de un banco a otro). cuenta_origen y cuenta_destino = los ids correspondientes.
- Usa los ids exactos de la lista. Si no puedes determinar una cuenta propia, usa null.
- Si el correo es ambiguo, baja la confianza.`;
  const user = `De: ${fromEmail}\nAsunto: ${subject}\n\nCuerpo:\n${snippet.slice(0, 1200)}`;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://financiera.jbsautomation.online',
        'X-Title': 'finanzas',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 160,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!['income', 'expense', 'transfer'].includes(parsed.tipo)) return null;
    return {
      tipo: parsed.tipo,
      cuenta_origen: Number.isFinite(parsed.cuenta_origen) ? parsed.cuenta_origen : null,
      cuenta_destino: Number.isFinite(parsed.cuenta_destino) ? parsed.cuenta_destino : null,
      confianza: Number(parsed.confianza) || 0,
      razon: String(parsed.razon || '').slice(0, 60),
    };
  } catch {
    return null;
  }
}

// Recategorización: asigna una categoría de gasto existente a un movimiento
export async function categorizeWithAI({ detail = '', amount = 0, categories = [] }) {
  const { key, model, configured } = openRouterConfig();
  if (!configured || !categories.length) return null;
  const sys = `Clasificas gastos personales en Costa Rica. Devuelve ÚNICAMENTE el nombre exacto de UNA categoría de esta lista, sin nada más:
${categories.map((c) => `- ${c.name}`).join('\n')}`;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://financiera.jbsautomation.online', 'X-Title': 'finanzas' },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: 4000, reasoning: { exclude: true },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: `Detalle: ${detail}\nMonto: ₡${Math.round(amount / 100)}` }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    const text = (msg.content || '').trim() || String(msg.reasoning || '').split('\n').filter(Boolean).slice(-1)[0] || '';
    const clean = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü\s]/g, '').trim();
    return categories.find((c) => c.name.toLowerCase() === clean.toLowerCase())?.name ?? null;
  } catch {
    return null;
  }
}
