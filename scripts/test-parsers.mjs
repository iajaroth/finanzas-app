import { parseBankEmail } from '../server/parsers.js';

// formatos reales observados: BAC Costa Rica, Davivienda CR, Nu CO, Bancolombia
const samples = [
  {
    name: 'BAC CR - gasto Uber (monto solo en el cuerpo)',
    data: {
      subject: 'Notificación de transacción UBER BV USD-USD COSTA 04-09-2026 - 17:06',
      preview: 'Estimado cliente: Le informamos que su tarjeta ha sido utilizada.',
      body: 'Estimado cliente: Le informamos que el 04-09-2026 a las 17:06 se realizó una transacción con su tarjeta terminada en 4521. Comercio: UBER BV. Monto: USD 12.50. Si no reconoce esta transacción comuníquese al 2522-4900.',
      fromAddress: 'NotificacionBAC@baccredomatic.com', fromName: 'BAC | Notificaciones', receivedAt: '2026-09-04T23:06:00Z',
    },
  },
  {
    name: 'BAC CR - colones',
    data: {
      subject: 'Notificación de transacción SODIMAC CR 03-09-2026 - 09:12',
      preview: 'Estimado cliente:',
      body: 'Se realizó una transacción por ₡45.300,00 con su tarjeta ****7788 en SODIMAC CR el 03-09-2026.',
      fromAddress: 'NotificacionBAC@baccredomatic.cr', fromName: 'BAC', receivedAt: '2026-09-03T15:12:00Z',
    },
  },
  {
    name: 'Davivienda CR - compra',
    data: {
      subject: 'Davivienda - Compra aprobada',
      preview: 'Su compra por USD 85,00 en AUTOMERCADO fue aprobada. Tarjeta terminada en 3312.',
      body: '',
      fromAddress: 'notificaciones@davibank.cr', fromName: 'Davivienda', receivedAt: '2026-09-02T14:00:00Z',
    },
  },
  {
    name: 'Nu CO - gasto con monto en asunto',
    data: {
      subject: 'Compra aprobada por $45.900,00 en TIENDAS D1',
      preview: 'Tu tarjeta terminada en 8899 fue usada hoy por $45.900,00 en TIENDAS D1',
      body: '',
      fromAddress: 'notificaciones@nu.com.co', fromName: 'Nu Colombia', receivedAt: '2026-09-05T19:32:00Z',
    },
  },
  {
    name: 'Newsletter (debe ignorarse)',
    data: {
      subject: '🛍️ Descubre dónde ganar más millas por tus compras',
      preview: 'Acumula millas extra en tus compras de septiembre',
      body: '',
      fromAddress: 'lifemiles@newsletter.lifemiles.com', fromName: 'Lifemiles', receivedAt: '2026-09-05T10:00:00Z',
    },
  },
  {
    name: 'Cashback LetyShops (debe ignorarse)',
    data: {
      subject: 'Nuevo cashback 0.36 $ de la tienda AliExpress',
      preview: 'Tu cashback fue confirmado',
      body: '',
      fromAddress: 'info@letyshops.com', fromName: 'LetyShops', receivedAt: '2026-09-04T10:00:00Z',
    },
  },
];

for (const s of samples) {
  const r = parseBankEmail(s.data);
  console.log(
    r
      ? `OK | ${s.name}\n     → ${r.type} ${r.currency} ${(r.amount / 100).toLocaleString('es')} | bank=${r.bank} | merch=${r.merchant || '-'} | cat=${r.category_name} | conf=${r.confidence.toFixed(2)}`
      : `-- | ${s.name} (ignorado)`
  );
}
