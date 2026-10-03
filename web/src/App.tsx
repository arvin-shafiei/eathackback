import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Arm, Persona, Planogram, Product, Run, RunIndexEntry } from './types';
import { isAI } from './types';
import { loadAll, loadRun, SIM_SERVER, type Loaded } from './data';
import { api } from './api';
import { buildTimeline, scheduleCheckouts, storePlan, QUEUE, TILL, type Timeline } from './layout';
import { engineOfAll } from './ui/engineBadge';
import { armFilter, pickRates, archetypeOf } from './stats';
import { Scene, type CamMode } from './scene/Scene';
import type { ThoughtMode } from './scene/Crowd';
import { Leaderboard } from './ui/Leaderboard';
import { bus, sfx } from './scene/fx';
import { STORE_VARIANT } from './data';
import { ProductPanel } from './ui/ProductPanel';
import { AgentPanel } from './ui/AgentPanel';
import { TracePanel } from './ui/TracePanel';
import { EditPanel } from './ui/EditPanel';
import { ComparePanel } from './ui/ComparePanel';
import { AddProductPanel } from './ui/AddProductPanel';
import { InsightsPanel } from './ui/InsightsPanel';
import { OwnerPanel } from './ui/OwnerPanel';
import { CustomerPanel } from './ui/CustomerPanel';
import { RearrangePanel } from './ui/RearrangePanel';
import { Select } from './ui/Select';
import { aiGear, isAIArch, shopperLabel } from './ui/aiArch';
import { archColor, archLabel, AI_COLOR, ARCH_GEAR, carrierFor } from './theme';

type Panel =
  | { kind: 'product'; code: string }
  | { kind: 'agent'; id: string }
  | { kind: 'trace'; agentId: string; step: number; back?: Panel }
  | null;
type Mode = 'replay' | 'edit' | 'compare' | 'add' | 'insights' | 'rearrange' | 'owner' | 'customer';
const MODE_LABEL: Record<Mode, string> = { replay: 'watch', compare: 'humans vs ai', edit: 'edit shelf', add: 'add product', insights: 'analytics', rearrange: 'rearrange', owner: 'your store', customer: 'shoppers' };
/** the four things a brand does; the rest sit behind "options" */
const MAIN_MODES: Mode[] = ['replay', 'insights', 'owner', 'customer', 'add', 'rearrange'];
const ALL_MODES: Mode[] = ['replay', 'edit', 'add', 'insights', 'owner', 'customer', 'rearrange'];
/** shoppers per brand-upload run: at 20 a single product is passed by under 10 shoppers, which is noise */
const UPLOAD_AGENTS = 150;
const UPLOAD_AI_RUNS = 3;
type Heat = 'off' | 'pick' | 'gap';

const SPEEDS = [0.5, 1, 2, 4, 8];
/** share of replayed human shoppers who stop at the café before leaving.
 *  assumption: visual only (the ops engine owns café occupancy, turnaway and revenue from its own sourced inputs) */
const CAFE_SHARE = 0.15;
/** assumption: shoppers arrive at ≤70% of checkout capacity (a busy but not overloaded hour); visual pacing only */
const ARRIVAL_UTIL = 0.7;
/** assumption: nobody joins a checkout line 6+ deep; they keep browsing until it shortens (visual only) */
const QUEUE_CAP = 6;
/** perf: decision counts up to time t. App re-renders ~8x/s, so the dwell-event times are indexed once per
 *  (agents, timelines) and each render is a binary search instead of a walk over every segment. */
