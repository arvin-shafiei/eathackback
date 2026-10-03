import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Planogram, Product, StoreConfig } from '../types';
import { SIM_SERVER, STORE_VARIANT } from '../data';
import { archLabel, catColor, catLabel, prodLabel } from '../theme';
import './customer.css';
import { TrolleyImport } from './TrolleyPanel';

/* ---- shapes returned by sim/customer.py (POST /api/customer/profile | route) */
interface Guess {
  archetype: string; p: number; lens_words: string; z?: number; basket_mean?: number; store_mean?: number; store_sd?: number;
  jev_p_fit?: number; evidence: { code: string; name: string; score: number; why: string[] }[];
}
interface Lean { field: string; z: number; text: string; basket_mean: number; store_mean: number; n_basket: number; n_store: number; source: string }
interface Habit { code: string; name: string; visits: number; of: number; source: string }
export interface CustomerProfile {
  id: string;
  persona_guess: { distribution: Guess[]; method: { engine: string; formula: string; note?: string; privacy: string; T?: { value: number; note: string } };
    declared_lenses: { lens: string; words: string; source: string }[] };
  likes: Lean[]; avoids: Lean[]; habits: Habit[]; declared: string[]; shopper_type: string;
  persona: Record<string, unknown>; basket: string[]; visits: string[][]; unknown_codes: string[];
  [k: string]: unknown;
}
interface Spot { slot: string; unit: string; aisle: number; row_name: string }
interface RouteCard {
  usual: { code: string; name: string; now: Spot | null; was: Spot | null; note?: string }[]; usual_source: string;
  route: { stops: { unit: string; aisle: number; category: string; items: string[] }[]; metres: number; seconds: number;
    every_aisle_metres: number; saved_metres: number; saved_seconds: number; source: string };
  slots: string[];
  new_item: null | { code: string; name: string; where: Spot | null; on_route: boolean; reason: string; price_gbp?: number;
    price_source?: string; gates_passed: string[]; rank: string; candidates: number; dropped: Record<string, number>; off_url?: string;
    lens: { lens: string; words: string; score: number; why: string[]; from: string }[] };
  new_item_note: string | null;
}

export interface CustomerPanelProps {
  planogram: Planogram;
  cfg: StoreConfig;
  products: Record<string, Product>;
  /** agents from the current run, so a simulated shopper's basket can stand in for a real one */
  runAgents?: Agent[];
  onClose: () => void;
  /** highlight these slots (route order) in the 3D store */
  onShowRoute?: (slots: string[]) => void;
  /** run whose smart-trolley sessions 'import from smart trolley' reads (default: newest run on the sim server) */
  runId?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), store: STORE_VARIANT?.id }) };
  let res = await fetch(path, init).catch(() => null);
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch(`${SIM_SERVER}${path}`, init);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error ?? `sim server answered ${res.status}`);
  return data as T;
}

const TOLD: { id: string; label: string; kind: 'diet' | 'goals' }[] = [
  { id: 'vegan', label: 'vegan', kind: 'diet' },
  { id: 'gluten_free', label: 'gluten-free', kind: 'diet' },
  { id: 'high_protein', label: 'more protein', kind: 'goals' },
  { id: 'save_money', label: 'save money', kind: 'goals' },
  { id: 'less_processed', label: 'less processed', kind: 'goals' },
  { id: 'eco', label: 'eco', kind: 'goals' },
  { id: 'try_new', label: 'try new things', kind: 'goals' },
];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const words = (a: string) => a.replace(/_/g, ' ');
const taken = (a: Agent) => [...new Set(a.events.filter((e) => e.decision === 'pick').map((e) => e.product))];

