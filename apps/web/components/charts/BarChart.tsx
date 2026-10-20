// Port of demo/index.html barChart (:273). `hl[i]` paints bar i red (mortality spike).
export function BarChart({ vals, hl = [], xlabels = [], color = 'var(--series2)', w = 340, h = 120 }: {
  vals: number[]; hl?: boolean[]; xlabels?: [number, string][]; color?: string; w?: number; h?: number;
}) {
  const pad = { l: 30, r: 10, t: 10, b: 20 };
  const hi = Math.max(1, ...vals), n = vals.length, bw = (w - pad.l - pad.r) / Math.max(1, n);
  const Y = (v: number) => pad.t + ((hi - v) * (h - pad.t - pad.b)) / hi;
  return (
    <svg className="chart" style={{ aspectRatio: `${w} / ${h}` }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily mortality">
      {[0, hi / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
          <text x={pad.l - 5} y={Y(v) + 3} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      {vals.map((v, i) => (
        <rect key={i} x={pad.l + i * bw + 1} y={Y(v)} width={Math.max(1, bw - 2)} height={Y(0) - Y(v)} rx={2} fill={hl[i] ? 'var(--crit)' : color}>
          <title>{`${v} birds`}</title>
        </rect>
      ))}
      {xlabels.map(([i, l]) => (
        <text key={i} x={pad.l + i * bw + bw / 2} y={h - 6} textAnchor="middle">{l}</text>
      ))}
    </svg>
  );
}

// Port of demo spark (:281).
export function Spark({ vals, color = 'var(--accent)' }: { vals: number[]; color?: string }) {
  const w = 72, h = 24, lo = Math.min(...vals), hi = Math.max(...vals) || 1;
  const X = (i: number) => (i * w) / (vals.length - 1 || 1), Y = (v: number) => h - 2 - ((v - lo) * (h - 4)) / (hi - lo || 1);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('')} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
