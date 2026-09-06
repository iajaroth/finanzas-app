import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Mail, Trophy, Wallet } from 'lucide-react';
import { api } from '../api';
import type { Summary as SummaryType, Tx } from '../types';
import { formatMoney, monthLabel, currentMonth } from '../format';
import { CategoryIcon, colorToken, Empty } from '../ui';
import { Donut, IncomeExpenseBars } from '../charts';
import { InsightsCard, AiChat } from '../ai';
import { useToast } from '../App';

function TxRow({ tx, currency }: { tx: Tx; currency: string }) {
  const sign = tx.type === 'income' ? 1 : tx.type === 'expense' ? -1 : 0;
  const isForeign = Boolean(tx.currency && tx.currency !== currency);
  const crc = isForeign ? Math.round(tx.amount * (tx.fx_rate || 0)) : tx.amount;
  return (
    <div className="tx-row">
      <CategoryIcon icon={tx.category_icon} color={tx.category_color} />
      <div className="tx-main">
        <div className="tx-merchant">{tx.merchant || tx.description || (tx.type === 'transfer' ? `→ ${tx.transfer_to_name}` : tx.category_name)}</div>
        <div className="tx-desc">{tx.account_name || 'Sin cuenta'}{tx.category_name ? ` · ${tx.category_name}` : ''}{isForeign ? ` · original ${formatMoney(tx.amount, tx.currency)}` : ''}</div>
      </div>
      <span className={`tx-amount ${sign > 0 ? 'amount-pos' : sign < 0 ? 'amount-neg' : 'amount-muted'}`}>
        {sign === 0 ? '⇄ ' : ''}{formatMoney(crc * sign, currency)}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<SummaryType | null>(null);
  const [currency, setCurrency] = useState('COP');
  const toast = useToast();

  useEffect(() => {
    api.get<{ currency: string }>('/settings').then((s) => setCurrency(s.currency)).catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    api.get<SummaryType>(`/summary?month=${month}`).then(setData).catch((e) => toast(e.message, true));
  }, [month, toast]);

  const netPos = (data?.net ?? 0) >= 0;
  const budgetPct = data?.budget ? Math.min(100, Math.round((data.budget.spent / data.budget.amount) * 100)) : 0;

  return (
    <>
      <InsightsCard />
      <div className="grid grid-hero">
        <section className="card hoverable fade-in">
          <div className="kpi-label">Balance total</div>
          <div className="kpi-value hero">{data ? formatMoney(data.total_balance, currency) : '···'}</div>
          <div className="kpi-sub">{monthLabel(month, true)}</div>
          {data?.budget && (
            <div className="mt-4">
              <div className="row-between mb-2" style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                <span className="kpi-label">Presupuesto</span>
                <span className="amount">{formatMoney(data.budget.spent, currency)} / {formatMoney(data.budget.amount, currency)}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? 'var(--expense)' : 'var(--accent)' }} />
              </div>
            </div>
          )}
        </section>
        <section className="card hoverable fade-in">
          <div className="row"><span className="tx-icon" style={{ background: 'rgba(0, 255, 91, 0.13)', color: 'var(--income)' }}><ArrowUpRight size={18} /></span>
            <div className="kpi-label">Ingresos del mes</div></div>
          <div className="kpi-value amount-pos">{data ? formatMoney(data.income, currency) : '···'}</div>
          <div className="kpi-sub">{data ? `${data.recent.length ? '' : 'Sin movimientos aún'}` : ''}</div>
        </section>
        <section className="card hoverable fade-in">
          <div className="row"><span className="tx-icon" style={{ background: 'rgba(255, 37, 37, 0.12)', color: 'var(--expense)' }}><ArrowDownLeft size={18} /></span>
            <div className="kpi-label">Gastos del mes</div></div>
          <div className="kpi-value amount-neg">{data ? formatMoney(data.expense, currency) : '···'}</div>
          <div className="kpi-sub">Neto: <span className={netPos ? 'amount-pos' : 'amount-neg'}>{data ? formatMoney(data.net, currency, { sign: true }) : '···'}</span></div>
        </section>
      </div>

      {data && data.pending_imports > 0 && (
        <Link to="/correo" className="notice fade-in" style={{ display: 'flex' }}>
          <Mail size={18} />
          <span>Tienes <strong>{data.pending_imports}</strong> transacciones detectadas en tu correo esperando revisión →</span>
        </Link>
      )}

      <div className="grid grid-two">
        <section className="card fade-in">
          <div className="card-title"><h3>Gastos por categoría</h3><span className="hint">{monthLabel(month)}</span></div>
          {data && data.by_category.length > 0 ? (
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <Donut data={data.by_category.map((c) => ({ label: c.name, value: c.total, color: colorToken(c.color) }))}>
                <text x="95" y="88" textAnchor="middle" fontSize="9" fill="var(--faint)" fontFamily="var(--font-mono)">TOTAL</text>
                <text x="95" y="108" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-mono)">
                  {formatMoney(data.expense, currency)}
                </text>
              </Donut>
              <div className="legend grow">
                {data.by_category.slice(0, 6).map((c) => (
                  <div className="legend-row" key={c.category_id}>
                    <span className="dot" style={{ background: colorToken(c.color) }} />
                    <span className="legend-name">{c.name}</span>
                    <span className="legend-pct">{Math.round((c.total / data.expense) * 100)}%</span>
                    <span className="legend-val">{formatMoney(c.total, currency)}</span>
                  </div>
                ))}
                {data.by_category.length > 6 && (
                  <Link to="/estadisticas" className="legend-row" style={{ color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>
                    Ver todas en Estadísticas →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <Empty icon={Trophy} text="Aún no hay gastos registrados este mes." />
          )}
        </section>

        <section className="card fade-in">
          <div className="card-title"><h3>Ingresos vs gastos</h3><span className="hint">6 meses</span></div>
          {data && <IncomeExpenseBars data={data.trend} format={(c) => formatMoney(c, currency)} />}
        </section>
      </div>

      <section className="card fade-in">
        <div className="card-title"><h3>Últimos movimientos</h3><Link to="/movimientos" className="hint" style={{ color: 'var(--accent)' }}>Ver todos →</Link></div>
        {data && data.recent.length > 0 ? (
          <div className="tx-list">{data.recent.map((t) => <TxRow key={t.id} tx={t} currency={currency} />)}</div>
        ) : (
          <Empty icon={Wallet} text="Sin movimientos todavía. Agrega uno o conecta tu correo bancario." />
        )}
      </section>
      <AiChat />
    </>
  );
}
