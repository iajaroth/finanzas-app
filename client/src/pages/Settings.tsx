import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, Trash2, X } from 'lucide-react';
import { api, clearToken } from '../api';
import type { Category, Settings as SettingsType } from '../types';
import { Field, Modal, colorToken } from '../ui';
import { useToast } from '../App';

const CURRENCIES = [
  ['COP', 'Peso colombiano'], ['USD', 'Dólar'], ['EUR', 'Euro'], ['MXN', 'Peso mexicano'],
  ['ARS', 'Peso argentino'], ['CLP', 'Peso chileno'], ['PEN', 'Sol peruano'], ['BRL', 'Real'],
];
const ICONS = ['cart', 'utensils', 'car', 'home', 'plug', 'heart', 'book', 'clapperboard', 'repeat', 'plane', 'shirt', 'cpu', 'tag', 'banknote', 'laptop', 'trending-up', 'undo', 'plus'];
const COLORS = ['gold', 'mint', 'coral', 'sky', 'violet', 'sand', 'teal', 'plum'];

function CategoryModal({ draft, setDraft, onClose, onSave }: {
  draft: Partial<Category>; setDraft: (c: Partial<Category>) => void; onClose: () => void; onSave: () => void;
}) {
  const set = (p: Partial<Category>) => setDraft({ ...draft, ...p });
  async function save() {
    if (!draft.name?.trim()) return;
    const body = { name: draft.name.trim(), kind: draft.kind || 'expense', icon: draft.icon || 'tag', color: draft.color || 'gold' };
    if (draft.id) await api.put(`/categories/${draft.id}`, body);
    else await api.post('/categories', body);
    onSave();
  }
  return (
    <Modal title={draft.id ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <Field label="Nombre">
          <input className="input" value={draft.name || ''} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="Tipo">
          <select className="select" value={draft.kind || 'expense'} onChange={(e) => set({ kind: e.target.value as Category['kind'] })}>
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
          </select>
        </Field>
        <Field label="Color">
          <div className="row" style={{ gap: 8 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c}
                style={{ width: 26, height: 26, borderRadius: 8, background: colorToken(c), outline: draft.color === c ? '2px solid var(--ink)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}><X size={15} /> Cancelar</button>
        <button className="btn btn-primary" onClick={save}>{draft.id ? 'Guardar' : 'Crear'}</button>
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgetText, setBudgetText] = useState('');
  const [catDraft, setCatDraft] = useState<Partial<Category> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(() => {
    api.get<SettingsType>('/settings').then((s) => {
      setSettings(s);
      setBudgetText(s.monthly_budget ? String(s.monthly_budget / 100) : '');
    }).catch((e) => toast(e.message, true));
    api.get<{ items: Category[] }>('/categories').then((r) => setCategories(r.items)).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function saveGeneral() {
    const budget = Math.round((parseFloat(budgetText.replace(/\./g, '').replace(',', '.')) || 0) * 100);
    await api.put('/settings', { currency: settings?.currency, monthly_budget: budget });
    toast('Ajustes guardados');
    load();
  }

  async function deleteCategory(id: number) {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    await api.del(`/categories/${id}`);
    setConfirmDelete(null);
    load();
  }

  return (
    <>
      <section className="card fade-in">
        <div className="card-title"><h3>General</h3></div>
        <div className="form-grid">
          <Field label="Moneda">
            <select className="select" value={settings?.currency || 'COP'} onChange={(e) => setSettings((s) => (s ? { ...s, currency: e.target.value } : s))}>
              {CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l} ({v})</option>)}
            </select>
          </Field>
          <Field label="Presupuesto mensual de gastos (opcional)">
            <input className="input amount" inputMode="decimal" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} placeholder="Ej: 2.500.000" />
          </Field>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-primary" onClick={saveGeneral}>Guardar</button>
          <a className="btn btn-ghost" href="/api/export" download><Download size={15} /> Exportar datos (JSON)</a>
        </div>
      </section>

      <section className="card fade-in">
        <div className="card-title">
          <h3>Categorías</h3>
          <button className="btn btn-sm btn-primary" onClick={() => setCatDraft({ kind: 'expense' })}><Plus size={14} /> Nueva</button>
        </div>
        <div className="tx-list">
          {categories.map((c) => (
            <div className="tx-row" key={c.id}>
              <span className="dot" style={{ background: colorToken(c.color), margin: '0 6px' }} />
              <div className="tx-main">
                <div className="tx-merchant">{c.name}</div>
                <div className="tx-desc">{c.kind === 'income' ? 'Ingreso' : 'Gasto'}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setCatDraft(c)}>Editar</button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteCategory(c.id)}>
                {confirmDelete === c.id ? '¿Seguro?' : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card fade-in">
        <div className="card-title"><h3>Cuenta</h3></div>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
          El acceso de esta app es de un solo usuario, configurado en el servidor (variables <code>AUTH_EMAIL</code> y <code>AUTH_PASSWORD</code> en Coolify).
          Para cambiar la contraseña, edita la variable y reinicia la app.
        </p>
        <button className="btn btn-ghost mt-4" onClick={() => { clearToken(); window.location.href = '/login'; }}>
          Cerrar sesión
        </button>
      </section>

      {catDraft && (
        <CategoryModal draft={catDraft} setDraft={setCatDraft} onClose={() => setCatDraft(null)}
          onSave={() => { setCatDraft(null); load(); }} />
      )}
    </>
  );
}
