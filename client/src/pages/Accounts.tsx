import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X, CreditCard } from 'lucide-react';
import { api } from '../api';
import type { Account } from '../types';
import { formatMoney, parseMoneyInput } from '../format';
import { Empty, Field, Modal, colorToken, kindIcon } from '../ui';
import { useToast } from '../App';

const KIND_LABEL: Record<string, string> = {
  bank: 'Cuenta bancaria', cash: 'Efectivo', credit_card: 'Tarjeta de crédito', wallet: 'Billetera digital',
};
const COLORS = ['gold', 'mint', 'coral', 'sky', 'violet', 'sand', 'teal', 'plum'];

interface AccDraft {
  id?: number;
  name: string; kind: Account['kind']; bank: string; last4: string;
  openingText: string; limitText: string; color: string; archived?: boolean;
}

function draftFrom(a?: Account | null): AccDraft {
  return {
    id: a?.id,
    name: a?.name || '',
    kind: a?.kind || 'bank',
    bank: a?.bank || '',
    last4: a?.last4 || '',
    openingText: a && a.kind !== 'credit_card' ? String(a.opening_balance / 100) : '0',
    limitText: a ? String(a.credit_limit / 100) : '0',
    color: a?.color || 'gold',
    archived: a ? Boolean(a.archived) : false,
  };
}

function AccountModal({ draft, setDraft, onClose, onSave }: {
  draft: AccDraft; setDraft: (d: AccDraft) => void; onClose: () => void; onSave: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<AccDraft>) => setDraft({ ...draft, ...patch });
  const opening = parseMoneyInput(draft.openingText) ?? 0;
  const limit = parseMoneyInput(draft.limitText) ?? 0;
  const valid = draft.name.trim().length > 0 && (draft.kind !== 'credit_card' || limit > 0 || draft.id);

  async function save() {
    const body = {
      name: draft.name.trim(), kind: draft.kind, bank: draft.bank.trim(), last4: draft.last4.trim(),
      opening_balance: draft.kind === 'credit_card' ? 0 : opening, credit_limit: draft.kind === 'credit_card' ? limit : 0,
      color: draft.color,
    };
    try {
      if (draft.id) await api.put(`/accounts/${draft.id}`, body);
      else await api.post('/accounts', body);
      onSave();
    } catch (e) { alert((e as Error).message); }
  }
  async function remove() {
    if (!draft.id) return;
    try { await api.del(`/accounts/${draft.id}`); onSave(); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <Modal title={draft.id ? 'Editar cuenta' : 'Nueva cuenta o tarjeta'} onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Nombre" className="span2">
          <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })}
            placeholder="Ej: Bancolombia ahorros, Nu… " autoFocus />
        </Field>
        <Field label="Tipo">
          <select className="select" value={draft.kind} onChange={(e) => set({ kind: e.target.value as Account['kind'] })}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Banco / entidad">
          <input className="input" value={draft.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="Ej: Bancolombia" />
        </Field>
        <Field label="Últimos 4 dígitos">
          <input className="input" value={draft.last4} onChange={(e) => set({ last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            placeholder="1234" maxLength={4} inputMode="numeric" />
        </Field>
        <Field label="Color">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c}
                style={{
                  width: 26, height: 26, borderRadius: 8, background: colorToken(c),
                  outline: draft.color === c ? '2px solid var(--ink)' : 'none', outlineOffset: 2, border: 'none',
                }} />
            ))}
          </div>
        </Field>
        {draft.kind === 'credit_card' ? (
          <Field label="Cupo total">
            <input className="input amount" inputMode="decimal" value={draft.limitText}
              onChange={(e) => set({ limitText: e.target.value })} placeholder="0" />
          </Field>
        ) : (
          <Field label="Saldo inicial">
            <input className="input amount" inputMode="decimal" value={draft.openingText}
              onChange={(e) => set({ openingText: e.target.value })} placeholder="0" />
          </Field>
        )}
      </div>
      <div className="modal-actions">
        {draft.id && (
          <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}>
            {confirmDelete ? <><Trash2 size={14} /> ¿Eliminar?</> : <Trash2 size={15} />}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}><X size={15} /> Cancelar</button>
        <button className="btn btn-primary" disabled={!valid} onClick={save}>{draft.id ? 'Guardar' : 'Crear'}</button>
      </div>
    </Modal>
  );
}

function CCard({ a, onClick }: { a: Account; onClick: () => void }) {
  const Icon = kindIcon(a.kind);
  const isCard = a.kind === 'credit_card';
  return (
    <button className="ccard" style={{ '--acc': colorToken(a.color) } as React.CSSProperties} onClick={onClick}>
      <div className="ccard-top">
        <div>
          <div className="ccard-bank">{a.bank || a.name}</div>
          <div className="ccard-kind">{KIND_LABEL[a.kind]}</div>
        </div>
        <Icon size={20} style={{ color: 'var(--acc)', opacity: 0.9 }} />
      </div>
      <div>
        <div className="ccard-number">{a.last4 ? `•••• •••• •••• ${a.last4}` : '••••'}</div>
        <div className="mt-3">
          <div className="ccard-label">{isCard ? 'Deuda' : 'Saldo disponible'}</div>
          <div className="ccard-balance">{formatMoney(a.balance, a.currency)}</div>
          {isCard && a.available !== null && (
            <div className="ccard-kind mt-2">Cupo libre: {formatMoney(Math.max(a.available, 0), a.currency)}</div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function Accounts() {
  const toast = useToast();
  const [items, setItems] = useState<Account[]>([]);
  const [archived, setArchived] = useState<Account[]>([]);
  const [draft, setDraft] = useState<AccDraft | null>(null);

  const load = useCallback(() => {
    api.get<{ items: Account[]; archived: Account[] }>('/accounts')
      .then((r) => { setItems(r.items); setArchived(r.archived); })
      .catch((e) => toast(e.message, true));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="row-between fade-in">
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
          El saldo de cada cuenta se calcula con tu saldo inicial más los movimientos registrados.
        </p>
        <button className="btn btn-primary" onClick={() => setDraft(draftFrom())}><Plus size={16} /> Nueva cuenta</button>
      </div>

      {items.length === 0 ? (
        <section className="card fade-in">
          <Empty icon={CreditCard} text="Aún no tienes cuentas. Agrega tus bancos, tarjetas, Nequi o efectivo para organizar tus gastos.">
            <button className="btn btn-primary mt-3" onClick={() => setDraft(draftFrom())}><Plus size={16} /> Agregar la primera</button>
          </Empty>
        </section>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
          {items.map((a) => <div className="fade-in" key={a.id}><CCard a={a} onClick={() => setDraft(draftFrom(a))} /></div>)}
        </div>
      )}

      {archived.length > 0 && (
        <section className="card fade-in">
          <div className="card-title"><h3>Archivadas</h3><span className="hint">No cuentan en el balance</span></div>
          <div className="tx-list">
            {archived.map((a) => (
              <div className="tx-row" key={a.id}>
                <div className="tx-main">
                  <div className="tx-merchant">{a.name}</div>
                  <div className="tx-desc">{KIND_LABEL[a.kind]}</div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={async () => {
                  await api.put(`/accounts/${a.id}`, { archived: false });
                  load();
                }}>Restaurar</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {draft && (
        <AccountModal draft={draft} setDraft={setDraft} onClose={() => setDraft(null)}
          onSave={() => { setDraft(null); load(); }} />
      )}
    </>
  );
}
