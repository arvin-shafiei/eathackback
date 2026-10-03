// Pure helpers for the live shopper panel: what a shopper is deciding, about to buy and has bought at replay time t.
// Rule zero (no black box): everything here is read straight from the recorded run events (sim/jev.py funnel fields,
// sim/agent_shopper.py feed picks, rule-based shoppers reasons). Nothing is generated or paraphrased.
import type { Agent, Persona, Product, SimEvent } from '../types';
import type { Seg, Timeline } from '../layout';

// ---- loose shapes of the jev payload on events (sim/jev.py) and agents (AI arm)
export interface JevChoice { probabilities?: Record<string, number>; options?: string[]; confidence?: number; argmax?: string; sampled?: string }
export interface JevFired { text?: string; p?: number; source?: string }
export interface JevEvent {
  decision?: JevChoice; self?: string;
  pick_up?: { p?: number; draw_u?: number; examined?: boolean };
  appeal?: { score?: number; level?: number; p_dislike_or_avoid?: number; probabilities?: number[]; confidence?: number };
  nouls?: Record<string, number>; nouls_fired?: Record<string, JevFired>;
  mechanism?: { choice?: string; confidence?: number; probabilities?: Record<string, number> };
  requests?: { calibrated?: boolean; backend?: string; routed_model?: string }[];
  calibrated?: boolean;
  // AI arm (feed choice)
  probabilities_by_position?: Record<string, number>; p_none?: number; confidence?: number;
  sampled_position?: number; argmax_position?: number; p_this_position?: number; jev_model?: string;
}
export type LiveEvent = SimEvent & {
  stage_reached?: string; p_pick_up?: number | null; picked_up?: boolean; engine?: string; jev_model?: string;
  position?: number; jev?: JevEvent; verbatim?: { quote?: string; url?: string } | null;
};
export type LiveAgent = Agent & { budget_gbp?: number; budget_left?: number; jev?: JevEvent; feed_len?: number; picked_position?: number; engine?: string };

/** sim/jev.py APPEAL_SHORT (index = appeal level 0..4) */
export const APPEAL_SHORT = ['would actively avoid', 'dislikes', 'indifferent', 'mildly drawn', 'really wants it'];

// ---- engine (per agent / per event)
export type AgentEngine = 'jev' | 'router' | 'mock' | 'llm' | 'unknown';
export function eventEngine(e: LiveEvent, agent?: LiveAgent): AgentEngine {
  const refs = (e.source_refs ?? []).join(' ');
  const model = e.jev_model ?? agent?.model ?? '';
  if (/rule-based shoppers/.test(refs) || e.reason?.startsWith('[mock]') || model === 'mock') return 'mock';
  const j = e.jev;
  if (/jev-router/.test(model) || j?.calibrated === false || j?.requests?.some((r) => r.calibrated === false)) return 'router';
  if (/^jev-/.test(model) || e.engine === 'jev') return 'jev';
  if (model) return 'llm';
  return 'unknown';
}
export function agentEngine(a: LiveAgent): AgentEngine {
  const evs = a.events as LiveEvent[];
  const decided = evs.filter((e) => e.noticed);
  const kinds = new Set((decided.length ? decided : evs).map((e) => eventEngine(e, a)));
  if (a.model === 'mock' || kinds.has('mock')) return 'mock';
  if (kinds.has('router') || /jev-router/.test(a.model ?? '')) return 'router';
  if (kinds.has('jev') || /^jev-/.test(a.model ?? '')) return 'jev';
  return kinds.has('llm') ? 'llm' : 'unknown';
}
export const ENGINE_TEXT: Record<AgentEngine, { text: string; css: string; title: string }> = {
  jev: { text: 'jev · calibrated', css: 'engine-jev', title: 'decided by TypeSafe Jev (System One): calibrated probabilities' },
  router: { text: 'jev-router · uncalibrated', css: 'engine-router', title: 'decided by the jev-router fallback (an LLM). probabilities are not calibrated' },
  mock: { text: '', css: 'engine-mock', title: '' },
  llm: { text: 'llm · uncalibrated', css: 'engine-llm', title: 'decided by an LLM. probabilities are not calibrated' },
  unknown: { text: 'engine not recorded', css: 'engine-unknown', title: 'this run does not say which engine decided' },
};

