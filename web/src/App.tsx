import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Arm, Persona, Planogram, Product, Run, RunIndexEntry } from './types';
import { isAI } from './types';
import { loadAll, loadRun, SIM_SERVER, type Loaded } from './data';
import { buildTimeline, type Timeline } from './layout';
import { armFilter, pickRates, archetypeOf } from './stats';
import { Scene, type CamMode } from './scene/Scene';
import type { ThoughtMode } from './scene/Shoppers';
import { ProductPanel } from './ui/ProductPanel';
import { AgentPanel } from './ui/AgentPanel';
import { TracePanel } from './ui/TracePanel';
import { EditPanel } from './ui/EditPanel';
import { ComparePanel } from './ui/ComparePanel';
import { archColor, archLabel, AI_COLOR } from './theme';

type Panel =
  | { kind: 'product'; code: string }
  | { kind: 'agent'; id: string }
  | { kind: 'trace'; agentId: string; step: number; back?: Panel }
  | null;
type Mode = 'replay' | 'edit' | 'compare';
type Heat = 'off' | 'pick' | 'gap';

const SPEEDS = [0.5, 1, 2, 4, 8];
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
  const [arm, setArm] = useState<Arm>('both');
  const [panel, setPanel] = useState<Panel>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [uiTime, setUiTime] = useState(0);
  const timeRef = useRef(0);
  const [cam, setCam] = useState<CamMode>('overview');
  const [camNonce, setCamNonce] = useState(0);
  const [thoughts, setThoughts] = useState<ThoughtMode>('all');
  const [heat, setHeat] = useState<Heat>('off');
  const [editSel, setEditSel] = useState<string | null>(null);
  const [rerun, setRerun] = useState<{ busy: boolean; msg: string | null; ok?: boolean }>({ busy: false, msg: null });
  const [showLegend, setShowLegend] = useState(true);

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
    loadRun(entry).then(setRun).catch((e) => setErr(`couldn't load run ${entry.file}: ${e.message}`));
  }, [runId, runs, localRuns]);
  useEffect(() => {
    if (!aiRunId) { setAiRun(null); return; }
    const entry = runs.find((r) => r.run_id === aiRunId);
    if (localRuns[aiRunId]) { setAiRun(localRuns[aiRunId]); return; }
    if (entry) loadRun(entry).then(setAiRun).catch(() => setAiRun(null));
  }, [aiRunId, runs, localRuns]);
  // the run's own planogram (planogram_inline) wins, so shoppers walk to where products actually were
  useEffect(() => { if (run && data) { const p = run.planogram_inline ?? data.planogram; setBasePlan(p); setPlan(p); setMoves([]); } }, [run, data]);
  useEffect(() => { timeRef.current = 0; setPanel(null); }, [run, aiRun]);
  useEffect(() => { const id = setInterval(() => setUiTime(timeRef.current), 120); return () => clearInterval(id); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); } if (e.key === 'Escape') setPanel(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const products = useMemo<Record<string, Product>>(() => Object.fromEntries((data?.catalog ?? []).map((p) => [p.code, p])), [data]);
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
    const out: Record<string, Timeline> = {};
    view.agents.forEach((a, i) => { out[a.agent_id] = buildTimeline(data.config, basePlan, a, i * 1.4, i); });
    return out;
  }, [data, view, basePlan]);
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
      const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planogram: plan, agents: 20, seed: 1, mock: !useLLM, label: 'ui-edit', base_run_id: run.run_id, moves }) };
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

  if (err) return <div className="splash"><div className="card splash-card"><h1 className="display">couldn't load the store</h1><p>{err}</p><p className="muted">run <code>npm run fixtures</code> or <code>npm run sync</code> in <code>web/</code> so <code>public/data/</code> has the json files.</p></div></div>;
  if (!data || !plan || !basePlan || !fontsReady) return <div className="splash"><div className="sticker sticker-brand big pulse">stocking shelves…</div></div>;

  const personaFor = (a: { persona_id: string; archetype?: string }) => personas[a.persona_id] ?? (a.archetype ? Object.values(personas).find((p) => p.archetype === a.archetype) : undefined);
  const findEvent = (agentId: string, step: number) => { const a = view?.agents.find((x) => x.agent_id === agentId); return a ? { a, e: a.events.find((x) => x.step === step) } : null; };
  const selAgent = panel?.kind === 'agent' ? panel.id : panel?.kind === 'trace' ? panel.agentId : null;
  const openTrace = (agentId: string, step: number) => setPanel((cur) => ({ kind: 'trace', agentId, step, back: cur && cur.kind !== 'trace' ? cur : cur?.kind === 'trace' ? cur.back : undefined }));
  const archetypesInRun = view ? [...new Set(view.agents.map((a) => (isAI(a) ? 'ai' : archetypeOf(a, personas))))] : [];
  const slotOf = (code: string) => Object.entries(basePlan).find(([, s]) => s.products.includes(code))?.[0];
  const counts = view ? agents.reduce((acc, a) => { const tl = timelines[a.agent_id]; if (!tl) return acc; for (const s of tl.segs) if (s.kind === 'dwell' && s.t0 <= uiTime && s.event) acc[s.event.decision] = (acc[s.event.decision] ?? 0) + 1; return acc; }, {} as Record<string, number>) : {};

  let side: JSX.Element | null = null;
  if (view && panel?.kind === 'product' && products[panel.code]) side = <ProductPanel run={view} product={products[panel.code]} slot={slotOf(panel.code)} arm={arm} personas={personas} onTrace={openTrace} onClose={() => setPanel(null)} />;
  if (view && panel?.kind === 'agent') { const a = view.agents.find((x) => x.agent_id === panel.id); if (a) side = <AgentPanel agent={a} persona={personaFor(a)} products={products} following={cam === 'follow'} onFollow={() => setCam((c) => (c === 'follow' ? 'overview' : 'follow'))} onTrace={openTrace} onClose={() => setPanel(null)} />; }
  if (view && panel?.kind === 'trace') {
    const f = findEvent(panel.agentId, panel.step);
    if (f?.e) side = <TracePanel run={view} agent={f.a} event={f.e} persona={personaFor(f.a)} product={products[f.e.product]} onAgent={() => setPanel({ kind: 'agent', id: f.a.agent_id })} onProduct={() => setPanel({ kind: 'product', code: f.e!.product })} onBack={panel.back ? () => setPanel(panel.back!) : undefined} onClose={() => setPanel(null)} />;
  }

  return (
    <div className={`app mode-${mode}`}>
      <div className="stage">
        <Scene
          cfg={data.config} planogram={mode === 'edit' ? plan : basePlan} products={products} personas={personas}
          agents={agents} timelines={timelines} timeRef={timeRef} playing={playing && mode !== 'edit'} speed={speed} duration={duration}
          selectedProduct={panel?.kind === 'product' ? panel.code : panel?.kind === 'trace' ? findEvent(panel.agentId, panel.step)?.e?.product ?? null : null}
          onProduct={(code) => setPanel({ kind: 'product', code })}
          selectedAgent={selAgent} onAgent={(id) => setPanel({ kind: 'agent', id })} onEvent={openTrace}
          editMode={mode === 'edit'} editSel={editSel} onSlot={onSlot} changed={changed}
          heat={heatMap} thoughts={thoughts} cam={cam} camNonce={camNonce} onBackground={() => mode === 'edit' && setEditSel(null)}
        />
      </div>

      <header className="topbar">
        <div className="brand">
          <h1 className="sticker-title" data-text="same shelf">same shelf</h1>
          <span className="tag">two shoppers · traceable</span>
        </div>
        <nav className="seg" aria-label="mode">
          {(['replay', 'compare', 'edit'] as Mode[]).map((m) => (
            <button key={m} className={`seg-btn ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); if (m === 'edit') setPanel(null); }}>
              {m === 'replay' ? 'replay' : m === 'compare' ? 'humans vs ai' : 'edit planogram'}
            </button>
          ))}
        </nav>
        <div className="tools">
          <label className="select">
            <span>run</span>
            <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
              {runs.filter((r) => !isAgentArm(r)).map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id}{r.fixture ? ' (fixture)' : ''}</option>)}
            </select>
          </label>
          {runs.some(isAgentArm) && (
            <label className="select">
              <span>+ ai arm</span>
              <select value={aiRunId} onChange={(e) => setAiRunId(e.target.value)}>
                <option value="">none</option>
                {runs.filter(isAgentArm).map((r) => <option key={r.run_id} value={r.run_id}>{r.run_id}</option>)}
              </select>
            </label>
          )}
          <div className="seg small" aria-label="who">
            {(['both', 'human', 'ai'] as Arm[]).map((a) => <button key={a} className={`seg-btn ${arm === a ? 'on' : ''}`} onClick={() => setArm(a)}>{a === 'both' ? 'everyone' : a === 'human' ? 'humans' : 'ai agents'}</button>)}
          </div>
        </div>
      </header>

      {run?._fixture && <div className="fixture-banner" title={run._fixture}>fixture data: synthetic decisions to exercise the ui, not results</div>}

      {mode === 'replay' && (
        <div className="lefttools">
          <div className="card mini">
            <div className="mini-h">camera</div>
            <div className="seg small col">
              <button className={`seg-btn ${cam === 'overview' ? 'on' : ''}`} onClick={() => { setCam('overview'); setCamNonce((n) => n + 1); }}>overview</button>
              <button className={`seg-btn ${cam === 'walk' ? 'on' : ''}`} onClick={() => { setCam('walk'); setCamNonce((n) => n + 1); }}>walk (wasd)</button>
              <button className={`seg-btn ${cam === 'follow' ? 'on' : ''}`} disabled={!selAgent} onClick={() => setCam('follow')} title={selAgent ? '' : 'click a shopper first'}>follow shopper</button>
            </div>
            <div className="mini-h">thoughts</div>
            <div className="seg small">
              {(['all', 'selected', 'off'] as ThoughtMode[]).map((t) => <button key={t} className={`seg-btn ${thoughts === t ? 'on' : ''}`} onClick={() => setThoughts(t)}>{t}</button>)}
            </div>
            <div className="mini-h">shelf-edge heat</div>
            <div className="seg small">
              {(['off', 'pick', 'gap'] as Heat[]).map((h) => <button key={h} className={`seg-btn ${heat === h ? 'on' : ''}`} onClick={() => setHeat(h)}>{h === 'pick' ? 'pick rate' : h === 'gap' ? 'ai − human' : 'off'}</button>)}
            </div>
            {heat === 'gap' && <p className="legend-note"><i style={{ background: '#16a34a' }} /> humans pick more <i style={{ background: AI_COLOR }} /> agents pick more</p>}
          </div>
          {showLegend && (
            <div className="card mini legend">
              <div className="mini-h">who's shopping <button className="link-btn" onClick={() => setShowLegend(false)}>hide</button></div>
              {archetypesInRun.map((a) => <div key={a} className="leg"><span className="dot" style={{ background: archColor(a) }} />{a === 'ai' ? 'ai agent (reads the feed)' : archLabel(a)}</div>)}
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
      {side && mode !== 'edit' && <div className="side">{side}</div>}

      {mode !== 'edit' && (
        <footer className="replay card">
          <button className="btn btn-ink round" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'pause' : 'play'}>{playing ? '❚❚' : '▶'}</button>
          <input type="range" min={0} max={duration} step={0.1} value={uiTime} onChange={(e) => { timeRef.current = Number(e.target.value); setUiTime(timeRef.current); }} aria-label="replay time" />
          <span className="time">{fmt(uiTime)} / {fmt(duration)}</span>
          <div className="seg small">{SPEEDS.map((s) => <button key={s} className={`seg-btn ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          <div className="counts">
            <span title="picked so far">✅ {counts.pick ?? 0}</span>
            <span title="rejected so far">✖ {counts.reject ?? 0}</span>
            <span title="walked past so far">👀 {counts.walk_past ?? 0}</span>
          </div>
          {rerun.ok && rerun.msg && <span className="muted small">{rerun.msg}</span>}
        </footer>
      )}
      {!run && <div className="loading-run sticker">loading run…</div>}
    </div>
  );
}
