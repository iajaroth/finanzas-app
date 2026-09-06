import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { Account, Category, Tx, TxType } from '../types';
import { formatMoney, parseMoneyInput, dayLabel, todayISO, currentMonth, monthShift, monthLabel } from '../format';
import { CategoryIcon, colorToken, Empty, Field, Modal, kindIcon } from '../ui';
import { useToast } from '../App';

interface TxDraft {
  id?: number;
  type: TxType;
  amountText: string;
  currency: string;
  occurred_at: string;
  account_id: string;
  transfer_to_id: string;
  category_id: string;
  merchant: string;
  description: string;
  notes: string;
}

function draftFrom(tx?: Tx | null, base = 'CRC'): TxDraft {
  return {
    id: tx?.id,
    type: tx?.type || 'expense',
    amountText: tx ? String(tx.amount / 100) : '',
    currency: tx?.currency || base,
    occurred_at: tx?.occurred_at || todayISO(),
    account_id: tx?.account_id ? String(tx.account_id) : '',
    transfer_to_id: tx?.transfer_to_id ? String(tx.transfer_to_id) : '',
    category_id: tx?.category_id ? String(tx.category_id) : '',
    merchant: tx?.merchant || '',
    description: tx?.description || '',
    notes: tx?.notes || '',
  };
}

