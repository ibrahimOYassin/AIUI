import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, LineChart, Table2 } from 'lucide-react';
import type { ReportOverview } from '@aiui/shared';
import { dayLabel, statNumber } from '../../lib/format';

/* Charts are inline SVG drawn against the app's own tokens (see ".viz" in styles.css).
   One series is on screen at a time, so there is one series colour and no legend:
   the card title names what is plotted. */

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// ───────────────────────────── Stat tile ─────────────────────────────

export function StatTile({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="card stat-tile">
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value">{value}</strong>
      {note && <span className="stat-tile-note">{note}</span>}
    </div>
  );
}

// ───────────────────────────── Daily trend (line + soft area) ─────────────────────────────

export type Measure = 'activeUsers' | 'signups' | 'runs' | 'exports';

export const MEASURES: { id: Measure; label: string; unit: string }[] = [
  { id: 'activeUsers', label: 'Active users', unit: 'people active' },
  { id: 'signups', label: 'Sign-ups', unit: 'new accounts' },
  { id: 'runs', label: 'Runs', unit: 'project runs' },
  { id: 'exports', label: 'Exports', unit: 'code exports' },
];

type Day = ReportOverview['series'][number];

/** Clean integer axis: 0 … max in at most four steps of 1, 2, 5 × 10ⁿ. */
function axis(maxValue: number): { max: number; ticks: number[] } {
  const target = Math.max(1, maxValue);
  const rough = target / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow);
  const max = Math.ceil(target / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return { max, ticks };
}

const M = { top: 16, right: 46, bottom: 28, left: 40 };
const HEIGHT = 250; // includes the x-axis band

