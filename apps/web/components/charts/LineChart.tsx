'use client';
// Port of demo/index.html lineChart (:263) + hover crosshair (:292).
import { useRef, useState } from 'react';

type Series = { name: string; data: (number | null)[]; color: string; dash?: boolean };
const FMT = {
  pct: (v: number) => v.toFixed(0) + '%',
  kg: (v: number) => Math.round(v / 100) / 10 + 'kg',
  inr0: (v: number) => '₹' + Math.round(v),
  inr1: (v: number) => '₹' + v.toFixed(1),
  inr2: (v: number) => '₹' + v.toFixed(2),
};

export function LineChart({ series, fmt, xlabels = [], ylim, vals = [], w = 340, h = 150 }: {
  series: Series[]; fmt: keyof typeof FMT; xlabels?: [number, string][]; ylim?: [number, number]; vals?: string[]; w?: number; h?: number;
}) {
  const pad = { l: 34, r: 24, t: 10, b: 22 };
  const ref = useRef<SVGSVGElement>(null);
  const [hi_, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.data.filter((v): v is number => v != null));
  let lo = ylim ? ylim[0] : Math.min(...all), hi = ylim ? ylim[1] : Math.max(...all);
  if (!all.length) { lo = 0; hi = 1; }
  if (hi === lo) hi = lo + 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const X = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, n - 1);
  const Y = (v: number) => pad.t + ((hi - v) * (h - pad.t - pad.b)) / (hi - lo);
  const yfmt = FMT[fmt];
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

  const move = (clientX: number) => {
    const svg = ref.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    const x = pt.matrixTransform(ctm.inverse()).x;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((x - pad.l) / plotW) * (n - 1)))));
  };

  return (
    <svg ref={ref} className="chart" style={{ aspectRatio: `${w} / ${h}` }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
          <text x={pad.l - 5} y={Y(v) + 3} textAnchor="end">{yfmt(v)}</text>
        </g>
      ))}
      {xlabels.map(([i, l]) => (
        <text key={i} x={X(i)} y={h - 6} textAnchor="middle">{l}</text>
      ))}
      {series.map((s) => {
        const pts = s.data.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter((p): p is number[] => !!p);
        const last = pts.at(-1);
        return (
          <g key={s.name}>
            <path d={pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('')} fill="none" stroke={s.color}
              strokeWidth={2} strokeDasharray={s.dash ? '4 4' : undefined} strokeLinejoin="round" />
            {!s.dash && last && <circle cx={last[0]} cy={last[1]} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
          </g>
        );
      })}
      {hi_ != null && (() => {
        const x = pad.l + (hi_ * plotW) / Math.max(1, n - 1), bx = Math.min(x + 6, 240);
        return (
          <g pointerEvents="none">
            <line x1={x} x2={x} y1={pad.t} y2={pad.t + plotH} stroke="var(--muted)" strokeDasharray="2 3" />
            <rect x={bx} y={pad.t} width={94} height={18} rx={4} fill="var(--ink)" />
            <text x={bx + 6} y={pad.t + 12.5} style={{ fill: 'var(--bg)' }}>{vals[hi_] ?? ''}</text>
          </g>
        );
      })()}
      <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="transparent"
        onMouseMove={(e) => move(e.clientX)} onTouchMove={(e) => move(e.touches[0].clientX)} onMouseLeave={() => setHover(null)} />
    </svg>
  );
}