function TxModal({ draft, setDraft, onClose, onSave, accounts, categories, currency }: {
  draft: TxDraft; setDraft: (d: TxDraft) => void; onClose: () => void; onSave: () => void;
  accounts: Account[]; categories: Category[]; currency: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fx, setFx] = useState<{ rate: number; source: string } | null>(null);
  const set = (patch: Partial<TxDraft>) => setDraft({ ...draft, ...patch });
  const cats = categories.filter((c) => (draft.type === 'income' ? c.kind === 'income' : c.kind === 'expense'));
  const cents = parseMoneyInput(draft.amountText);
  const valid = cents !== null && (draft.type !== 'transfer' || draft.transfer_to_id);

  // al usar una moneda distinta a la base, consulta la tasa del día elegido
  useEffect(() => {
    if (draft.currency !== currency || !cents) { setFx(null); return; }
    let alive = true;
    api.get<{ rate: number; source: string }>(`/fx/usd?date=${draft.occurred_at}`)
      .then((r) => { if (alive) setFx(r); })
      .catch(() => { if (alive) setFx(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.currency, draft.occurred_at, cents]);

  async function save() {
    if (!valid) return;
    const body = {
      type: draft.type,
      amount: cents,
      currency: draft.currency,
      occurred_at: draft.occurred_at,
      account_id: draft.account_id ? Number(draft.account_id) : null,
      transfer_to_id: draft.type === 'transfer' && draft.transfer_to_id ? Number(draft.transfer_to_id) : null,
      category_id: draft.type !== 'transfer' && draft.category_id ? Number(draft.category_id) : null,
      merchant: draft.merchant.trim(),
      description: draft.description.trim(),
      notes: draft.notes.trim(),
    };
    try {
      if (draft.id) await api.put(`/transactions/${draft.id}`, body);
      else await api.post('/transactions', body);
      onSave();
    } catch (e) { alert((e as Error).message); }
  }

  async function remove() {
    if (!draft.id) return;
    try { await api.del(`/transactions/${draft.id}`); onSave(); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <Modal title={draft.id ? 'Editar movimiento' : 'Nuevo movimiento'} onClose={onClose} wide>
      <div className="seg mb-4" role="tablist">
        {([['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']] as const).map(([v, label]) => (
          <button key={v} type="button" className={draft.type === v ? 'active' : ''} onClick={() => set({ type: v })}>{label}</button>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Monto">
          <input className="input amount" inputMode="decimal" placeholder="0,00" value={draft.amountText}
            onChange={(e) => set({ amountText: e.target.value })} autoFocus />
        </Field>
        <Field label="Moneda">
          <select className="select" value={draft.currency} onChange={(e) => set({ currency: e.target.value })}>
            <option value={currency}>{currency} (base)</option>
            {currency !== 'USD' && <option value="USD">USD</option>}
          </select>
        </Field>
        {draft.currency !== currency && (
          <div className="span2 notice" style={{ padding: 10 }}>
            {fx?.rate && cents
              ? <span>Tasa {fx.source}: ₡{fx.rate.toLocaleString('es-CR')} por US$1 · Equivalente: <strong>{formatMoney(cents * fx.rate, currency)}</strong></span>
              : <span>Consultando tipo de cambio del BCCR…</span>}
          </div>
        )}
        <Field label="Fecha">
          <input className="input" type="date" value={draft.occurred_at} onChange={(e) => set({ occurred_at: e.target.value })} />
        </Field>
        {draft.type === 'transfer' ? (
          <>
            <Field label="Cuenta origen">
              <select className="select" value={draft.account_id} onChange={(e) => set({ account_id: e.target.value })}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Cuenta destino">
              <select className="select" value={draft.transfer_to_id} onChange={(e) => set({ transfer_to_id: e.target.value })}>
                <option value="">Elige destino</option>
                {accounts.filter((a) => String(a.id) !== draft.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Cuenta / tarjeta">
              <select className="select" value={draft.account_id} onChange={(e) => set({ account_id: e.target.value })}>
                <option value="">Sin cuenta</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Categoría">
              <select className="select" value={draft.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                <option value="">Sin categoría</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </>
        )}
        {draft.type !== 'transfer' && (
          <Field label={draft.type === 'expense' ? 'Comercio / detalle' : 'Detalle'} className="span2">
            <input className="input" value={draft.merchant} onChange={(e) => set({ merchant: e.target.value })}
              placeholder={draft.type === 'expense' ? 'Ej: Tiendas D1, Uber, Netflix…' : 'Ej: Nómina, freelance…'} />
          </Field>
        )}
        <Field label="Notas" className="span2">
          <input className="input" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Opcional" />
        </Field>
      </div>
      <div className="modal-actions">
        {draft.id && (
          <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}>
            {confirmDelete ? <><Trash2 size={14} /> ¿Eliminar?</> : <Trash2 size={15} />}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}><X size={15} /> Cancelar</button>
        <button className="btn btn-primary" disabled={!valid} onClick={save}>
          {draft.id ? 'Guardar' : `Agregar${cents ? ` · ${formatMoney(cents, currency)}` : ''}`}
        </button>
      </div>
    </Modal>
  );
}

// monto efectivo en moneda base + subtítulo con la moneda original
function txCrc(t: Tx, base: string): number {
  if (t.currency && t.currency !== base) return Math.round(t.amount * (t.fx_rate || 0));
  return t.amount;
}

export default function Movements() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<'all' | TxType>('all');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Tx[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState('COP');
  const [draft, setDraft] = useState<TxDraft | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ month, limit: '300' });
      if (type !== 'all') p.set('type', type);
      if (accountId) p.set('account_id', accountId);
      if (categoryId) p.set('category_id', categoryId);
      if (q) p.set('q', q);
      const res = await api.get<{ items: Tx[]; total: number }>(`/transactions?${p}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) { toast((e as Error).message, true); }
    setLoading(false);
  }, [month, type, accountId, categoryId, q, toast]);

  useEffect(() => {
    api.get<{ items: Account[] }>('/accounts').then((r) => setAccounts(r.items)).catch(() => {});
    api.get<{ items: Category[] }>('/categories').then((r) => setCategories(r.items)).catch(() => {});
    api.get<{ currency: string }>('/settings').then((s) => setCurrency(s.currency)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Tx[]>();
    for (const t of items) {
      const key = t.occurred_at;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()];
  }, [items]);

  const reload = () => { setDraft(null); load(); };

  return (
    <>
      <div className="card fade-in">
        <div className="filters">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn-icon" onClick={() => setMonth(monthShift(month, -1))} aria-label="mes anterior">‹</button>
            <span className="amount" style={{ minWidth: 92, textAlign: 'center' }}>{monthLabel(month)}</span>
            <button className="btn-icon" onClick={() => setMonth(monthShift(month, 1))} aria-label="mes siguiente">›</button>
          </div>
          <div className="seg">
            {([['all', 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['transfer', 'Transf.']] as const).map(([v, l]) => (
              <button key={v} className={type === v ? 'active' : ''} onClick={() => setType(v)}>{l}</button>
            ))}
          </div>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="field" style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--faint)' }} />
            <input className="input" style={{ paddingLeft: 32, width: 180 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="grow" />
          <button className="btn btn-primary hide-mobile" onClick={() => setDraft(draftFrom(undefined, currency))}><Plus size={16} /> Nuevo</button>
        </div>
      </div>

      <button className="fab-add" onClick={() => setDraft(draftFrom(undefined, currency))} aria-label="Nuevo movimiento">
        <Plus size={18} /> Nuevo
      </button>

      <section className="card fade-in">
        {loading ? (
          <div className="tx-list">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 48, marginBottom: 8 }} />)}</div>
        ) : grouped.length === 0 ? (
          <Empty icon={Search} text="No hay movimientos con estos filtros. Prueba otro mes o agrega uno nuevo." />
        ) : (
          <div className="tx-list">
            {grouped.map(([day, txs]) => (
              <div key={day}>
                <div className="tx-day">
                  {dayLabel(day)}
                  <span style={{ float: 'right' }}>
                    {(() => {
                      const net = txs.reduce((a, t) => a + (t.type === 'income' ? txCrc(t, currency) : t.type === 'expense' ? -txCrc(t, currency) : 0), 0);
                      return <span className={net >= 0 ? 'amount-pos' : 'amount-neg'}>{formatMoney(net, currency, { sign: true })}</span>;
                    })()}
                  </span>
                </div>
                {txs.map((t) => {
                  const isForeign = Boolean(t.currency && t.currency !== currency);
                  return (
                  <button className="tx-row" key={t.id} onClick={() => setDraft(draftFrom(t, currency))}>
                    <CategoryIcon icon={t.category_icon} color={t.category_color} />
                    <div className="tx-main">
                      <div className="tx-merchant">
                        {t.merchant || t.description || (t.type === 'transfer' ? `${t.account_name || 'Cuenta'} → ${t.transfer_to_name}` : t.category_name || 'Movimiento')}
                        {t.source === 'email' && <span className="chip chip-gold" style={{ marginLeft: 8, padding: '1px 8px' }}>correo</span>}
                      </div>
                      <div className="tx-desc">
                        {t.type === 'transfer' ? 'Transferencia' : t.category_name || 'Sin categoría'}
                        {t.account_name ? ` · ${t.account_name}` : ''}
                        {isForeign ? ` · original ${formatMoney(t.amount, t.currency)}` : ''}
                      </div>
                    </div>
                    <span className={`tx-amount ${t.type === 'income' ? 'amount-pos' : t.type === 'expense' ? 'amount-neg' : 'amount-muted'}`}>
                      {t.type === 'transfer' ? '⇄ ' : ''}{formatMoney(txCrc(t, currency) * (t.type === 'expense' ? -1 : 1), currency)}
                    </span>
                  </button>
                  );
                })}
              </div>
            ))}
            {total > items.length && <p style={{ color: 'var(--faint)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>Mostrando {items.length} de {total}</p>}
          </div>
        )}
      </section>

      {draft && (
        <TxModal draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} onSave={reload}
          accounts={accounts} categories={categories} currency={currency} />
      )}
    </>
  );
}