export function TrendChart({ series, measure, days }: { series: Day[]; measure: Measure; days: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const meta = MEASURES.find((m) => m.id === measure)!;
  const values = useMemo(() => series.map((d) => d[measure] ?? 0), [series, measure]);
  const total = values.reduce((a, b) => a + b, 0);
  const anyData = series.some((d) => d.activeUsers || d.signups || d.runs || d.exports);

  useEffect(() => setHover(null), [measure, series]);

  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const { max, ticks } = axis(Math.max(0, ...values));
  const n = series.length;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = points.length ? `M${points.join('L')}` : '';
  const area = points.length ? `M${x(0).toFixed(1)},${y(0)}L${points.join('L')}L${x(n - 1).toFixed(1)},${y(0)}Z` : '';

  // at most ~6 date labels, always including the last day
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));
  const labelled = series.map((_, i) => (n - 1 - i) % every === 0);

  const indexAt = (clientX: number, target: SVGElement) => {
    const rect = target.getBoundingClientRect();
    const px = clientX - rect.left - M.left;
    if (n <= 1) return 0;
    return Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1))));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(indexAt(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setHover((h) => {
        const start = h ?? n - 1;
        return Math.max(0, Math.min(n - 1, start + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (e.key === 'Escape') setHover(null);
  };

  const active = hover !== null && series[hover] ? series[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 96), Math.max(96, width - 96)) : 0;
  const last = n - 1;

  return (
    <figure className="viz chart-card">
      <figcaption className="chart-head">
        <div>
          <h3>{meta.label} per day</h3>
          <p className="muted small">
            {measure === 'activeUsers'
              ? `Busiest day: ${statNumber(Math.max(0, ...values))} people · last ${days} days`
              : `${statNumber(total)} ${meta.unit} in the last ${days} days`}
          </p>
        </div>
        <button type="button" className="btn btn-default btn-sm" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <LineChart size={14} /> : <Table2 size={14} />}
          <span>{table ? 'Show chart' : 'Show as table'}</span>
        </button>
      </figcaption>

      {!anyData ? (
        <div className="chart-empty" style={{ height: HEIGHT }}>
          <BarChart3 size={22} />
          <strong>No activity in this period yet</strong>
          <span>Sign-ins, runs and exports will appear here day by day as people use the platform.</span>
        </div>
      ) : table ? (
        <div className="table-wrap chart-table" style={{ maxHeight: HEIGHT + 40 }}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Day</th>
                {MEASURES.map((m) => (
                  <th key={m.id} className="num">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day, true)}</td>
                  {MEASURES.map((m) => (
                    <td key={m.id} className="num">
                      {d[m.id].toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot" ref={wrap} style={{ height: HEIGHT }}>
          {width > 0 && (
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              tabIndex={0}
              aria-label={`${meta.label} per day for the last ${days} days. Use the arrow keys to read each day, or show the data as a table.`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKey}
              onBlur={() => setHover(null)}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-axis' : 'viz-grid'} />
                  <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-tick">
                    {statNumber(t)}
                  </text>
                </g>
              ))}
              {series.map((d, i) =>
                labelled[i] ? (
                  <text key={d.day} x={x(i)} y={HEIGHT - 8} textAnchor={i === last && n > 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="viz-tick">
                    {dayLabel(d.day)}
                  </text>
                ) : null,
              )}
              {total === 0 ? (
                <text x={M.left + plotW / 2} y={M.top + plotH / 2} textAnchor="middle" className="viz-note">
                  No {meta.label.toLowerCase()} in this period
                </text>
              ) : (
                <>
                  <path d={area} className="viz-area" />
                  <path d={line} className="viz-line" />
                  {/* end marker with a surface ring, and the one direct label */}
                  <circle cx={x(last)} cy={y(values[last])} r={6} className="viz-ring" />
                  <circle cx={x(last)} cy={y(values[last])} r={4} className="viz-dot" />
                  {hover === null && (
                    <text x={x(last) + 10} y={y(values[last])} dy="0.32em" className="viz-value">
                      {statNumber(values[last])}
                    </text>
                  )}
                </>
              )}
              {hover !== null && (
                <g pointerEvents="none">
                  <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} className="viz-crosshair" />
                  {total > 0 && (
                    <>
                      <circle cx={x(hover)} cy={y(values[hover])} r={6} className="viz-ring" />
                      <circle cx={x(hover)} cy={y(values[hover])} r={4} className="viz-dot" />
                    </>
                  )}
                </g>
              )}
            </svg>
          )}
          {active && (
            <div className="viz-tooltip" style={{ left: tipLeft }} role="presentation">
              <div className="viz-tooltip-title">{dayLabel(active.day, true)}</div>
              {MEASURES.map((m) => (
                <div key={m.id} className={`viz-tooltip-row ${m.id === measure ? 'current' : ''}`}>
                  <span className="viz-key" />
                  <strong>{active[m.id].toLocaleString()}</strong>
                  <span>{m.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

// ───────────────────────────── Ranked horizontal bars ─────────────────────────────

export interface RankedItem {
  key: string;
  label: string;
  value: number;
  /** Optional in-app link for the label. */
  to?: string;
}

const BAR_H = 10;
const VALUE_SPACE = 52;

/** One bar per item on a shared baseline, one hue, value at the tip. */
export function RankedBars({ title, subtitle, items, unit, empty }: { title: string; subtitle?: string; items: RankedItem[]; unit: string; empty: string }) {
  const [track, width] = useWidth<HTMLDivElement>();
  const max = Math.max(0, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  const span = Math.max(0, width - VALUE_SPACE);

  return (
    <figure className="viz chart-card">
      <figcaption className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
      </figcaption>
      {items.length === 0 || max === 0 ? (
        <div className="chart-empty compact">
          <BarChart3 size={20} />
          <span>{empty}</span>
        </div>
      ) : (
        <div className="ranked" role="list">
          {items.map((item, i) => {
            const w = max > 0 ? Math.max(item.value > 0 ? 3 : 0, (item.value / max) * span) : 0;
            const r = Math.min(4, w / 2);
            // square at the baseline, 4px rounded at the data end
            const d = w > 0 ? `M0,0H${(w - r).toFixed(1)}Q${w.toFixed(1)},0 ${w.toFixed(1)},${r}V${BAR_H - r}Q${w.toFixed(1)},${BAR_H} ${(w - r).toFixed(1)},${BAR_H}H0Z` : '';
            const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
            return (
              <div key={item.key} className="ranked-row" role="listitem" title={`${item.label}: ${item.value.toLocaleString()} ${unit} (${share}% of the total)`}>
                <span className="ranked-label">{item.to ? <Link to={item.to}>{item.label}</Link> : item.label}</span>
                <div className="ranked-track" ref={i === 0 ? track : undefined}>
                  {width > 0 && (
                    <svg width={width} height={BAR_H + 6} aria-hidden="true">
                      <g transform="translate(0,3)">
                        {d && <path d={d} className="viz-bar" />}
                        <text x={w + 8} y={BAR_H / 2} dy="0.34em" className="viz-value">
                          {statNumber(item.value)}
                        </text>
                      </g>
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}
