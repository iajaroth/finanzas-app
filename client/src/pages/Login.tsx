import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) { setError('Completa tus datos.'); return; }
    setBusy(true);
    setError('');
    try {
      const { token } = await api.post<{ token: string }>('/auth/login', { email, password });
      setToken(token);
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" style={{ alignItems: 'center' }}>
      <main className="modal fade-in" style={{ maxWidth: 400 }}>
        <div className="row mb-4" style={{ gap: 12 }}>
          <span className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden>
              <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="5" />
              <rect x="24" y="27" width="5" height="14" rx="2.5" fill="currentColor" />
              <rect x="31" y="20" width="5" height="21" rx="2.5" fill="currentColor" />
              <rect x="38" y="31" width="5" height="10" rx="2.5" fill="currentColor" opacity="0.75" />
            </svg>
          </span>
          <div>
            <div className="brand-name">Finanzas</div>
            <div className="brand-sub">night ledger</div>
          </div>
        </div>
        <h3 style={{ marginBottom: 4 }}>Bienvenido de nuevo</h3>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)', margin: '0 0 var(--s-6)' }}>
          Accede para ver tus gastos e ingresos.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label className="field">
            <span className="label">Correo</span>
            <input className="input" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@outlook.com" autoFocus />
          </label>
          <label className="field">
            <span className="label">Contraseña</span>
            <input className="input" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          {error && <p style={{ color: 'var(--expense)', fontSize: 'var(--text-sm)', margin: 0 }}>{error}</p>}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>
    </div>
  );
}
