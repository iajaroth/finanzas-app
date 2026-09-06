import { useEffect, useState } from 'react';
import { Award, ChartPie, Store } from 'lucide-react';
import { api } from '../api';
import type { Stats as StatsType } from '../types';
import { formatMoney, monthLabel, currentMonth, monthShift } from '../format';
import { Empty, colorToken, kindIcon } from '../ui';
import { Donut, TrendArea } from '../charts';
import { useToast } from '../App';

const KIND_SHORT: Record<string, string> = { bank: 'Banco', cash: 'Efectivo', credit_card: 'Tarjeta', wallet: 'Billetera' };

export default function Stats() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<StatsType | null>(null);
  const [currency, setCurrency] = useState('COP');

  useEffect(() => {
    api.get<{ currency: string }>('/settings').then((s) => setCurrency(s.currency)).catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    api.get<StatsType>(`/stats?month=${month}`).then(setData).catch((e) => toast(e.message, true));
  }, [month, toast]);

  const catTotal = data?.by_category.reduce((a, c) => a + c.total, 0) ?? 0;
  const accTotal = data?.by_account.reduce((a, c) => a + c.total, 0) ?? 0;
  const trend = data?.by_month.map((m) => ({ month: m.month, net: m.income - m.expense })) ?? [];

  return (
    <>
      <div className="card fade-in">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--muted)' }}>Mes:</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn-icon" onClick={() => setMonth(monthShift(month, -1))} aria-label="mes anterior">‹</button>
            <span className="amount" style={{ minWidth: 96, textAlign: 'center' }}>{monthLabel(month, true)}</span>
            <button className="btn-icon" onClick={() => setMonth(monthShift(month, 1))} aria-label="mes siguiente">›</button>
          </div>
        </div>
      </div>

      <div className="grid grid-two">
        <section className="card fade-in">
          <div className="card-title"><h3>¿En qué se gasta?</h3><span className="hint">{catTotal ? formatMoney(catTotal, currency) : ''}</span></div>
          {data && data.by_category.length > 0 ? (
            <>
              <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}>
                <Donut size={210} data={data.by_category.slice(0, 8).map((c) => ({ label: c.name, value: c.total, color: colorToken(c.color) }))}>
                  <text x="105" y="97" textAnchor="middle" fontSize="9" fill="var(--faint)" fontFamily="var(--font-mono)">TOTAL</text>
                  <text x="105" y="117" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-mono)">
                    {formatMoney(catTotal, currency)}
                  </text>
                </Donut>
              </div>
              <div className="legend">
                {data.by_category.map((c) => (
                  <div className="legend-row" key={c.category_id}>
                    <span className="dot" style={{ background: colorToken(c.color) }} />
                    <span className="legend-name">{c.name}</span>
                    <span className="legend-pct">{Math.round((c.total / catTotal) * 100)}%</span>
                    <span className="legend-val">{formatMoney(c.total, currency)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty icon={ChartPie} text="Sin gastos este mes." />}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="card fade-in">
            <div className="card-title"><h3>¿Cómo se gasta?</h3><span className="hint">por cuenta / método</span></div>
            {data && data.by_account.length > 0 ? (
              <div className="legend">
                {data.by_account.map((a) => {
                  const Icon = kindIcon(a.kind);
                  return (
                    <div className="legend-row" key={a.account_id} style={{ gap: 12 }}>
                      <Icon size={16} style={{ color: colorToken(a.color) }} />
                      <span className="legend-name">{a.name} <span style={{ color: 'var(--faint)' }}>· {KIND_SHORT[a.kind] || a.kind}</span></span>
                      <span className="legend-pct">{accTotal ? Math.round((a.total / accTotal) * 100) : 0}%</span>
                      <span className="legend-val">{formatMoney(a.total, currency)}</span>
                    </div>
                  );
                })}
              </div>
            ) : <Empty icon={ChartPie} text="Sin gastos con cuenta asignada este mes." />}
          </section>

          <section className="card fade-in">
            <div className="card-title"><h3>Top comercios</h3><span className="hint">dónde más gastas</span></div>
            {data && data.top_merchants.length > 0 ? (
              <div className="legend">
                {data.top_merchants.map((m, i) => (
                  <div className="legend-row" key={i} style={{ gap: 12 }}>
                    <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', width: 18 }}>{i + 1}</span>
                    <span className="legend-name"><Store size={11} style={{ verticalAlign: '-1px', marginRight: 6, color: 'var(--faint)' }} />{m.merchant}</span>
                    <span className="chip chip-muted">{m.n} mov.</span>
                    <span className="legend-val">{formatMoney(m.total, currency)}</span>
                  </div>
                ))}
              </div>
            ) : <Empty icon={Award} text="Sin comercios este mes." />}
          </section>
        </div>
      </div>

      <section className="card fade-in">
        <div className="card-title"><h3>Tendencia neta</h3><span className="hint">ingresos − gastos · 12 meses</span></div>
        {trend.length > 0 ? <TrendArea data={trend} format={(c) => formatMoney(c, currency)} /> : <Empty icon={ChartPie} text="Sin datos suficientes." />}
      </section>
    </>
  );
}