// ---- the timeline at t
export interface LiveState {
  /** replay time is known (time + timeline given) */
  live: boolean;
  where: 'not_in' | 'shopping' | 'tills' | 'cafe' | 'leaving' | 'gone';
  /** decision at the shelf now (dwell covers t), or the last one made */
  current: { e: LiveEvent; seg: Seg | null; now: boolean } | null;
  /** next planned pick after t */
  next: { e: LiveEvent; seg: Seg } | null;
  taken: { e: LiveEvent; seg: Seg | null }[];
  putBack: { e: LiveEvent; seg: Seg | null }[];
  /** events reached so far (for counts) */
  done: number; total: number;
}

const TILL_PHASES = new Set(['queue', 'unload', 'scan', 'bag', 'pay']);

export function liveState(agent: Agent, timeline?: Timeline, time?: number): LiveState {
  const evs = agent.events as LiveEvent[];
  const total = evs.length;
  if (!timeline || time === undefined || !timeline.segs.length) {
    // no replay clock: show the finished trip
    const last = [...evs].reverse().find((e) => e.noticed) ?? null;
    return {
      live: false, where: 'gone', current: last ? { e: last, seg: null, now: false } : null, next: null,
      taken: evs.filter((e) => e.decision === 'pick').map((e) => ({ e, seg: null })),
      putBack: evs.filter((e) => e.decision === 'reject').map((e) => ({ e, seg: null })),
      done: total, total,
    };
  }
  const t = time;
  const dwells = timeline.segs.filter((s) => s.kind === 'dwell' && s.event);
  let current: LiveState['current'] = null;
  let next: LiveState['next'] = null;
  const taken: LiveState['taken'] = [], putBack: LiveState['putBack'] = [];
  let done = 0;
  for (const s of dwells) {
    const e = s.event as LiveEvent;
    if (s.t0 <= t) {
      done++;
      const now = t < s.t1;
      if (e.noticed || now) current = { e, seg: s, now };
      if (!now) {
        if (e.decision === 'pick') taken.push({ e, seg: s });
        else if (e.decision === 'reject') putBack.push({ e, seg: s });
      }
    } else if (!next && e.decision === 'pick') next = { e, seg: s };
  }
  // a not-noticed event "now" is only interesting if nothing better was decided; keep the last noticed one instead
  if (current && !current.e.noticed && current.now) {
    const prev = [...dwells].reverse().find((s) => s.t0 <= t && s.event!.noticed);
    if (prev) current = { e: prev.event as LiveEvent, seg: prev, now: false };
  }
  let where: LiveState['where'] = 'shopping';
  if (t < timeline.start) where = 'not_in';
  else if (t >= timeline.end) where = 'gone';
  else {
    const seg = segAt(timeline, t);
    if (seg?.kind === 'phase' && seg.phase === 'cafe') where = 'cafe';
    else if (seg?.kind === 'phase' && seg.phase === 'exit') where = 'leaving';
    else if (seg?.kind === 'phase' && seg.phase && TILL_PHASES.has(seg.phase)) where = 'tills';
    else if (timeline.checkout && t >= timeline.checkout.tArrive) where = 'tills';
  }
  return { live: true, where, current, next, taken, putBack, done, total };
}

function segAt(tl: Timeline, t: number): Seg | null {
  let lo = 0, hi = tl.segs.length - 1;
  if (hi < 0) return null;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.segs[mid].t1 < t) lo = mid + 1; else hi = mid; }
  return tl.segs[lo] ?? null;
}

// ---- spending
export function basketTotal(items: { e: SimEvent }[], products: Record<string, Product>) {
  let sum = 0, priced = 0;
  for (const { e } of items) { const p = products[e.product]?.price_gbp; if (typeof p === 'number') { sum += p; priced++; } }
  return { sum, priced, n: items.length };
}

// ---- the jev numbers on one event, as display rows
export interface DistRow { key: string; label: string; p: number; code?: string; isSelf?: boolean; isSampled?: boolean }

