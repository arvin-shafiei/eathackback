import { useEffect, useMemo, useState } from 'react';
import type { Product, Run, StoreConfig } from '../types';
import { SIM_SERVER, STORE_VARIANT } from '../data';
import { prodLabel } from '../theme';
import './trolley.css';

/* ---- shapes returned by sim/trolley.py (GET /api/trolley/sessions, POST /api/trolley/profile). All SIMULATED. */
export interface TrolleyEvent { type: 'scan_in' | 'scan_out' | 'dwell_no_scan'; t: string; bay: string; code?: string; name?: string; dwell_s?: number; label?: string }
export interface TrolleyBay { bay: string; aisle: number | null; slots: string[]; arrive: string; dwell_s: number; events: TrolleyEvent[] }
export interface TrolleySession {
  session_id: string; trolley_id: string; store: string; start: string; end: string; minutes: number;
  bays: TrolleyBay[]; path_slots: string[]; events: TrolleyEvent[];
  counts: { bays: number; scan_in: number; scan_out: number; dwell_no_scan: number };
  checkout: { items: string[]; n_items: number; total_gbp: number; total_source: string; opt_in_loyalty: boolean; loyalty_id: string | null };
}
export interface TrolleyData {
  run_id: string; provenance: string; store: string; n_sessions: number; n_opted_in: number;
  pacing: Record<string, { value: number | string; note: string }>; not_recorded: string[]; privacy: string;
  mapping: Record<string, string>;
  loyalty: { loyalty_id: string; sessions: string[]; trips: number }[];
  sessions: TrolleySession[];
}

export interface TrolleyPanelProps {
  run: Run | null;
  products: Record<string, Product>;
  cfg: StoreConfig;
  onClose: () => void;
  /** highlight these slots (the trolley's path, walking order) in the 3D store */
  onShowPath?: (slots: string[]) => void;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), store: STORE_VARIANT?.id }),
  };
  let res = await fetch(path, init).catch(() => null);
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch(`${SIM_SERVER}${path}`, init);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error ?? `sim server answered ${res.status}`);
  return data as T;
}

export const fetchTrolleys = (runId: string) => api<TrolleyData>(`/api/trolley/sessions?run=${encodeURIComponent(runId)}`);
/** newest run on the sim server, for when the caller has no run id */
export async function newestRunId(): Promise<string | null> {
  const rs = await api<{ run_id: string; arm?: string }[]>('/api/runs');
  return rs.find((r) => r.run_id.startsWith('run_'))?.run_id ?? rs[0]?.run_id ?? null;
}
export function trolleyProfile<T>(runId: string, loyaltyId: string, extra: Record<string, unknown> = {}) {
  return api<T>('/api/trolley/profile', { run: runId, loyalty_id: loyaltyId, ...extra });
}

const hhmm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => iso.slice(0, 10);
const errText = (e: unknown) => (e instanceof TypeError ? "can't reach the sim server. start it with python3 sim/server.py" : String((e as Error).message));

