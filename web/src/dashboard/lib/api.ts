// Client for the local sim server (sim/server.py, default :8787). In `vite dev` / `vite preview` the page can use
// the same-origin /api proxy (vite.config.ts); otherwise it calls the server directly (it sends CORS headers).
const KEY = 'dash.apiBase';

export function apiCandidates(): string[] {
  let saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch { /* private mode */ }
  const qs = new URLSearchParams(location.search).get('api') || '';
  return Array.from(new Set([qs, saved, '/api', 'http://localhost:8787/api'].filter(Boolean)));
}
export function saveApiBase(b: string) { try { localStorage.setItem(KEY, b); } catch { /* ignore */ } }

export type Health = { ok: true; base: string; personas: number } | { ok: false; tried: { base: string; why: string }[] };

async function probe(base: string): Promise<{ ok: boolean; why: string; n?: number }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`${base}/personas`, { signal: ctl.signal });
    clearTimeout(t);
    const txt = await r.text();
    let j: unknown;
    try { j = JSON.parse(txt); } catch { return { ok: false, why: `answered ${r.status} but not with JSON (${txt.slice(0, 40).trim() || 'empty'}): something else is listening there` }; }
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    if (!Array.isArray(j)) return { ok: false, why: 'answered, but /personas is not a list: not the sim server' };
    return { ok: true, why: '', n: j.length };
  } catch (e) {
    return { ok: false, why: (e as Error).name === 'AbortError' ? 'timed out after 3 s' : 'no answer (server not running?)' };
  }
}

export async function findServer(): Promise<Health> {
  const tried: { base: string; why: string }[] = [];
  for (const base of apiCandidates()) {
    const r = await probe(base);
    if (r.ok) return { ok: true, base, personas: r.n || 0 };
    tried.push({ base, why: r.why });
  }
  return { ok: false, tried };
}

export async function post<T>(base: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await r.text();
  let j: { error?: string } & Record<string, unknown>;
  try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