export function CustomerPanel({ planogram, products, runAgents, onClose, onShowRoute, runId }: CustomerPanelProps) {
  const [basket, setBasket] = useState<string[]>([]);
  const [visits, setVisits] = useState<string[][]>([]);
  const [q, setQ] = useState('');
  const [told, setTold] = useState<string[]>([]);
  const [prof, setProf] = useState<CustomerProfile | null>(null);
  const [card, setCard] = useState<RouteCard | null>(null);
  const [busy, setBusy] = useState<'' | 'profile' | 'route' | 'save'>('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [trolley, setTrolley] = useState(''); // provenance line when the profile came from smart-trolley sessions

  const onShelf = useMemo(() => new Set(Object.values(planogram).flatMap((s) => s.products)), [planogram]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return Object.values(products).filter((p) => onShelf.has(p.code) && !basket.includes(p.code)
      && `${p.name} ${p.brand}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, products, onShelf, basket]);
  const shoppers = useMemo(() => (runAgents ?? []).filter((a) => a.kind !== 'ai_agent' && taken(a).length > 0), [runAgents]);

  const reset = () => { setProf(null); setCard(null); setSaved(''); setTrolley(''); };
  const add = (c: string) => { setBasket((b) => (b.includes(c) ? b : [...b, c])); setQ(''); reset(); };
  const pickAgent = (id: string) => {
    const a = shoppers.find((x) => x.agent_id === id);
    if (!a) return;
    setBasket(taken(a));
    // an earlier visit from another shopper of the same type, so habits have something to count
    const twin = shoppers.find((x) => x.agent_id !== id && x.persona_id === a.persona_id);
    setVisits(twin ? [taken(twin)] : []);
    reset();
  };
  const declared = {
    diet: told.filter((t) => TOLD.find((x) => x.id === t)?.kind === 'diet'),
    goals: told.filter((t) => TOLD.find((x) => x.id === t)?.kind === 'goals'),
  };

  const firstPlan = useRef(planogram);
  const build = async () => {
    setBusy('profile'); setErr(''); setCard(null); setSaved('');
    firstPlan.current = planogram;
    try {
      const p = await post<CustomerProfile>('/api/customer/profile', { basket, visits, declared, planogram });
      setProf(p);
      setBusy('route');
      setCard(await post<RouteCard>('/api/customer/route', { profile: p, planogram }));
    } catch (e) {
      setErr(e instanceof TypeError ? "can't reach the sim server. start it with python3 sim/server.py" : String((e as Error).message));
    } finally { setBusy(''); }
  };
  // 'import from smart trolley': the profile is built server-side from the loyalty id's trolley sessions, then the
  // usual next-visit flow continues
  const fromTrolley = async (p: CustomerProfile) => {
    const pv = p.provenance as { source: string; link: string; simulated: string; from_trolley_signals: { put_backs: unknown[] } } | undefined;
    setBasket(p.basket); setVisits(p.visits.slice(0, -1)); setCard(null); setSaved(''); setErr('');
    setTrolley(pv ? `${pv.source}: ${pv.link}. ${pv.from_trolley_signals.put_backs.length} put-backs seen by the trolley (EPOS never sees these). ${pv.simulated}` : '');
    setProf(p); firstPlan.current = planogram;
    setBusy('route');
    try { setCard(await post<RouteCard>('/api/customer/route', { profile: p, planogram })); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(''); }
  };
  // the shelves changed after the profile was built (a re-layout): re-plan against the new planogram, so items
  // show 'moved from aisle X to Y' (the profile remembers where each item was when it was bought)
  useEffect(() => {
    if (!prof || planogram === firstPlan.current) return;
    firstPlan.current = planogram;
    post<RouteCard>('/api/customer/route', { profile: prof, planogram }).then(setCard).catch((e) => setErr(String((e as Error).message)));
  }, [planogram, prof]);
  const save = async () => {
    if (!prof) return;
    setBusy('save');
    try { const r = await post<{ file: string }>('/api/customer/save', { profile: prof }); setSaved(r.file); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(''); }
  };

  return (
    <aside className="card customer" aria-label="a customer">
      <header className="cu-top">
        <button className="x" onClick={onClose} aria-label="close">×</button>
        <h2 className="display">a real customer</h2>
        <p className="muted cu-sub">add what they bought. we guess what they shop for, from the products only, and plan their next visit.</p>
      </header>
      <div className="cu-board">
        <section className="cu-tile">
          <h3>what they bought <span className="muted">{basket.length} item{basket.length === 1 ? '' : 's'}{visits.length ? (trolley ? ` · plus ${visits.length} earlier trolley trip${visits.length === 1 ? '' : 's'}` : ` · plus 1 earlier visit (another simulated shopper of the same type)`) : ''}</span></h3>
          <input className="cu-search" placeholder="search by name or brand…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && (
            <ul className="cu-hits">
              {hits.map((p) => (
                <li key={p.code}><button onClick={() => add(p.code)}><i style={{ background: catColor(p.category) }} />{prodLabel(p, p.code)}</button></li>
              ))}
            </ul>
          )}
          {shoppers.length > 0 && (
            <label className="cu-agent">
              <span className="muted">or use a simulated shopper's basket</span>
              <select defaultValue="" onChange={(e) => pickAgent(e.target.value)}>
                <option value="" disabled>pick a shopper…</option>
                {shoppers.map((a) => {
                  const items = taken(a);
                  const spend = items.reduce((t, c) => t + (Number(products[c]?.price_gbp) || 0), 0);
                  const who = archLabel(a.archetype ?? a.persona_id.replace(/^p_/, ''));
                  return <option key={a.agent_id} value={a.agent_id}>{who}{a.mission ? ` · ${a.mission.replace(/_/g, ' ')}` : ''} · {items.length} items · £{spend.toFixed(2)} ({a.agent_id})</option>;
                })}
              </select>
            </label>
          )}
          <TrolleyImport<CustomerProfile> runId={runId} planogram={planogram} declared={declared} onProfile={(p) => void fromTrolley(p)} onError={setErr} />
          {trolley && <p className="cu-small muted">{trolley}</p>}
          {basket.length > 0 && (
            <div className="chips">
              {basket.map((c) => (
                <button key={c} className="chip" title="remove" onClick={() => { setBasket((b) => b.filter((x) => x !== c)); reset(); }}>
                  <i className="dot" style={{ background: catColor(products[c]?.category ?? '') }} aria-hidden />
                  {prodLabel(products[c], c)}
                  <span className="muted"> · {catLabel(products[c]?.category ?? 'unknown')}{products[c]?.price_gbp ? ` · £${Number(products[c]?.price_gbp).toFixed(2)}` : ''}</span> ×
                </button>
              ))}
              {visits.length > 0 && <button className="chip chip-yellow" onClick={() => { setVisits([]); reset(); }}>drop earlier visit ×</button>}
            </div>
          )}
          <h3 className="cu-told-h">they told us <span className="muted">only these switch on diet or health lenses. we never guess them.</span></h3>
          <div className="cu-told">
            {TOLD.map((t) => (
              <label key={t.id} className={`toggle ${told.includes(t.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={told.includes(t.id)} onChange={() => { setTold((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id])); reset(); }} />
                {t.label}
              </label>
            ))}
          </div>
          <div className="cu-btns">
            <button className="btn btn-brand" disabled={!basket.length || !!busy} onClick={build}>
              {busy === 'profile' ? 'reading the basket…' : busy === 'route' ? 'planning the route…' : 'build profile'}
            </button>
          </div>
          {err && <p className="notice" role="status">{err}</p>}
        </section>

        {prof && <ProfileCard prof={prof} onSave={save} saving={busy === 'save'} saved={saved} />}
        {card && <NextVisit card={card} onShowRoute={onShowRoute} />}
      </div>
    </aside>
  );
}

