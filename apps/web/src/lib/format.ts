export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function pretty(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function preview(value: unknown, max = 140): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else {
    try {
      s = JSON.stringify(value) ?? String(value);
    } catch {
      s = String(value);
    }
  }
  s = s.replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function ms(n: number): string {
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`;
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const PROJECT_TYPES = {
  workflow: {
    label: 'Workflow',
    icon: 'workflow',
    blurb: 'A task that runs step by step: fetch data, decide, send an email, call an API.',
  },
  agent: {
    label: 'AI Agent',
    icon: 'bot',
    blurb: 'An assistant that talks with people and uses the tools you give it.',
  },
  solution: {
    label: 'Agent Solution',
    icon: 'network',
    blurb: 'Several agents working together, each with its own job, led by a supervisor.',
  },
} as const;

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Whole numbers in full below 10,000, compact above (12.9K, 4.2M). */
export function statNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 10_000) return Math.round(n).toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** "2026-11-21" → "Nov 21" without time-zone drift. */
export function dayLabel(day: string, withWeekday = false): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, withWeekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}
