// Gráficos SVG hechos a mano: dona, barras comparativas y línea de tendencia

export function Donut({ data, size = 190, thickness = 22, children }: {
  data: { label: string; value: number; color: string }[];
  size?: number; thickness?: number; children?: React.ReactNode;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="sin datos">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(100% 0 0 / 0.06)" strokeWidth={thickness} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="distribución">
      {data.map((d, i) => {
        const frac = d.value / total;
        const dash = frac * C;
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color}
            strokeWidth={thickness} strokeDasharray={`${Math.max(dash - 2, 0.5)} ${C - dash + 2}`}
            strokeDashoffset={-offset} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        );
        offset += dash;
        return el;
      })}
      {children}
    </svg>
  );
}

export function IncomeExpenseBars({ data, format }: {
  data: { month: string; income: number; expense: number }[];
  format: (cents: number) => string;
}) {
  const max = Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1);
  const W = 520, H = 190, pad = 6;
  const groupW = (W - pad * 2) / data.length;
  const barW = Math.min(14, groupW / 3);
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="ingresos y gastos por mes">
      {data.map((d, i) => {
        const x = pad + i * groupW + groupW / 2;
        const hIn = (d.income / max) * (H - 18);
        const hEx = (d.expense / max) * (H - 18);
        return (
          <g key={d.month}>
            <rect x={x - barW - 2} y={H - hIn} width={barW} height={Math.max(hIn, 2)} rx={4} fill="var(--income)" opacity={0.9}>
              <title>{`Ingresos ${d.month}: ${format(d.income)}`}</title>
            </rect>
            <rect x={x + 2} y={H - hEx} width={barW} height={Math.max(hEx, 2)} rx={4} fill="var(--expense)" opacity={0.85}>
              <title>{`Gastos ${d.month}: ${format(d.expense)}`}</title>
            </rect>
            <text x={x} y={H + 16} textAnchor="middle" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
              {d.month.slice(5)}/{d.month.slice(2, 4)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TrendArea({ data, format }: {
  data: { month: string; net: number }[];
  format: (cents: number) => string;
}) {
  const W = 560, H = 170, padX = 8, padY = 14;
  const values = data.map((d) => d.net);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const zeroY = H - padY - ((0 - min) / span) * (H - padY * 2);
  const step = (W - padX * 2) / Math.max(data.length - 1, 1);
  const pts = data.map((d, i) => [padX + i * step, H - padY - ((d.net - min) / span) * (H - padY * 2)] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]?.[0] ?? padX},${zeroY} L${pts[0]?.[0] ?? padX},${zeroY} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="tendencia neta mensual">
      <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="oklch(100% 0 0 / 0.12)" strokeDasharray="3 4" />
      <path d={area} fill="var(--accent)" opacity={0.09} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={data[i].month}>
          <circle cx={p[0]} cy={p[1]} r="3.2" fill="var(--accent)" />
          <title>{`${data[i].month}: ${format(data[i].net)}`}</title>
        </g>
      ))}
      {pts.map((p, i) => (
        i % 2 === 0 ? (
          <text key={`t${i}`} x={p[0]} y={H + 12} textAnchor="middle" fontSize="10" fill="var(--faint)" fontFamily="var(--font-mono)">
            {data[i].month.slice(5)}/{data[i].month.slice(2, 4)}
          </text>
        ) : null
      ))}
    </svg>
  );
}