/** the take distribution: options shown at that shelf moment → P(take). keys p0..pn index jev.decision.options; "none" = take none */
export function takeDistribution(e: LiveEvent, products: Record<string, Product>, name: (p: Product | undefined, code: string) => string): DistRow[] {
  const d = e.jev?.decision;
  if (!d?.probabilities) return [];
  const opts = d.options ?? [];
  return Object.entries(d.probabilities).map(([k, p]) => {
    if (k === 'none') return { key: k, label: 'none of them', p, isSampled: d.sampled === k };
    const i = Number(k.replace(/^p/, ''));
    const code = opts[i] ?? '';
    return { key: k, label: name(products[code], code || k), p, code, isSelf: e.jev?.self === k || code === e.product, isSampled: d.sampled === k };
  }).sort((a, b) => b.p - a.p);
}

/** AI arm: the agent's one Choice over the whole feed (position → P) mapped to products via the events' position field */
export function feedDistribution(agent: LiveAgent, e: LiveEvent | null, products: Record<string, Product>, name: (p: Product | undefined, code: string) => string, top = 6): { rows: DistRow[]; pNone?: number; confidence?: number; feedLen?: number } {
  const j = (e?.jev?.probabilities_by_position ? e.jev : agent.jev);
  const evs = agent.events as LiveEvent[];
  const feedLen = agent.feed_len ?? evs.length;
  if (!j?.probabilities_by_position) return { rows: [], feedLen };
  const byPos = new Map(evs.filter((x) => x.position != null).map((x) => [x.position!, x]));
  const rows = Object.entries(j.probabilities_by_position).map(([pos, p]) => {
    const ev = byPos.get(Number(pos));
    const code = ev?.product ?? '';
    return { key: pos, label: `#${pos} ${name(products[code], code || '?')}`, p, code, isSelf: e?.position === Number(pos), isSampled: j.sampled_position === Number(pos) };
  }).sort((a, b) => b.p - a.p);
  const shown = rows.slice(0, top);
  // always keep the chosen and the looked-at one visible
  for (const r of rows) if ((r.isSampled || r.isSelf) && !shown.includes(r)) shown.push(r);
  return { rows: shown, pNone: j.p_none, confidence: j.confidence, feedLen };
}

export interface TriggerRow { key: string; kind: 'put-off' | 'trust'; text: string; p: number; fired: boolean; source?: string }
const txt = (x: unknown, ...keys: string[]) => {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') for (const k of keys) { const v = (x as Record<string, unknown>)[k]; if (typeof v === 'string') return v; }
  return '';
};
/** jev.nouls: trigger_k = persona.rejection_triggers[k], trust_k = persona.trust_signals[k] (sim/jev.py) */
export function triggerRows(e: LiveEvent, persona?: Persona): TriggerRow[] {
  const n = e.jev?.nouls;
  if (!n) return [];
  const fired = e.jev?.nouls_fired ?? {};
  return Object.entries(n).map(([k, p]) => {
    const m = /^(trigger|trust)_(\d+)$/.exec(k);
    const kind = m?.[1] === 'trust' ? 'trust' as const : 'put-off' as const;
    const i = Number(m?.[2] ?? -1);
    const f = fired[k];
    const fromPersona = kind === 'trust' ? txt(persona?.trust_signals?.[i], 'signal', 'trust') : txt(persona?.rejection_triggers?.[i], 'trigger');
    return { key: k, kind, text: f?.text || fromPersona || k.replace(/_/g, ' '), p, fired: !!f, source: f?.source };
  }).sort((a, b) => Number(b.fired) - Number(a.fired) || b.p - a.p);
}

export const STAGE_TEXT: Record<string, string> = {
  not_noticed: "didn't notice it", looked: 'looked, left it on the shelf', taken: 'picked it up and kept it', put_back: 'picked it up, put it back',
};

export const pct = (p: number | null | undefined) => (typeof p === 'number' ? `${Math.round(p * 100)}%` : '–');
export const gbp = (n: number) => `£${n.toFixed(2)}`;

/** "U3-r2" → "unit U3 · eye level" (row names from store config when given) */
export function slotText(slot: string | undefined, rowNames?: Record<string, string>) {
  if (!slot) return '';
  if (slot.startsWith('feed:')) return `feed · ${slot.slice(5).replace(/_/g, ' ')}`;
  const m = /^(.+)-r(\d+)$/.exec(slot);
  if (!m) return slot;
  const rn = rowNames?.[m[2]] ?? rowNames?.[`r${m[2]}`];
  return `unit ${m[1]} · ${rn ? rn.replace(/_/g, ' ') : `shelf ${m[2]}`}`;
}
