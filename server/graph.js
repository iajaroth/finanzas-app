import { db, getSetting, setSetting } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { SignJWT, jwtVerify } from 'jose';

const SCOPES = 'offline_access User.Read Mail.Read';

function azureConfig() {
  const clientId = process.env.AZURE_CLIENT_ID || getSetting('azure_client_id') || '';
  const clientSecret = process.env.AZURE_CLIENT_SECRET || getSetting('azure_client_secret') || '';
  const tenant = process.env.AZURE_TENANT || 'common';
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return { clientId, clientSecret, tenant, redirectUri: `${appUrl}/correo/callback`, appUrl };
}

export function azureStatus() {
  const { clientId, clientSecret, redirectUri } = azureConfig();
  return {
    configured: Boolean(clientId && clientSecret),
    redirect_uri: redirectUri,
    client_id: clientId,
    has_secret: Boolean(clientSecret),
  };
}

function secretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET || process.env.APP_SECRET || 'dev-secret-finanzas');
}

export async function makeState() {
  const state = await new SignJWT({ k: 'oauth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey());
  db.prepare('INSERT OR REPLACE INTO oauth_states (state, created_at) VALUES (?, ?)').run(state, Date.now());
  return state;
}

async function verifyState(state) {
  try {
    await jwtVerify(state, secretKey());
    const row = db.prepare('SELECT state FROM oauth_states WHERE state = ?').get(state);
    if (!row) return false;
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return true;
  } catch {
    return false;
  }
}

function tokenUrl(tenant) {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

export function authorizeUrl(state) {
  const { clientId, tenant, redirectUri } = azureConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    // 'consent' fuerza la pantalla de consentimiento completa para garantizar
    // el grant de offline_access (refresh token) en reconexiones.
    prompt: 'consent',
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}`;
}

export async function exchangeCode(code, state) {
  if (!(await verifyState(state))) throw new Error('state inválido o expirado');
  const { clientId, clientSecret, tenant, redirectUri } = azureConfig();
  const res = await fetch(tokenUrl(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`OAuth exchange falló: ${await res.text()}`);
  const tok = await res.json();
  saveTokens(tok);
  return tok;
}

function saveTokens(tok) {
  const expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  const prev = db.prepare('SELECT account_email FROM email_tokens WHERE id = 1').get();
  db.prepare(
    `INSERT INTO email_tokens (id, account_email, access_token, refresh_token, expires_at, connected_at)
     VALUES (1, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
       connected_at = excluded.connected_at`
  ).run(prev?.account_email || '', encrypt(tok.access_token), encrypt(tok.refresh_token), expiresAt);
  if (tok.refresh_token) {
    // conservar email ya conocido si existe
    const row = db.prepare('SELECT account_email FROM email_tokens WHERE id = 1').get();
    if (row?.account_email) return;
  }
}

export async function refreshAccountEmail() {
  const token = await getValidAccessToken();
  if (!token) return '';
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return '';
  const me = await res.json();
  const email = me.mail || me.userPrincipalName || '';
  if (email) db.prepare('UPDATE email_tokens SET account_email = ? WHERE id = 1').run(email);
  return email;
}

export async function getValidAccessToken() {
  const row = db.prepare('SELECT * FROM email_tokens WHERE id = 1').get();
  if (!row || !row.refresh_token) return null;
  if (row.expires_at - Date.now() > 120_000) {
    const access = decrypt(row.access_token);
    return access || null;
  }
  const { clientId, clientSecret, tenant } = azureConfig();
  const res = await fetch(tokenUrl(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(row.refresh_token),
      grant_type: 'refresh_token',
      scope: SCOPES,
    }),
  });
  if (!res.ok) return null;
  const tok = await res.json();
  saveTokens(tok);
  return tok.access_token ?? null;
}

export function connectionStatus() {
  const row = db.prepare('SELECT account_email, connected_at, expires_at FROM email_tokens WHERE id = 1').get();
  const az = azureStatus();
  return {
    ...az,
    connected: Boolean(row?.refresh_token),
    account_email: row?.account_email || '',
    connected_at: row?.connected_at || null,
  };
}

export function disconnect() {
  db.prepare('DELETE FROM email_tokens WHERE id = 1').run();
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Lista correos desde una fecha (ISO). Devuelve { id, subject, preview, from, fromName, receivedAt, weblink }
export async function listMessages(sinceIso, max = 300) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('No hay conexión con Outlook');
  let url = `${GRAPH}/me/messages?$filter=receivedDateTime ge ${sinceIso}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,receivedDateTime,from,webLink&$top=50`;
  const out = [];
  for (let page = 0; page < 8 && url && out.length < max; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new Error('token_expirado');
    if (!res.ok) throw new Error(`Graph error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const msg of data.value || []) {
      out.push({
        id: msg.id,
        subject: msg.subject || '',
        preview: msg.bodyPreview || '',
        from: msg.from?.emailAddress?.address || '',
        fromName: msg.from?.emailAddress?.name || '',
        receivedAt: msg.receivedDateTime,
        weblink: msg.webLink || '',
      });
      if (out.length >= max) break;
    }
    url = data['@odata.nextLink'] || null;
  }
  return out;
}

export async function getMessageBody(messageId) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('No hay conexión con Outlook');
  const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=body`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return '';
  const data = await res.json();
  const content = data.body?.content || '';
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
