import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Send, X, Bot, Settings2 } from 'lucide-react';
import { api } from './api';
import { useToast } from './App';

// Recopilación semanal con IA (o resumen local si no hay API key)
export function InsightsCard() {
  const toast = useToast();
  const [data, setData] = useState<{ source: string; insights: string[]; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api.post('/ai/insights')); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="card fade-in">
      <div className="card-title">
        <h3 className="row" style={{ gap: 8 }}><Sparkles size={17} style={{ color: 'var(--accent-2)' }} /> Tu semana</h3>
        <button className="btn-icon" onClick={load} disabled={busy} aria-label="Actualizar recopilación">
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 72 }} />
      ) : (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.insights.map((ins, i) => (
            <li key={i} className="row" style={{ alignItems: 'flex-start', gap: 10, fontSize: 'var(--text-sm)' }}>
              <span className="dot" style={{ background: 'var(--accent)', marginTop: 7 }} />
              <span style={{ color: 'var(--ink)' }}>{ins}</span>
            </li>
          ))}
        </ul>
      )}
      {data?.note && <p className="tx-desc mt-3" style={{ margin: '10px 0 0' }}>{data.note}</p>}
    </section>
  );
}

interface Msg { role: 'user' | 'assistant'; content: string }

// Asistente IA flotante: pregúntale a tu dinero
export function AiChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, open]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const { answer } = await api.post<{ answer: string }>('/ai/chat', { question: q });
      setMsgs((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message }]);
    }
    setBusy(false);
  }

  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Asistente IA">
        <Sparkles size={20} />
      </button>
      {open && (
        <div className="modal-overlay" style={{ alignItems: 'flex-end', justifyContent: 'center' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="ai-panel" role="dialog" aria-label="Asistente IA">
            <div className="row-between mb-2">
              <h3 className="row" style={{ gap: 8 }}><Bot size={18} style={{ color: 'var(--accent)' }} /> Asistente de tus finanzas</h3>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="ai-msgs">
              {msgs.length === 0 && (
                <div className="ai-msg assistant">
                  Pregúntame lo que quieras sobre tu dinero: <em>"¿cuánto gasté en Uber este mes?"</em>, <em>"¿cómo van mis tarjetas?"</em>, <em>"¿en qué gasto más?"</em>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`ai-msg ${m.role}`}>{m.content}</div>
              ))}
              {busy && <div className="ai-msg assistant">Pensando…</div>}
              <div ref={endRef} />
            </div>
            <form className="row" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--line)' }}
              onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="Escribe tu pregunta…" autoFocus />
              <button className="btn btn-primary" style={{ padding: '10px 14px' }} disabled={busy || !input.trim()} aria-label="Enviar">
                <Send size={16} />
              </button>
            </form>
            {msgs.length === 0 && (
              <button className="tx-desc mt-2 row" style={{ gap: 6, justifyContent: 'center' }} onClick={() => { setOpen(false); window.location.href = '/ajustes'; }}>
                <Settings2 size={13} /> Requiere tu API key de OpenRouter (Ajustes)
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