const countsIdx = new WeakMap<object, { tl: object; byDec: Record<string, number[]> }>();
function countsAt(agents: Agent[], timelines: Record<string, Timeline>, t: number) {
  let ix = countsIdx.get(agents);
  if (!ix || ix.tl !== timelines) {
    const byDec: Record<string, number[]> = {};
    for (const a of agents) { const tl = timelines[a.agent_id]; if (!tl) continue; for (const s of tl.segs) if (s.kind === 'dwell' && s.event) (byDec[s.event.decision] ??= []).push(s.t0); }
    for (const k in byDec) byDec[k].sort((x, y) => x - y);
    ix = { tl: timelines, byDec }; countsIdx.set(agents, ix);
  }
  const out: Record<string, number> = {};
  for (const k in ix.byDec) { const xs = ix.byDec[k]; let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= t) lo = m + 1; else hi = m; } if (lo) out[k] = lo; }
  return out;
}
const hash01 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
/** deep links for demos: ?t=40 starts the replay at 40s, ?nointro skips the fly-through */
const START_T = (() => { const v = Number(new URLSearchParams(location.search).get('t')); return Number.isFinite(v) && v > 0 ? v : 0; })();
/** a run that only contains ai agents (sim/agent_shopper.py output) */
const isAgentArm = (r: RunIndexEntry) => r.file.startsWith('agent_') || (r.agents !== undefined && r.ai_agents !== undefined && r.agents > 0 && r.agents === r.ai_agents);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function mix(a: [number, number, number], b: [number, number, number], k: number) {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunIndexEntry[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [localRuns, setLocalRuns] = useState<Record<string, Run>>({});
  const [aiRunId, setAiRunId] = useState<string>('');
  const [aiRun, setAiRun] = useState<Run | null>(null);
  const [useLLM, setUseLLM] = useState(false);
  const [basePlan, setBasePlan] = useState<Planogram | null>(null);
  const [plan, setPlan] = useState<Planogram | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  const [mode, setMode] = useState<Mode>('replay');
  const [arm, setArm] = useState<Arm>(() => { const a = new URLSearchParams(location.search).get('arm'); return a === 'human' || a === 'ai' ? a : 'both'; });
  const [panel, setPanel] = useState<Panel>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [uiTime, setUiTime] = useState(0);
  const [ownerHeat, setOwnerHeat] = useState(false);
  const [routeSlots, setRouteSlots] = useState<string[]>([]);
  const [ownerHeatMin, setOwnerHeatMin] = useState<number | null>(null);
  const [ownerHeatLevel, setOwnerHeatLevel] = useState(0);
  const timeRef = useRef(0);
  const [cam, setCam] = useState<CamMode>(() => (/[?&]nointro/.test(location.search) ? 'overview' : 'intro'));
  const [camNonce, setCamNonce] = useState(0);
  const [thoughts, setThoughts] = useState<ThoughtMode>('all');
  const [heat, setHeat] = useState<Heat>('off');
  const [editSel, setEditSel] = useState<string | null>(null);
  const [rerun, setRerun] = useState<{ busy: boolean; msg: string | null; ok?: boolean }>({ busy: false, msg: null });
  const [showLegend, setShowLegend] = useState(true);
  const [opts, setOpts] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [job, setJob] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  const [preview, setPreview] = useState<Planogram | null>(null);
  useEffect(() => { if (mode !== 'rearrange') setPreview(null); }, [mode]);
  const [soundOn, setSoundOn] = useState(false);
  const [shakeOn, setShakeOn] = useState(true);
  const [bonks, setBonks] = useState(0);
  useEffect(() => { sfx.on = soundOn; if (soundOn) { sfx.ensure(); sfx.pick(); } }, [soundOn]);
  useEffect(() => { bus.shakeOn = shakeOn; }, [shakeOn]);
  useEffect(() => { const id = setInterval(() => setBonks(bus.bonks), 250); return () => clearInterval(id); }, []);

  // ---- load ----
  useEffect(() => {
    Promise.all([document.fonts?.load('800 40px "Baloo 2"').catch(() => null), document.fonts?.load('600 20px Inter').catch(() => null)]).finally(() => setFontsReady(true));
    loadAll()
      .then((d) => { setData(d); setRuns(d.runIndex); setBasePlan(d.planogram); setPlan(d.planogram); const humanRuns = d.runIndex.filter((r) => !isAgentArm(r)); const first = humanRuns.find((r) => (r.agents ?? 0) >= 10) ?? humanRuns[0] ?? d.runIndex[0]; if (first) setRunId(first.run_id); const ai0 = d.runIndex.find(isAgentArm); if (ai0 && first && first.ai_agents === 0) setAiRunId(ai0.run_id); })
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);
  useEffect(() => {
    if (!runId) return;
    if (localRuns[runId]) { setRun(localRuns[runId]); return; }
    const entry = runs.find((r) => r.run_id === runId);
    if (!entry) return;
    setRun(null);
    loadRun(entry).then(setRun).catch((e) => {
      // an indexed run whose file is not in this checkout (gitignored, not synced): drop it and open the next one
      const rest = runs.filter((r) => r.run_id !== entry.run_id && !isAgentArm(r));
      if (!rest.length) { setErr(`couldn't load run ${entry.file}: ${e.message}`); return; }
      setRuns((rs) => rs.filter((r) => r.run_id !== entry.run_id));
      setRunId((rest.find((r) => (r.agents ?? 0) >= 10) ?? rest[0]).run_id);
    });
  }, [runId, runs, localRuns]);
  useEffect(() => {
    if (!aiRunId) { setAiRun(null); return; }
    const entry = runs.find((r) => r.run_id === aiRunId);
    if (localRuns[aiRunId]) { setAiRun(localRuns[aiRunId]); return; }
    if (entry) loadRun(entry).then(setAiRun).catch(() => setAiRun(null));
  }, [aiRunId, runs, localRuns]);
  // the run's own planogram (planogram_inline) wins, so shoppers walk to where products actually were
  useEffect(() => { if (run && data) { const p = { ...data.planogram, ...(run.planogram_inline ?? {}) }; setBasePlan(p); setPlan(p); setMoves([]); } }, [run, data]);
  useEffect(() => { timeRef.current = START_T; setPanel(null); }, [run, aiRun]);
  // ?follow=2 follows the 3rd human shopper (demo deep link)
  useEffect(() => {
    const f = new URLSearchParams(location.search).get('follow');
    if (f == null || !run) return;
    const humans = run.agents.filter((a) => !isAI(a));
    const a = run.agents.find((x) => x.agent_id === f) ?? humans[Number(f)] ?? humans[0];
    if (a) { setPanel({ kind: 'agent', id: a.agent_id }); setCam('follow'); }
  }, [run, aiRun]);
  useEffect(() => { const id = setInterval(() => setUiTime(timeRef.current), 120); return () => clearInterval(id); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); } if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const products = useMemo<Record<string, Product>>(() => Object.fromEntries([...(data?.catalog ?? []), ...(aiRun?.catalog_inline ?? []), ...(run?.catalog_inline ?? [])].map((p) => [p.code, p])), [data, run, aiRun]);
  const personas = useMemo<Record<string, Persona>>(() => Object.fromEntries((data?.personas ?? []).map((p) => [p.id, p])), [data]);
  // merge a separate ai-agent-arm run (agent_*.json) into the human run for the compare view
  const view = useMemo<Run | null>(() => {
    if (!run) return null;
    if (!aiRun || aiRun.run_id === run.run_id) return run;
    const extra = aiRun.agents.filter(isAI).map((a) => ({ ...a, agent_id: `${aiRun.run_id.slice(0, 12)}:${a.agent_id}` }));
    return { ...run, run_id: `${run.run_id} + ${aiRun.run_id}`, agents: [...run.agents, ...extra] };
  }, [run, aiRun]);
  const agents = useMemo(() => (view ? view.agents.filter(armFilter(arm)) : []), [view, arm]);
  const timelines = useMemo(() => {
    if (!data || !view || !basePlan) return {} as Record<string, Timeline>;
    // ARRIVALS (assumption, visual pacing only): shoppers stream in at no more than ARRIVAL_UTIL of the store's checkout
    // capacity, so the queues reflect the layout rather than everyone arriving in the first 90 s. gap between arrivals =
    // mean service time per customer / (lanes x ARRIVAL_UTIL), never closer than 0.45 s. The ops engine owns real footfall.
    const sp = storePlan(data.config);
    const nLanes = Math.max(1, sp.lanes.length);
    const humanItems = view.agents.filter((a) => !isAI(a)).map((a) => a.events.filter((e) => e.decision === 'pick' && e.product).length);
    const meanItems = humanItems.length ? humanItems.reduce((s, n) => s + n, 0) / humanItems.length : 3;
    const svcMean = meanItems * TILL.scanPer + QUEUE.overhead; // s per customer at a till (layout's replay pacing)
    const gap = Math.max(0.45, svcMean / (nLanes * ARRIVAL_UTIL));
    const items: Record<string, number> = {}, carriers: Record<string, string> = {};
    const aiIds = new Set<string>(), cafeIds = new Set<string>();
    view.agents.forEach((a) => {
      const ai = isAI(a);
      items[a.agent_id] = ai ? 0 : a.events.filter((e) => e.decision === 'pick' && e.product).length;
      const arch = ai ? 'ai_agent' : archetypeOf(a, personas);
      carriers[a.agent_id] = carrierFor(arch, a.mission ?? personas[a.persona_id]?.mission, ai);
      if (ai) aiIds.add(a.agent_id);
      // café visit: CAFE_SHARE of human shoppers, picked by a stable hash of the agent id (visual only, see CAFE_SHARE)
      else if (hash01(a.agent_id) < CAFE_SHARE) cafeIds.add(a.agent_id);
    });
    // QUEUE CAP (assumption): nobody joins a line already QUEUE_CAP deep. Instead they keep browsing in the aisle where
    // they finished (a held dwell, no decision attached) until the line has room, then walk up. Iterated a few times
    // because delaying one shopper reshapes everyone's queue.
    const delay: Record<string, number> = {};
    const lanesOf = (g: string) => (g === 'self' ? Math.max(1, sp.lanes.filter((l) => l.kind === 'self').length) : 1);
    let out: Record<string, Timeline> = {};
    for (let pass = 0; pass < 5; pass++) {
      out = {};
      view.agents.forEach((a, i) => {
        const tl = buildTimeline(data.config, basePlan, a, 0.6 + i * gap, i, isAI(a));
        const d = delay[a.agent_id] ?? 0;
        const last = tl.segs[tl.segs.length - 1];
        if (d > 0 && last) { tl.segs.push({ t0: tl.end, t1: tl.end + d, a: last.b, b: last.b, kind: 'dwell' }); tl.end += d; }
        out[a.agent_id] = tl;
      });
      scheduleCheckouts(data.config, out, items, carriers, aiIds, cafeIds);
      let over = 0;
      for (const id in out) {
        const q = out[id].queue; const k = q?.slots[0]?.k ?? 0;
        if (q && k >= QUEUE_CAP) { over++; delay[id] = (delay[id] ?? 0) + ((k - QUEUE_CAP + 1) * svcMean) / lanesOf(q.group); }
      }
      if (!over) break;
    }
    return out;
  }, [data, view, basePlan, personas]);
  const duration = useMemo(() => Math.max(10, ...agents.map((a) => timelines[a.agent_id]?.end ?? 0)) + 1, [agents, timelines]);

  const changed = useMemo(() => {
    const s = new Set<string>();
    if (plan && basePlan) for (const k of Object.keys(plan)) if (JSON.stringify(plan[k]) !== JSON.stringify(basePlan[k])) s.add(k);
    return s;
  }, [plan, basePlan]);
  const [moves, setMoves] = useState<string[]>([]);
  const swap = useCallback((a: string, b: string) => {
    setPlan((p) => (p ? { ...p, [a]: p[b], [b]: p[a] } : p));
    setMoves((m) => [...m, `${a} ⇄ ${b}`]);
    setEditSel(null);
  }, []);
  const onSlot = useCallback((slot: string) => {
    if (editSel && editSel !== slot) { swap(editSel, slot); return; }
    setEditSel(editSel === slot ? null : slot);
  }, [swap, editSel]);

  const heatMap = useMemo(() => {
    if (!view || heat === 'off') return null;
    const out: Record<string, string> = {};
    if (heat === 'pick') { const r = pickRates(view, arm); for (const [k, v] of Object.entries(r)) out[k] = mix([253, 226, 228], [22, 163, 74], v.rate / 0.6); }
    else {
      const h = pickRates(view, 'human'), a = pickRates(view, 'ai');
      for (const k of Object.keys(products)) { const g = (a[k]?.rate ?? 0) - (h[k]?.rate ?? 0); out[k] = g >= 0 ? mix([245, 240, 245], [109, 40, 217], g / 0.4) : mix([245, 240, 245], [22, 163, 74], -g / 0.4); }
    }
    return out;
  }, [view, heat, arm, products]);

  const doRerun = async () => {
    if (!plan || !run) return;
    setRerun({ busy: true, msg: null });
    try {
      const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planogram: plan, agents: 20, seed: 1, mock: !useLLM, label: 'ui-edit', base_run_id: run.run_id, moves, products: run.catalog_inline }) };
      // try the vite dev proxy first (no CORS needed), then the sim server directly
      let res = await fetch('/api/run', init).catch(() => null);
      if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch(`${SIM_SERVER}/api/run`, init);
      if (!res.ok) throw new Error(`sim server answered ${res.status}`);
      const body = await res.json();
      const newRun: Run | undefined = body?.agents ? body : body?.run?.agents ? body.run : undefined;
      if (newRun) {
        setLocalRuns((m) => ({ ...m, [newRun.run_id]: newRun }));
        setRuns((r) => [{ run_id: newRun.run_id, file: '', created: newRun.created, agents: newRun.agents.length }, ...r]);
        setRunId(newRun.run_id); setMode('replay');
        setRerun({ busy: false, msg: `new run ${newRun.run_id}: ${newRun.agents.length} shoppers on your layout.`, ok: true });
      } else {
        setRerun({ busy: false, msg: `sim server accepted the job${body?.run_id ? ` (${body.run_id})` : ''}. run "npm run sync" when it finishes, then reload.`, ok: true });
      }
    } catch (e) {
      setRerun({ busy: false, msg: `no sim server at ${SIM_SERVER} (${(e as Error).message}). this is the stub: download the json and run the sim on it, e.g. python sim/run.py --planogram planogram.edited.json, then npm run sync.` });
    }
  };

  const register = (r: Run, ai = false) => {
    setLocalRuns((m) => ({ ...m, [r.run_id]: r }));
    setRuns((rs) => [{ run_id: r.run_id, file: '', created: r.created, agents: r.agents.length, ai_agents: ai ? r.agents.length : 0 }, ...rs]);
    if (ai) setAiRunId(r.run_id); else setRunId(r.run_id);
  };
  /** simulate a store (optionally with brand-supplied products) and load the result */
  const simulate = async (p: Planogram, extra: Product[], label: string, withAI = false) => {
    setJob({ busy: true, msg: `${UPLOAD_AGENTS} shoppers are walking the store…` });
    try {
      const human = await api.run({ planogram: p, products: extra, agents: UPLOAD_AGENTS, seed: 1, mock: !useLLM, label });
      let warn: string | null = null;
      let ai: Run | null = null;
      if (withAI && data) {
        setJob({ busy: true, msg: 'ai shopping agents are reading the feed…' });
        // both arms shop the same range: drop every catalogue product that is no longer on this shelf
        const onShelf = new Set(Object.values(p).flatMap((s) => s.products));
        const exclude = Object.values(data.planogram).flatMap((s) => s.products).filter((c) => !onShelf.has(c));
        try { ai = await api.agentRun({ products: extra, exclude, runs: UPLOAD_AI_RUNS, seed: 1, mock: !useLLM }); }
        catch (e) { setAiRunId(''); warn = `the shoppers finished, but the ai-agent arm failed (${(e as Error).message}), so there is no human vs ai comparison for this run.`; }
      }
      // both runs land in one render: the physics crowd rebuilds its bodies once, not twice in a row
      if (ai) register(ai, true);
      register(human);
      setJob({ busy: false, msg: warn });
      return true;
    } catch (e) {
      setJob({ busy: false, msg: `the sim server did not finish the run: ${(e as Error).message}. start it with "python3 sim/server.py".` });
      return false;
    }
  };
  const addProduct = async (product: Product, slot: string, replaces: string) => {
    const set = basePlan?.[slot];
    if (!basePlan || !set) return;
    if (!set.products.includes(replaces)) { setJob({ busy: false, msg: 'that product is no longer in that slot. pick the product to replace again.' }); return; }
    const { [replaces]: oldFacings, ...facings } = set.facings ?? {};
    const next: Planogram = { ...basePlan, [slot]: { ...set, products: set.products.map((c) => (c === replaces ? product.code : c)), facings: { ...facings, [product.code]: oldFacings ?? 1 } } };
    const others = (run?.catalog_inline ?? []).filter((x) => x.code !== product.code && x.code !== replaces);
    setFocus(product.code);
    if (await simulate(next, [...others, product], `upload ${product.name}`, true)) setMode('insights');
  };

  if (err) return <div className="splash"><div className="card splash-card"><h1 className="display">couldn't load the store</h1><p>{err}</p><p className="muted">run <code>npm run fixtures</code> or <code>npm run sync</code> in <code>web/</code> so <code>public/data/</code> has the json files.</p></div></div>;
  if (!data || !plan || !basePlan || !fontsReady) return <div className="splash"><div className="sticker sticker-brand big pulse">stocking shelves…</div></div>;

  const personaFor = (a: { persona_id: string; archetype?: string }) => personas[a.persona_id] ?? (a.archetype ? Object.values(personas).find((p) => p.archetype === a.archetype) : undefined);
  const findEvent = (agentId: string, step: number) => { const a = view?.agents.find((x) => x.agent_id === agentId); return a ? { a, e: a.events.find((x) => x.step === step) } : null; };
  const selAgent = panel?.kind === 'agent' ? panel.id : panel?.kind === 'trace' ? panel.agentId : null;
  const openTrace = (agentId: string, step: number) => setPanel((cur) => ({ kind: 'trace', agentId, step, back: cur && cur.kind !== 'trace' ? cur : cur?.kind === 'trace' ? cur.back : undefined }));
  const archetypesInRun = view ? [...new Set(view.agents.map((a) => archetypeOf(a, personas)))] : []; // AI agents group by archetype too
  const slotOf = (code: string) => Object.entries(basePlan).find(([, s]) => s.products.includes(code))?.[0];
  const counts = view ? countsAt(agents, timelines, uiTime) : {};

  const onShelf = Object.values(basePlan).flatMap((s) => s.products);
  const focusProduct = products[focus ?? ''] ?? products[run?.catalog_inline?.[0]?.code ?? ''] ?? products[onShelf[0]];

  let side: JSX.Element | null = null;
  if (view && panel?.kind === 'product' && products[panel.code]) side = <ProductPanel run={view} product={products[panel.code]} slot={slotOf(panel.code)} arm={arm} personas={personas} onTrace={openTrace} onClose={() => setPanel(null)} />;
  if (view && panel?.kind === 'agent') { const a = view.agents.find((x) => x.agent_id === panel.id); if (a) side = <AgentPanel agent={a} persona={personaFor(a)} products={products} time={uiTime} timeline={timelines[a.agent_id]} config={data.config} following={cam === 'follow'} onFollow={() => setCam((c) => (c === 'follow' ? 'overview' : 'follow'))} onTrace={openTrace} onClose={() => setPanel(null)} />; }
  if (view && panel?.kind === 'trace') {
    const f = findEvent(panel.agentId, panel.step);
    if (f?.e) side = <TracePanel run={view} agent={f.a} event={f.e} persona={personaFor(f.a)} product={products[f.e.product]} products={products} onAgent={() => setPanel({ kind: 'agent', id: f.a.agent_id })} onProduct={() => setPanel({ kind: 'product', code: f.e!.product })} onBack={panel.back ? () => setPanel(panel.back!) : undefined} onClose={() => setPanel(null)} />;
  }

  const legend = archetypesInRun.map((a) => {
    const persona = Object.values(personas).find((p) => p.archetype === a);
    const ai = isAIArch(a) || a === 'ai_agent';
    const c = carrierFor(a, persona?.mission, ai);
    const first = view?.agents.find((x) => archetypeOf(x, personas) === a); // legend row opens this archetype's card
    return { a, c, ai, persona, first };
  });
  const nShoppers = view?.agents.length ?? 0;
  const nProducts = Object.keys(basePlan).reduce((s, k) => s + (basePlan[k]?.products?.length ?? 0), 0);
  const intro = cam === 'intro';
  const engineInfo = engineOfAll(run, aiRun && aiRun.run_id !== run?.run_id ? aiRun : null);

  return (
    <div className={`app mode-${mode} ${intro ? 'is-intro' : ''}`}>
      <div className="stage">
        <Scene
          cfg={data.config} planogram={mode === 'edit' ? plan : mode === 'rearrange' && preview ? preview : basePlan} replayPlan={basePlan} products={products} personas={personas}
          agents={agents} timelines={timelines} timeRef={timeRef} playing={playing && (mode === 'replay' || mode === 'compare')} speed={speed} duration={duration}
          selectedProduct={panel?.kind === 'product' ? panel.code : panel?.kind === 'trace' ? findEvent(panel.agentId, panel.step)?.e?.product ?? null : null}
          onProduct={(code) => setPanel({ kind: 'product', code })}
          selectedAgent={selAgent} onAgent={(id) => setPanel({ kind: 'agent', id })} onEvent={openTrace}
          editMode={mode === 'edit'} editSel={editSel} onSlot={onSlot} changed={mode === 'customer' && routeSlots.length ? new Set(routeSlots) : changed}
          heat={heatMap} ownerHeat={mode === 'owner' && ownerHeat} ownerHeatMin={ownerHeatMin} ownerHeatLevel={ownerHeatLevel} thoughts={thoughts} cam={cam} camNonce={camNonce} onBackground={() => mode === 'edit' && setEditSel(null)}
          onIntroDone={() => setCam('overview')} onUserCamera={() => { if (cam === 'intro') { setCam('overview'); setCamNonce((n) => n + 1); } }}
        />
      </div>

      <header className="topbar">
        <div className="brand">
          <h1 className="sticker-title" data-text="simsbury">simsbury</h1>
          <span className="brand-chip" aria-hidden>🛒🤖</span>
        </div>
        <nav className="seg seg-main" aria-label="mode">
          {(opts ? ALL_MODES : ALL_MODES.filter((m) => MAIN_MODES.includes(m) || m === mode)).map((m) => (
            <button key={m} className={`seg-btn ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); if (m === 'edit') setPanel(null); }}>
              {MODE_LABEL[m]}
            </button>
          ))}
          <button className={`seg-btn ${opts ? 'on' : ''}`} aria-pressed={opts} onClick={() => setOpts((v) => !v)} title="runs, camera, thought bubbles, heat, sound">options</button>
        </nav>
        {opts && <div className="tools">
          <Select
            ariaLabel="run" prefix="run" searchable value={runId ?? ''} onChange={setRunId}
            options={runs.filter((r) => !isAgentArm(r)).map((r) => ({ value: r.run_id, label: `${r.run_id}${r.fixture ? ' (fixture)' : ''}`, hint: r.agents ? `${r.agents} agents` : undefined }))}
          />
          {false && runs.some(isAgentArm) && (
            <Select
              ariaLabel="ai arm" prefix="+ ai arm" searchable value={aiRunId} onChange={setAiRunId}
              options={[{ value: '', label: 'none' }, ...runs.filter(isAgentArm).map((r) => ({ value: r.run_id, label: r.run_id, hint: r.agents ? `${r.agents} agents` : undefined }))]}
            />
          )}
          <button className={`icon-btn ${soundOn ? 'on' : ''}`} onClick={() => setSoundOn((v) => !v)} aria-pressed={soundOn} aria-label={soundOn ? 'mute sound' : 'turn sound on'} title="cartoon sounds (off by default)">{soundOn ? '🔊' : '🔇'}</button>
        </div>}
      </header>

      {mode === 'replay' && view && !intro && <Leaderboard run={view} arm={arm} products={products} engine={engineInfo} onProduct={(code) => setPanel({ kind: 'product', code })} />}

      {(run?._fixture || STORE_VARIANT?.fixture) && <div className="fixture-banner" title={run?._fixture}>{STORE_VARIANT?.fixture ? `fixture store layout (${STORE_VARIANT.label ?? STORE_VARIANT.id}): proves the 3d scales, not results` : 'fixture data: synthetic decisions to exercise the ui, not results'}</div>}

      {intro && (
        <div className="intro" role="dialog" aria-label="intro">
          <div className="intro-card">
            <div className="intro-kicker">eat_hack · track 1 human truth</div>
            <h2 className="intro-title">simsbury</h2><p className="intro-tag">same shelf, two shoppers</p>
            <p className="intro-sub">{nShoppers} shoppers · {nProducts} real products · every number traced to its source</p>
            <button className="btn btn-brand" onClick={() => { setCam('overview'); setCamNonce((n) => n + 1); }}>skip intro →</button>
          </div>
        </div>
      )}

      {mode === 'replay' && !intro && opts && (
        <div className="lefttools">
          <div className="card mini">
            <div className="mini-h">camera</div>
            <div className="seg small col">
              <button className={`seg-btn ${cam === 'overview' ? 'on' : ''}`} onClick={() => { setCam('overview'); setCamNonce((n) => n + 1); }}>overview</button>
              <button className={`seg-btn ${cam === 'walk' ? 'on' : ''}`} onClick={() => { setCam('walk'); setCamNonce((n) => n + 1); }}>walk (wasd)</button>
              <button className={`seg-btn ${cam === 'follow' ? 'on' : ''}`} disabled={!selAgent} onClick={() => setCam('follow')} title={selAgent ? '' : 'click a shopper first'}>follow shopper</button>
              <button className="seg-btn" onClick={() => { timeRef.current = 0; setCam('intro'); setCamNonce((n) => n + 1); }}>🎬 fly-through</button>
            </div>
            <div className="mini-h">thoughts</div>
            <div className="seg small">
              {(['all', 'selected', 'off'] as ThoughtMode[]).map((t) => <button key={t} className={`seg-btn ${thoughts === t ? 'on' : ''}`} onClick={() => setThoughts(t)}>{t}</button>)}
            </div>
            <div className="mini-h">shelf-edge heat</div>
            <div className="seg small">
              {(['off', 'pick'] as Heat[]).map((h) => <button key={h} className={`seg-btn ${heat === h ? 'on' : ''}`} onClick={() => setHeat(h)}>{h === 'pick' ? 'pick rate' : h === 'gap' ? 'ai − human' : 'off'}</button>)}
            </div>
            {heat === 'gap' && <p className="legend-note"><i style={{ background: '#16a34a' }} /> humans pick more <i style={{ background: AI_COLOR }} /> agents pick more</p>}
            <div className="mini-h">silliness</div>
            <div className="seg small">
              <button className={`seg-btn ${shakeOn ? 'on' : ''}`} onClick={() => setShakeOn((v) => !v)} aria-pressed={shakeOn}>screen shake</button>
              <button className={`seg-btn ${soundOn ? 'on' : ''}`} onClick={() => setSoundOn((v) => !v)} aria-pressed={soundOn}>sound</button>
            </div>
          </div>
          {showLegend && (
            <div className="card mini legend">
              <div className="mini-h">who's shopping <button className="link-btn" onClick={() => setShowLegend(false)}>hide</button></div>
              {legend.map(({ a, c, ai, persona, first }) => (
                <div key={a} className="leg" role={first ? 'button' : undefined} tabIndex={first ? 0 : undefined} style={first ? { cursor: 'pointer' } : undefined}
                  title={first ? `open the ${ai ? 'agent' : 'persona'} card` : undefined}
                  onClick={() => first && setPanel({ kind: 'agent', id: first.agent_id })}
                  onKeyDown={(ev) => { if (first && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setPanel({ kind: 'agent', id: first.agent_id }); } }}>
                  <span className="dot" style={{ background: archColor(a) }} />
                  <span className="leg-name">{ai ? shopperLabel(a === 'ai_agent' ? 'ai_agent' : a, persona) : archLabel(a)}</span>
                  <span className="leg-carrier" title={`trolley (visual); checkout lane uses the mission carrier: ${c}`}>🛒</span>
                </div>
              ))}
              <p className="legend-foot">everyone pushes a trolley (visual). checkout lane choice still follows the mission carrier (assumption: big shop = trolley, top-up = basket). bonks are visual, not data.</p>
            </div>
          )}
        </div>
      )}

      {mode === 'compare' && view && <ComparePanel run={view} products={products} onProduct={(code) => setPanel({ kind: 'product', code })} onClose={() => setMode('replay')} />}
      {mode === 'edit' && (
        <EditPanel cfg={data.config} planogram={plan} products={products} changed={changed} selected={editSel} onSwap={swap} onSelect={(s) => s && onSlot(s)}
          onReset={() => { setPlan(basePlan); setMoves([]); setEditSel(null); setRerun({ busy: false, msg: null }); }} onRerun={doRerun} rerunState={rerun} moves={moves}
          useLLM={useLLM} onUseLLM={setUseLLM} />
      )}
      {mode === 'add' && (
        <AddProductPanel cfg={data.config} planogram={basePlan} products={products} useLLM={useLLM} onUseLLM={setUseLLM}
          busy={job.busy} msg={job.msg} onSubmit={addProduct} onClose={() => setMode('replay')} />
      )}
      {mode === 'insights' && view && focusProduct && (
        <InsightsPanel run={view} product={focusProduct} slot={slotOf(focusProduct.code)} planogram={basePlan} cfg={data.config} products={products} personas={personas}
          extraProducts={run?.catalog_inline ?? []} useLLM={useLLM} onUseLLM={setUseLLM} busy={job.busy}
          onPickProduct={setFocus} onTrace={openTrace} onClose={() => setMode('replay')}
          onApplyPlanogram={(p, label) => { setFocus(focusProduct.code); void simulate(p, run?.catalog_inline ?? [], label); }} />
      )}
      {mode === 'rearrange' && run && (
        <RearrangePanel run={run} planogram={basePlan} cfg={data.config} products={products} extraProducts={run.catalog_inline ?? []}
          focus={focus ?? undefined} useLLM={useLLM} onUseLLM={setUseLLM} busy={job.busy} onPreview={setPreview}
          onPickProduct={(code) => { setFocus(code); setMode('insights'); }} onClose={() => setMode('replay')}
          onApplyPlanogram={(p, label) => { setPreview(null); void simulate(p, run.catalog_inline ?? [], label); }} />
      )}
      {mode === 'customer' && (
        <CustomerPanel planogram={basePlan} cfg={data.config} products={products} runAgents={run?.agents}
          onClose={() => { setRouteSlots([]); setMode('replay'); }} onShowRoute={setRouteSlots} />
      )}
      {mode === 'owner' && (
        <OwnerPanel cfg={data.config} planogram={basePlan} products={products} timelines={timelines} run={view}
          onToggleHeat={setOwnerHeat} onHeatWindow={setOwnerHeatMin} onHeatMin={setOwnerHeatLevel}
          onOpenRearrange={() => setMode('rearrange')} onClose={() => setMode('replay')} />
      )}
      {job.msg && (mode === 'insights' || mode === 'rearrange') && <div className="loading-run sticker">{job.msg}</div>}
      {side && mode !== 'edit' && mode !== 'add' && mode !== 'rearrange' && <div className="side">{side}</div>}

      {(mode === 'replay' || mode === 'compare') && !intro && (
        <footer className="replay card">
          <button className="btn btn-brand round" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'pause' : 'play'}>{playing ? '❚❚' : '▶'}</button>
          <input type="range" min={0} max={duration} step={0.1} value={uiTime} onChange={(e) => { timeRef.current = Number(e.target.value); setUiTime(timeRef.current); }} aria-label="replay time" />
          <span className="time">{fmt(uiTime)} / {fmt(duration)}</span>
          {opts
            ? <div className="seg small">{SPEEDS.map((s) => <button key={s} className={`seg-btn ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
            : <button className="seg-btn" title="change speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>speed {speed}×</button>}
          <div className="counts">
            <span className="count count-good" title="products bought so far">{counts.pick ?? 0} bought</span>
            <span className="count count-bad" title="products picked up and put back so far">{counts.reject ?? 0} put back</span>
            <span className="count" title="products noticed and walked past so far">{counts.walk_past ?? 0} walked past</span>
            {opts && <span className="count count-bonk" title="physics bonks between shoppers. visual only, not part of the sim">💥 {bonks}</span>}
          </div>
          {rerun.ok && rerun.msg && <span className="muted small">{rerun.msg}</span>}
        </footer>
      )}
      {!run && <div className="loading-run sticker">loading run…</div>}
    </div>
  );
}
