import { type ReactNode, type FormEvent, useEffect } from 'react';
import * as Icons from 'lucide-react';
import { clearToken, getToken } from './api';

export const CAT_COLORS: Record<string, string> = {
  gold: 'var(--c-gold)', mint: 'var(--c-mint)', coral: 'var(--c-coral)', sky: 'var(--c-sky)',
  violet: 'var(--c-violet)', sand: 'var(--c-sand)', teal: 'var(--c-teal)', plum: 'var(--c-plum)',
};

export function colorToken(name?: string | null): string {
  return CAT_COLORS[name || 'gold'] || CAT_COLORS.gold;
}

const ICON_MAP: Record<string, Icons.LucideIcon> = {
  cart: Icons.ShoppingCart, utensils: Icons.Utensils, car: Icons.Car, home: Icons.Home,
  plug: Icons.Plug, heart: Icons.Heart, book: Icons.BookOpen, clapperboard: Icons.Clapperboard,
  repeat: Icons.Repeat, plane: Icons.Plane, shirt: Icons.Shirt, cpu: Icons.Cpu, tag: Icons.Tag,
  banknote: Icons.Banknote, laptop: Icons.Laptop, 'trending-up': Icons.TrendingUp,
  undo: Icons.Undo2, plus: Icons.Plus, creditcard: Icons.CreditCard, cash: Icons.Wallet,
  wallet: Icons.Wallet, mail: Icons.Mail,
};

export function CategoryIcon({ icon, color, size = 18 }: { icon?: string | null; color?: string | null; size?: number }) {
  const I = ICON_MAP[icon || 'tag'] || Icons.Tag;
  const c = colorToken(color);
  return (
    <span className="tx-icon" style={{ background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c }}>
      <I size={size} />
    </span>
  );
}

export function kindIcon(kind?: string | null) {
  return kind === 'credit_card' ? Icons.CreditCard : kind === 'cash' ? Icons.Banknote : kind === 'wallet' ? Icons.Wallet : Icons.Landmark;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 560 } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className || ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label || 'interruptor'}
      onClick={() => onChange(!on)} />
  );
}

export function Empty({ icon: I, text, children }: { icon: Icons.LucideIcon; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <I size={36} strokeWidth={1.4} />
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Toast({ msg }: { msg: { text: string; error?: boolean } | null }) {
  if (!msg) return null;
  return <div className={`toast ${msg.error ? 'error' : ''}`} role="status">{msg.text}</div>;
}

export function useLogout() {
  return () => { clearToken(); window.location.href = '/login'; };
}

export function isAuthed() {
  return Boolean(getToken());
}

export function Form({ onSubmit, children, className }: { onSubmit: () => void; children: ReactNode; className?: string }) {
  return (
    <form className={className} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>{children}</form>
  );
}
