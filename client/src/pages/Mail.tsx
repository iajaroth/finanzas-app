import { useCallback, useEffect, useState } from 'react';
import { Check, Mail as MailIcon, RefreshCw, ShieldCheck, X, ExternalLink, CheckCheck } from 'lucide-react';
import { api } from '../api';
import type { Account, Category, EmailImport, EmailStatus } from '../types';
import { formatMoney, parseMoneyInput, dayLabel } from '../format';
import { Empty, Field, Switch } from '../ui';
import { useToast } from '../App';

function ImportCard({ imp, accounts, categories, onChanged, onEdit }: {
  imp: EmailImport; accounts: Account[]; categories: Category[];
  onChanged: () => void; onEdit: (imp: EmailImport) => void;
}) {
  const cents = imp.amount ?? 0;
  const conf = Math.round(imp.confidence * 100);
  const confColor = conf >= 70 ? 'chip-mint' : conf >= 45 ? 'chip-gold' : 'chip-coral';
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {imp.bank && <span className="chip chip-gold">{imp.bank}</span>}
            <span className={`chip ${confColor}`}>{conf}% confianza</span>
            <span className="chip chip-muted">{imp.type === 'income' ? 'Ingreso' : 'Gasto'}</span>
            {imp.currency && imp.currency !== 'CRC' && <span className="chip chip-sky">{imp.currency}</span>}
          </div>
          <div className="tx-merchant mt-2">{imp.merchant || imp.subject || '(sin detalle)'}</div>
          <div className="tx-desc" style={{ whiteSpace: 'normal' }}>
            {dayLabel(imp.occurred_at || imp.received_at.slice(0, 10))} · {imp.from_email}
          </div>
          {imp.subject && imp.subject !== imp.merchant && (
            <div className="tx-desc" style={{ whiteSpace: 'normal' }}>{imp.subject}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`tx-amount ${imp.type === 'income' ? 'amount-pos' : 'amount-neg'}`} style={{ fontSize: 'var(--text-md)' }}>
            {formatMoney(cents * (imp.type === 'income' ? 1 : -1), imp.currency || 'CRC')}
          </div>
        </div>
      </div>
      <div className="row mt-3" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {imp.weblink && <a className="btn btn-sm btn-ghost" href={imp.weblink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ver correo</a>}
        <button className="btn btn-sm btn-ghost" onClick={() => onEdit(imp)}>Ajustar</button>
        <button className="btn btn-sm btn-danger" onClick={async () => {
          await api.patch(`/email/imports/${imp.id}`, { action: 'reject' });
          onChanged();
        }}><X size={14} /> Descartar</button>
        <button className="btn btn-sm btn-primary" onClick={async () => {
          await api.patch(`/email/imports/${imp.id}`, { action: 'approve' });
          onChanged();
        }}><Check size={14} /> Aprobar</button>
      </div>
    </div>
  );
}

function AdjustModal({ imp, accounts, categories, onClose, onSave }: {
  imp: EmailImport; accounts: Account[]; categories: Category[]; onClose: () => void; onSave: () => void;
}) {
  const [type, setType] = useState(imp.type || 'expense');
  const [amountText, setAmountText] = useState(imp.amount ? String(imp.amount / 100) : '');
  const [merchant, setMerchant] = useState(imp.merchant || '');
  const [categoryId, setCategoryId] = useState(String(imp.category_id || ''));
  const [accountId, setAccountId] = useState(String(imp.account_id || ''));
  const [occurred, setOccurred] = useState(imp.occurred_at || imp.received_at.slice(0, 10));

  async function saveAndApprove() {
    const cents = parseMoneyInput(amountText);
    if (!cents) return;
    await api.patch(`/email/imports/${imp.id}`, {
      action: 'approve',
      type, amount: cents, merchant: merchant.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      account_id: accountId ? Number(accountId) : null,
      occurred_at: occurred,
    });
    onSave();
  }
  async function saveOnly() {
    const cents = parseMoneyInput(amountText);
    if (!cents) return;
    await api.patch(`/email/imports/${imp.id}`, {
      action: 'edit',
      type, amount: cents, merchant: merchant.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      account_id: accountId ? Number(accountId) : null,
      occurred_at: occurred,
    });
    onSave();
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <h3>Ajustar transacción</h3>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', marginTop: -8 }}>
          {imp.bank} · {imp.from_email}
        </p>
        <div className="seg mb-4">
          <button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>Gasto</button>
          <button className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>Ingreso</button>
        </div>
        <div className="form-grid">
          <Field label="Monto">
            <input className="input amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus />
          </Field>
          <Field label="Fecha">
            <input className="input" type="date" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
          </Field>
          <Field label="Comercio / detalle" className="span2">
            <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </Field>
          <Field label="Cuenta">
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Sin cuenta</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.filter((c) => (type === 'income' ? c.kind === 'income' : c.kind === 'expense')).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-subtle" onClick={saveOnly}>Guardar y revisar luego</button>
          <button className="btn btn-primary" onClick={saveAndApprove}><Check size={15} /> Aprobar</button>
        </div>
      </div>
    </div>
  );
}

export default function Mail() {
  const toast = useToast();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [imports, setImports] = useState<EmailImport[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState<EmailImport | null>(null);
  const [azureClientId, setAzureClientId] = useState('');
  const [azureSecret, setAzureSecret] = useState('');
  const [senderFilters, setSenderFilters] = useState('');
  const [syncDays, setSyncDays] = useState(30);
  const [autoApprove, setAutoApprove] = useState(false);

  const loadStatus = useCallback(() => {
    api.get<EmailStatus>('/email/status').then((s) => {
      setStatus(s);
      setAzureClientId(s.client_id);
      setSenderFilters(s.sender_filters);
      setSyncDays(s.sync_days);
      setAutoApprove(s.auto_approve);
    }).catch((e) => toast(e.message, true));
  }, [toast]);
  const loadImports = useCallback(() => {
    api.get<{ items: EmailImport[] }>('/email/imports?status=pending').then((r) => setImports(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    loadStatus();
    loadImports();
    api.get<{ items: Account[] }>('/accounts').then((r) => setAccounts(r.items)).catch(() => {});
    api.get<{ items: Category[] }>('/categories').then((r) => setCategories(r.items)).catch(() => {});
  }, [loadStatus, loadImports]);

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>('/email/authorize');
      window.location.href = url;
    } catch (e) { toast((e as Error).message, true); setBusy(false); }
  }

  async function sync() {
    setBusy(true);
    try {
      await api.post('/email/sync');
      // el sync corre en el servidor; consulta el progreso hasta que termine
      let final: EmailStatus | null = null;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        final = await api.get<EmailStatus>('/email/status');
        setStatus(final);
        if (!final.syncing) break;
      }
      if (final?.last_sync_error) toast(`Error sincronizando: ${final.last_sync_error}`, true);
      else if (final?.last_sync_result) toast(`Sincronización completada: ${final.last_sync_result.created + final.last_sync_result.pending} transacciones detectadas`);
      else toast('Sincronización completada');
      loadStatus();
      loadImports();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  async function saveAzure() {
    try {
      await api.put('/settings', { azure_client_id: azureClientId, azure_client_secret: azureSecret });
      toast('Configuración de Azure guardada');
      loadStatus();
    } catch (e) { toast((e as Error).message, true); }
  }

  async function savePrefs() {
    try {
      await api.post('/email/settings', { auto_approve: autoApprove, sync_days: syncDays, sender_filters: senderFilters });
      toast('Preferencias guardadas');
      loadStatus();
    } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <>
      <section className="card fade-in">
        <div className="row-between" style={{ flexWrap: 'wrap' }}>
          <div className="row">
            <span className="tx-icon" style={{ background: 'rgba(0, 225, 253, 0.13)', color: 'var(--accent)' }}><MailIcon size={20} /></span>
            <div>
              <div style={{ fontWeight: 600 }}>{status?.connected ? `Outlook conectado${status.account_email ? ` · ${status.account_email}` : ''}` : 'Conecta tu correo de Outlook'}</div>
              <div className="tx-desc">
                {status?.syncing
                  ? `Sincronizando correos… ${status.sync_processed ?? 0}/${status.sync_total ?? '?'}`
                  : status?.connected
                    ? `Última sincronización: ${status.last_sync_at ? new Date(status.last_sync_at).toLocaleString('es-CO') : 'nunca'}`
                    : 'Las notificaciones de tus bancos se convierten en transacciones.'}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {status?.connected && (
              <>
                <button className="btn btn-ghost" onClick={async () => { await api.post('/email/disconnect'); loadStatus(); }}>Desconectar</button>
                <button className="btn btn-primary" disabled={busy} onClick={sync}>
                  <RefreshCw size={15} /> {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
                </button>
              </>
            )}
            {!status?.connected && (
              <button className="btn btn-primary" disabled={busy || !status?.configured} onClick={connect}>
                <ShieldCheck size={15} /> Conectar con Microsoft
              </button>
            )}
          </div>
        </div>
        {status?.connected && status.pending > 0 && (
          <p className="mt-3" style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: '12px 0 0' }}>
            <strong style={{ color: 'var(--accent)' }}>{status.pending}</strong> transacciones esperando revisión ↓
          </p>
        )}
      </section>

      {!status?.configured && (
        <section className="card fade-in">
          <div className="card-title"><h3>Configuración de Azure (una sola vez)</h3></div>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
            Para leer tu correo, Microsoft requiere registrar la app en tu cuenta de Azure. Toma ~5 minutos:
          </p>
          <details className="azure" open={!status?.client_id}>
            <summary>Pasos para crear la app en Azure</summary>
            <ol>
              <li>Entra a <strong>portal.azure.com</strong> → busca <strong>Registros de aplicaciones</strong> → <strong>Nuevo registro</strong>.</li>
              <li>Nombre: <code>finanzas</code> · Tipos de cuenta: <strong> cuentas en cualquier directorio organizativo y Microsoft personal</strong>.</li>
              <li>En <strong>URI de redirección</strong> elige tipo <strong>Web</strong> y pega: <br /><code>{status?.redirect_uri || 'https://financiera.jbsautomation.online/correo/callback'}</code></li>
              <li>Crea la app → copia el <strong>Id. de aplicación (cliente)</strong> y pégalo abajo.</li>
              <li>En <strong>Certificados y secretos</strong> → <strong>Nuevo secreto de cliente</strong> → copia el valor y pégalo abajo.</li>
              <li>En <strong>Permisos de API</strong> agrega permisos de <strong>Microsoft Graph (delegados)</strong>: <code>Mail.Read</code>, <code>User.Read</code>, <code>offline_access</code>.</li>
            </ol>
          </details>
          <div className="form-grid mt-4">
            <Field label="Client ID (Azure)">
              <input className="input" value={azureClientId} onChange={(e) => setAzureClientId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-…" />
            </Field>
            <Field label="Client Secret">
              <input className="input" type="password" value={azureSecret} onChange={(e) => setAzureSecret(e.target.value)} placeholder={status?.has_secret ? '•••••• (guardado)' : 'Valor del secreto'} />
            </Field>
          </div>
          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn btn-primary" onClick={saveAzure}>Guardar configuración</button>
          </div>
        </section>
      )}

      {status?.configured && (
        <section className="card fade-in">
          <div className="card-title"><h3>Preferencias de sincronización</h3></div>
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <Field label="Revisar los últimos (días)">
              <input className="input" type="number" min={7} max={90} value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value) || 30)} />
            </Field>
            <Field label="Remitentes extra (dominios, separados por coma)">
              <input className="input" value={senderFilters} onChange={(e) => setSenderFilters(e.target.value)} placeholder="midominio.co, alerts@otrobanco.com" />
            </Field>
          </div>
          <div className="row-between mt-4">
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Aprobación automática</div>
              <div className="tx-desc">Los correos de alta confianza se convierten en transacciones sin revisión.</div>
            </div>
            <Switch on={autoApprove} onChange={setAutoApprove} label="Aprobación automática" />
          </div>
          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn btn-subtle" onClick={savePrefs}>Guardar preferencias</button>
          </div>
        </section>
      )}

      <section className="card fade-in">
        <div className="card-title">
          <h3>Por revisar</h3>
          {imports.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={async () => {
              const r = await api.post<{ approved: number }>('/email/imports/approve-all', { min_confidence: 0.7 });
              toast(`${r.approved} transacciones aprobadas`);
              loadImports();
              loadStatus();
            }}><CheckCheck size={14} /> Aprobar alta confianza</button>
          )}
        </div>
        {imports.length === 0 ? (
          <Empty icon={MailIcon} text="Nada pendiente. Sincroniza para revisar nuevas transacciones detectadas en tu correo." />
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {imports.map((imp) => (
              <ImportCard key={imp.id} imp={imp} accounts={accounts} categories={categories}
                onChanged={() => { loadImports(); loadStatus(); }}
                onEdit={(i) => setAdjusting(i)} />
            ))}
          </div>
        )}
      </section>

      {adjusting && (
        <AdjustModal imp={adjusting} accounts={accounts} categories={categories}
          onClose={() => setAdjusting(null)}
          onSave={() => { setAdjusting(null); loadImports(); loadStatus(); }} />
      )}
    </>
  );
}