function ProfileCard({ prof, onSave, saving, saved }: { prof: CustomerProfile; onSave: () => void; saving: boolean; saved: string }) {
  const dist = prof.persona_guess.distribution;
  const top = dist.filter((d) => d.p >= 0.1).slice(0, 3);
  const m = prof.persona_guess.method;
  return (
    <section className="cu-tile">
      <h3>looks like</h3>
      <p className="cu-headline">
        {top.map((d, i) => <span key={d.archetype}>{i > 0 && ' · '}<b>{d.lens_words}</b> ({pct(d.p)})</span>)}
      </p>
      <div className="cu-dist" role="img" aria-label="share for each type of shopper">
        {dist.map((d) => <i key={d.archetype} style={{ flexGrow: Math.max(d.p, 0.001) }} title={`${words(d.archetype)}: ${pct(d.p)}`} />)}
      </div>
      <p className="cu-sentence">{prof.shopper_type}</p>
      {prof.persona_guess.declared_lenses.length > 0 && (
        <p className="cu-small">told us: {prof.persona_guess.declared_lenses.map((d) => d.words).join(', ')} <span className="muted">(declared, not guessed)</span></p>
      )}
      <div className="cu-cols">
        <div>
          <h4>likes</h4>
          {prof.likes.length ? <ul className="cu-list">{prof.likes.map((l) => <li key={l.field} title={l.source}>{l.text}</li>)}</ul> : <p className="muted cu-small">nothing stands out from the store average.</p>}
        </div>
        <div>
          <h4>goes light on</h4>
          {prof.avoids.length ? <ul className="cu-list">{prof.avoids.map((l) => <li key={l.field} title={l.source}>{l.text}</li>)}</ul> : <p className="muted cu-small">nothing stands out.</p>}
        </div>
      </div>
      {prof.habits.length > 0 && (
        <>
          <h4>buys every time</h4>
          <ul className="cu-list">{prof.habits.map((h) => <li key={h.code}>{h.name} <span className="muted">({h.visits} of {h.of} visits)</span></li>)}</ul>
        </>
      )}
      <details className="cu-how">
        <summary>how we worked this out</summary>
        <p>{m.engine === 'code' ? 'free, no model: ' : 'typesafe jev: '}<code>{m.formula}</code>{m.T && <> · T = {m.T.value} ({m.T.note})</>}</p>
        {m.note && <p>{m.note}</p>}
        <p>{m.privacy}</p>
        <table className="cu-table">
          <thead><tr><th>type</th><th>share</th><th>basket</th><th>store</th><th>best evidence</th></tr></thead>
          <tbody>
            {dist.map((d) => (
              <tr key={d.archetype}>
                <td>{d.lens_words}</td><td>{pct(d.p)}</td>
                <td>{d.basket_mean ?? (d.jev_p_fit != null ? `jev ${d.jev_p_fit}` : '–')}</td><td>{d.store_mean ?? '–'}</td>
                <td className="muted">{d.evidence[0] ? `${d.evidence[0].name}: ${d.evidence[0].why.join(', ')}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">basket / store = mean catalog lens score (from open food facts fields). likes and avoids compare open food facts fields against every product on the shelves now.</p>
      </details>
      <div className="cu-btns">
        <button className="btn btn-white" onClick={onSave} disabled={saving}>{saving ? 'saving…' : 'save customer'}</button>
        {saved && <span className="muted cu-small">saved to <code>{saved}</code></span>}
      </div>
    </section>
  );
}

function NextVisit({ card, onShowRoute }: { card: RouteCard; onShowRoute?: (slots: string[]) => void }) {
  const r = card.route;
  const n = card.new_item;
  return (
    <section className="cu-tile">
      <h3>next visit</h3>
      <p className="cu-headline">
        <b>{Math.round(r.metres)} m</b> walk <span className="muted">instead of {Math.round(r.every_aisle_metres)} m for every aisle</span>
        {r.saved_metres > 0 && <span className="cu-saved">{Math.round(r.saved_metres)} m saved</span>}
      </p>
      <ol className="cu-route">
        {r.stops.map((s) => (
          <li key={s.unit}>
            <b>aisle {s.aisle}</b> <span className="muted">{words(s.category)}</span>
            <div className="cu-small">{s.items.join(', ')}</div>
          </li>
        ))}
      </ol>
      {card.usual.some((u) => u.note) && (
        <ul className="cu-list cu-moved">
          {card.usual.filter((u) => u.note).map((u) => <li key={u.code}><b>{u.name}</b> {u.note}</li>)}
        </ul>
      )}
      <p className="muted cu-small">usual items: {card.usual_source}. metres: {r.source}</p>
      {n ? (
        <div className="cu-new">
          <h4>one new thing to try</h4>
          <p><b>{n.name}</b>{n.where && <span className="muted"> · aisle {n.where.aisle}, {n.where.row_name} shelf{n.on_route ? ', on the way' : ', a short detour'}</span>}</p>
          <p className="cu-small">{n.reason}</p>
          <p className="muted cu-small">
            {n.gates_passed.join(' · ')} · picked from {n.candidates} products
            {Object.keys(n.dropped).length > 0 && <> · left out: {Object.entries(n.dropped).map(([k, v]) => `${v} ${k}`).join(', ')}</>}
            {n.price_gbp != null && <> · £{n.price_gbp.toFixed(2)} ({n.price_source?.startsWith('assumption') ? 'price is an assumption' : 'price'})</>}
            {n.off_url && <> · <a href={n.off_url} target="_blank" rel="noreferrer">open food facts</a></>}
          </p>
        </div>
      ) : <p className="muted cu-small">{card.new_item_note}</p>}
      {onShowRoute && (
        <div className="cu-btns"><button className="btn btn-brand" onClick={() => onShowRoute(card.slots)}>show route</button></div>
      )}
    </section>
  );
}
