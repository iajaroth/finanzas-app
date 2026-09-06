import { parseBankEmail } from '../server/parsers.js';

const samples = [
  { subject: 'Compra aprobada por $45.900,00 en TIENDAS D1', preview: 'Tu tarjeta terminada en 8899 fue usada hoy 05/09/2026 a las 14:32 por $45.900,00 en TIENDAS D1 AV 68', fromAddress: 'notificaciones@nu.com.co', fromName: 'Nu Colombia', receivedAt: '2026-09-05T19:32:00Z' },
  { subject: 'Bancolombia: Transferencia recibida - $450.000,00', preview: 'Recibiste una transferencia por $450.000,00 de JUAN PEREZ a tu cuenta de ahorros. Saldo disponible $2.904.100,00', fromAddress: 'notificaciones@bancolombia.com.co', fromName: 'Bancolombia', receivedAt: '2026-09-01T13:00:00Z' },
  { subject: 'Recibiste $50.000', preview: 'María te envió $50.000 por Nequi. Ya están disponibles en tu cuenta.', fromAddress: 'no-reply@nequi.com.co', fromName: 'Nequi', receivedAt: '2026-09-03T16:20:00Z' },
  { subject: 'Pagaste $89.900,00 en NETFLIX.COM', preview: 'Compra por $89.900,00 con tu tarjeta •••• 8899. Si no reconoces esta compra llámanos.', fromAddress: 'aviso@nu.com.co', fromName: 'Nu', receivedAt: '2026-09-04T08:00:00Z' },
  { subject: 'Confirmación de tu compra en Uber', preview: 'Tu viaje está confirmado. Total pagado: $12.000,00 con tarjeta Visa terminada en 1234', fromAddress: 'noreply@uber.com', fromName: 'Uber', receivedAt: '2026-09-03T02:10:00Z' },
  { subject: 'Newsletter semanal de tecnología', preview: 'Las 10 mejores apps de la semana, no te las pierdas', fromAddress: 'news@medium.com', fromName: 'Medium', receivedAt: '2026-09-02T10:00:00Z' },
  { subject: 'Davivienda: Retiro por $200.000,00', preview: 'Retiro en cajero por $200.000,00 de su cuenta terminada en 5521. Saldo $1.350.000,00', fromAddress: 'notificaciones@davivienda.com', fromName: 'Davivienda', receivedAt: '2026-09-02T21:45:00Z' },
  { subject: 'Tu compra de $1.250.000 en EXITO STORES', preview: 'Aprobamos tu compra por $1.250.000,00 en EXITO STORES con la tarjeta terminada en 4432', fromAddress: 'no-reply@bbva.com', fromName: 'BBVA Colombia', receivedAt: '2026-09-06T15:00:00Z' },
];

for (const s of samples) {
  const r = parseBankEmail(s);
  console.log(
    r
      ? `${s.fromAddress.padEnd(36)} → ${r.type.padEnd(7)} ${String(r.amount / 100).padStart(10)}  bank=${(r.bank || '-').padEnd(12)} merch=${(r.merchant || '-').padEnd(14)} cat=${r.category_name} conf=${r.confidence}`
      : `${s.fromAddress.padEnd(36)} → (ignorado)`
  );
}
