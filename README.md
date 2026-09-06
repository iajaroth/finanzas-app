# Finanzas · Night Ledger

App personal de finanzas: gastos, ingresos, cuentas/tarjetas, estadísticas y **sincronización automática desde tu correo de Outlook** (los avisos de los bancos se convierten en transacciones).

- **Web** desplegada en Coolify → `https://financiera.jbsautomation.online`
- **PWA instalable** en el celular desde el navegador (menú → "Añadir a pantalla de inicio")
- **APK Android** vía GitHub Actions (Capacitor)

## Funciones

| Área | Qué hace |
| --- | --- |
| Resumen | Balance total, ingresos/gastos del mes, presupuesto, donut por categoría, tendencia 6 meses |
| Movimientos | CRUD completo, filtros (mes, tipo, cuenta, categoría, búsqueda), transferencias entre cuentas |
| Cuentas | Bancos, tarjetas de crédito (cupo y deuda), efectivo, billeteras; saldo calculado automáticamente |
| Estadísticas | ¿En qué se gasta? (categorías), ¿cómo se gasta? (cuenta/método), top comercios, tendencia 12 meses |
| Correo | Conexión OAuth con Outlook (Microsoft Graph), parsing de avisos bancarios, cola de revisión |
| Ajustes | Moneda, presupuesto, categorías personalizadas, exportar datos JSON |

### Bancos reconocidos por el parser
Bancolombia, Nequi, Davivienda, BBVA, Banco de Bogotá, Scotiabank Colpatria, Nu, Movii, Dale!, Addi, Mercado Pago, PayPal, Lulo, Caja Social, Itaú, Falabella, Citibank… más correos de comercios (Uber, Rappi, Amazon) y dominios extra configurables en Ajustes → Correo.

## Conectar Outlook (una sola vez, ~5 min)

Microsoft exige registrar la app en Azure para poder leer tu correo con OAuth:

1. Entra a [portal.azure.com](https://portal.azure.com) → **Registros de aplicaciones** → **Nuevo registro**.
2. Nombre: `finanzas` · Tipos de cuenta: **Cuentas en cualquier directorio organizativo y cuentas Microsoft personales**.
3. URI de redirección (tipo **Web**): `https://financiera.jbsautomation.online/correo/callback`
4. Copia el **Id. de aplicación (cliente)**.
5. **Certificados y secretos** → **Nuevo secreto de cliente** → copia el **valor**.
6. **Permisos de API** → Microsoft Graph → **Permisos delegados**: `Mail.Read`, `User.Read`, `offline_access`.

Pega Client ID y Secret en **Ajustes → Correo** dentro de la app (también sirven las variables `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`). Luego pulsa **Conectar con Microsoft**, autoriza, y **Sincronizar ahora**.

Las transacciones detectadas quedan en una **cola de revisión** (monto, banco, comercio y categoría sugeridos) o se aprueban solas si activas "Aprobación automática".

## Despliegue (Coolify)

- Repositorio público GitHub → build con `Dockerfile` (node:24-alpine), puerto `3000`.
- Volumen persistente: `/app/data` (SQLite).
- Health check: `GET /api/health`.
- Variables de entorno:

| Variable | Descripción |
| --- | --- |
| `AUTH_EMAIL` / `AUTH_PASSWORD` | Credenciales del único usuario |
| `JWT_SECRET` / `APP_SECRET` | Secretos aleatorios (`openssl rand -hex 32`) |
| `APP_URL` | `https://financiera.jbsautomation.online` (construye el redirect OAuth) |
| `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT` | Opcional si se configura desde la app |

## APK

1. GitHub → pestaña **Actions** → **Build APK** → **Run workflow**.
2. Descarga el artefacto `finanzas-apk` e instálalo (permite "orígenes desconocidos").
3. La app del celular apunta a `https://financiera.jbsautomation.online` (misma cuenta y datos).

Alternativa sin APK: abre la web en el celular y usa **Añadir a pantalla de inicio**.

## Desarrollo local

```bash
npm install                       # servidor
cd client && npm install && cd .. # cliente
# Variables mínimas:
#   AUTH_EMAIL, AUTH_PASSWORD, JWT_SECRET, APP_SECRET, DATA_DIR=./data
npm run dev        # API en :3000
npm run dev:client # Vite en :5173 (proxy /api)
```

Stack: React 19 + Vite + TypeScript (sin Tailwind, CSS con design tokens), Express + `node:sqlite`, Microsoft Graph. Diseño: tema oscuro "Night Ledger" (atmospheric: acento dorado único, Tomorrow + Geist + Geist Mono, blooms radiales fijos).
