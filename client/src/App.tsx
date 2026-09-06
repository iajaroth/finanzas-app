import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, createContext, useContext } from 'react';
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, ChartPie, Mail, Settings, LogOut,
} from 'lucide-react';
import { getToken, clearToken } from './api';
import { Toast } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Movements from './pages/Movements';
import Accounts from './pages/Accounts';
import Stats from './pages/Stats';
import MailPage from './pages/Mail';
import SettingsPage from './pages/Settings';

export const ToastContext = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const NAV = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard },
  { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
  { to: '/cuentas', label: 'Cuentas', icon: CreditCard },
  { to: '/estadisticas', label: 'Estadísticas', icon: ChartPie },
  { to: '/correo', label: 'Correo', icon: Mail },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
];
const MOBILE_NAV = NAV.filter((n) => n.to !== '/ajustes');

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const toast = (text: string, error?: boolean) => {
    setMsg({ text, error });
    window.setTimeout(() => setMsg(null), 3200);
  };
  useEffect(() => {
    if (!getToken()) navigate('/login', { replace: true });
  }, [location.pathname, navigate]);

  const logout = () => { clearToken(); navigate('/login', { replace: true }); };
  const title = NAV.find((n) => n.to === location.pathname)?.label || '';

  return (
    <ToastContext.Provider value={toast}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
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
          <nav className="snav" aria-label="principal">
            {NAV.map(({ to, label, icon: I }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `snav-item ${isActive ? 'active' : ''}`}>
                <I size={17} strokeWidth={1.8} /> {label}
              </NavLink>
            ))}
          </nav>
          <button className="snav-item" onClick={logout}><LogOut size={17} strokeWidth={1.8} /> Salir</button>
        </aside>

        <div className="main">
          <header className="topbar">
            <h1>{title}</h1>
            <div className="topbar-actions">
              <NavLink to="/ajustes" className="btn-icon" aria-label="Ajustes" title="Ajustes"><Settings size={18} /></NavLink>
              <button className="btn-icon" onClick={logout} aria-label="Cerrar sesión"><LogOut size={18} /></button>
            </div>
          </header>
          <div className="page">{children}</div>
        </div>

        <nav className="bottomnav" aria-label="navegación móvil">
          {MOBILE_NAV.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <I size={20} strokeWidth={1.8} /> {label.split(' ')[0]}
            </NavLink>
          ))}
        </nav>
        {msg && <Toast msg={msg} />}
      </div>
    </ToastContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/correo/callback" element={<OAuthCallback />} />
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/movimientos" element={<Layout><Movements /></Layout>} />
        <Route path="/cuentas" element={<Layout><Accounts /></Layout>} />
        <Route path="/estadisticas" element={<Layout><Stats /></Layout>} />
        <Route path="/correo" element={<Layout><MailPage /></Layout>} />
        <Route path="/ajustes" element={<Layout><SettingsPage /></Layout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// Página a la que redirige Microsoft tras el consentimiento: intercambia el código
function OAuthCallback() {
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [error, setError] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error_description') || params.get('error');
    if (err) { setStatus('error'); setError(err); return; }
    (async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('Inicia sesión en la app primero.');
        const res = await fetch('/api/email/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code, state }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error intercambiando el código');
        setStatus('ok');
        window.setTimeout(() => { window.location.href = '/correo'; }, 1200);
      } catch (e) {
        setStatus('error');
        setError((e as Error).message);
      }
    })();
  }, []);
  return (
    <div className="modal-overlay" style={{ alignItems: 'center' }}>
      <div className="modal" style={{ textAlign: 'center' }}>
        <h3>{status === 'working' ? 'Conectando Outlook…' : status === 'ok' ? '✓ Cuenta conectada' : 'No se pudo conectar'}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
          {status === 'error' ? error : status === 'ok' ? 'Redirigiendo…' : 'Procesando la autorización de Microsoft.'}
        </p>
        {status === 'error' && <a className="btn btn-ghost mt-4" href="/correo">Volver</a>}
      </div>
    </div>
  );
}
