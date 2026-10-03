/** Wilson score interval, z = 1.96 (Wilson 1927, JASA 22:209) — same rule the sim uses (sim/run.py). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`;
export const signedPct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x * 100).toFixed(d)}%`;
export const num = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d);
export const signed = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;
export const gbp = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : `£${x.toFixed(d)}`;
export const ci = (c?: [number, number] | number[] | null, f: (x: number) => string = (x) => pct(x, 0)) =>
  c && c.length === 2 ? `${f(c[0])}–${f(c[1])}` : '—';
export const human = (s: string) => s.replace(/^p_/, '').replace(/_/g, ' ');
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