export function TrolleyPanel({ run, products, onClose, onShowPath }: TrolleyPanelProps) {
  const [data, setData] = useState<TrolleyData | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [only, setOnly] = useState<'all' | 'opted' | 'putbacks'>('all');

  useEffect(() => {
    setData(null); setSel(null); setErr('');
    let off = false;
    (async () => {
      try {
        const id = run?.run_id ?? (await newestRunId());
        if (!id) throw new Error('no runs on the sim server yet');
        const d = await fetchTrolleys(id);
        if (!off) setData(d);
      } catch (e) { if (!off) setErr(errText(e)); }
    })();
    return () => { off = true; };
  }, [run?.run_id]);

  const rows = useMemo(() => (data?.sessions ?? []).filter((s) =>
    only === 'all' ? true : only === 'opted' ? s.checkout.opt_in_loyalty : s.counts.scan_out > 0), [data, only]);
  const tot = useMemo(() => {
    const ss = data?.sessions ?? [];
    return { inn: ss.reduce((a, s) => a + s.counts.scan_in, 0), out: ss.reduce((a, s) => a + s.counts.scan_out, 0) };
  }, [data]);
  const cur = data?.sessions.find((s) => s.session_id === sel) ?? null;
  const name = (e: TrolleyEvent) => (e.code ? prodLabel(products[e.code], e.name ?? e.code) : '');

  return (
    <aside className="card trolley" aria-label="smart trolleys">
      <header className="tr-top">
        <button className="x" onClick={onClose} aria-label="close">×</button>
        <h2 className="display">smart trolleys</h2>
        <p className="muted tr-sub">what tracked trolleys would record for these trips: bays, dwell, scans in and out, checkout. no faces, no names.</p>
        <p className="tr-sim">simulated · derived from run <code>{data?.run_id ?? run?.run_id ?? '…'}</code> by <code>sim/trolley.py</code>, not measured in a store</p>
      </header>
      <div className="tr-board">
        {err && <p className="notice" role="status">{err}</p>}
        {!data && !err && <p className="muted">loading trolley sessions…</p>}
        {data && (
          <section className="tr-tile">
            <h3>the put-backs EPOS never sees</h3>
            <p className="tr-big"><b>{tot.out}</b> items scanned out again <span className="muted">of {tot.inn} scanned in, over {data.n_sessions} trips</span></p>
            <p className="muted tr-small">a till only sees what was paid for. a trolley sees the item go in, then come back out. ({String(data.pacing.put_back_capture?.note ?? '')})</p>
            <p className="tr-small">{data.n_opted_in} of {data.n_sessions} trips scanned a loyalty card at the till <span className="muted">({String(data.pacing.opt_in_loyalty?.note ?? '')})</span>. only those link to a person.</p>
          </section>
        )}
        {data && !cur && (
          <section className="tr-tile">
            <h3>trips <span className="muted">{rows.length} shown</span></h3>
            <div className="tr-filter" role="group" aria-label="filter trips">
              {(['all', 'opted', 'putbacks'] as const).map((k) => (
                <button key={k} className={`tr-chip ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)}>
                  {k === 'all' ? 'all' : k === 'opted' ? 'opted in' : 'with put-backs'}
                </button>
              ))}
            </div>
            <table className="tr-table">
              <thead><tr><th>trolley</th><th>min</th><th>bays</th><th>in</th><th>out</th><th>paid</th><th /></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((s) => (
                  <tr key={s.session_id} onClick={() => setSel(s.session_id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(s.session_id)}>
                    <td><code>{s.trolley_id}</code></td><td>{s.minutes}</td><td>{s.counts.bays}</td><td>{s.counts.scan_in}</td>
                    <td className={s.counts.scan_out ? 'tr-out' : ''}>{s.counts.scan_out}</td>
                    <td>£{s.checkout.total_gbp.toFixed(2)}</td>
                    <td>{s.checkout.opt_in_loyalty && <span className="tr-badge" title={s.checkout.loyalty_id ?? ''}>opted in</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {cur && (
          <section className="tr-tile">
            <div className="tr-btns">
              <button className="btn btn-white" onClick={() => setSel(null)}>← all trips</button>
              {onShowPath && <button className="btn btn-brand" onClick={() => onShowPath(cur.path_slots)}>show path</button>}
            </div>
            <h3><code>{cur.trolley_id}</code> <span className="muted">{day(cur.start)} {hhmm(cur.start)}–{hhmm(cur.end)} · {cur.minutes} min</span></h3>
            <p className="tr-small">
              {cur.checkout.opt_in_loyalty
                ? <><span className="tr-badge">opted in</span> loyalty <code>{cur.checkout.loyalty_id}</code> (pseudonymous)</>
                : <span className="muted">anonymous trip: the trolley id resets after this trip and is never linked to a person</span>}
            </p>
            {cur.counts.scan_out > 0 && (
              <div className="tr-puts">
                <h4>put back ({cur.counts.scan_out})</h4>
                <ul>{cur.events.filter((e) => e.type === 'scan_out').map((e, i) => <li key={i}><b>{name(e)}</b> <span className="muted">bay {e.bay} · {hhmm(e.t)}</span></li>)}</ul>
              </div>
            )}
            <ol className="tr-timeline">
              {cur.bays.map((b, i) => (
                <li key={i} className={b.events.length ? '' : 'tr-quiet'}>
                  <div className="tr-bay"><b>{b.bay}</b>{b.aisle != null && <span className="muted"> aisle {b.aisle}</span>}<span className="tr-dwell">{Math.round(b.dwell_s)} s</span><span className="muted tr-t">{hhmm(b.arrive)}</span></div>
                  {b.events.length > 0 && (
                    <ul className="tr-ev">
                      {b.events.map((e, j) => (
                        <li key={j} className={`ev-${e.type}`}>
                          {e.type === 'scan_in' && <>+ {name(e)}</>}
                          {e.type === 'scan_out' && <>− {name(e)} <span className="tr-tag">put back</span></>}
                          {e.type === 'dwell_no_scan' && <span className="muted">{e.label}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <p className="tr-small">checkout: <b>{cur.checkout.n_items} items, £{cur.checkout.total_gbp.toFixed(2)}</b> <span className="muted">({cur.checkout.total_source})</span></p>
          </section>
        )}
        {data && (
          <details className="tr-tile tr-how">
            <summary>how these numbers are made</summary>
            <p><b>{data.provenance}</b></p>
            <h4>sim → trolley signal</h4>
            <ul>{Object.entries(data.mapping).map(([k, v]) => <li key={k}><code>{k}</code> → {v}</li>)}</ul>
            <h4>assumptions</h4>
            <ul>{Object.entries(data.pacing).map(([k, v]) => <li key={k}><code>{k}</code> = {String(v.value)}: {v.note}</li>)}</ul>
            <h4>not recorded (a trolley can't see it)</h4>
            <ul>{data.not_recorded.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="muted">{data.privacy}</p>
          </details>
        )}
      </div>
    </aside>
  );
}

/** CustomerPanel hook-in: pick an opted-in loyalty id, build the profile from its trolley sessions. */
export function TrolleyImport<T>({ runId, planogram, declared, onProfile, onError }: {
  runId?: string; planogram: unknown; declared: unknown; onProfile: (p: T) => void; onError: (m: string) => void;
}) {
  const [data, setData] = useState<TrolleyData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || data) return;
    (async () => {
      try {
        const id = runId ?? (await newestRunId());
        if (!id) throw new Error('no runs on the sim server yet');
        setData(await fetchTrolleys(id));
      } catch (e) { onError(errText(e)); }
    })();
  }, [open, data, runId, onError]);
  const pick = async (lid: string) => {
    if (!data || !lid) return;
    setBusy(true);
    try { onProfile(await trolleyProfile<T>(data.run_id, lid, { planogram, declared })); }
    catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn btn-white tr-import-btn" onClick={() => setOpen(true)}>import from smart trolley</button>;
  return (
    <label className="cu-agent">
      <span className="muted">smart trolley, opted-in loyalty id {data ? `(${data.loyalty.length}, simulated from ${data.run_id})` : '…'}</span>
      <select defaultValue="" disabled={!data || busy} onChange={(e) => void pick(e.target.value)}>
        <option value="" disabled>{busy ? 'reading trolley sessions…' : 'pick a loyalty id…'}</option>
        {data?.loyalty.map((l) => <option key={l.loyalty_id} value={l.loyalty_id}>{l.loyalty_id} · {l.trips} trip{l.trips === 1 ? '' : 's'}</option>)}
      </select>
    </label>
  );
}
