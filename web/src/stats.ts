import type { Agent, Arm, Persona, Run, SimEvent } from './types';
import { isAI } from './types';
import { isFailed, isSecondary, pickedUp } from './events';

/** Wilson score interval. source: Wilson (1927) JASA 22(158); standard binomial CI for small n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export const armFilter = (arm: Arm) => (a: Agent) => (arm === 'both' ? true : arm === 'ai' ? isAI(a) : !isAI(a));

export function archetypeOf(a: Agent, personas: Record<string, Persona>) {
  if (isAI(a)) return a.archetype && a.archetype !== 'ai_agent' ? a.archetype : 'ai_agent'; // AI agents group by archetype; the model is a detail (agent.model)
  return a.archetype ?? personas[a.persona_id]?.archetype ?? a.persona_id.replace(/^p_/, '');
}

export interface DecisionRef { agent: Agent; event: SimEvent }
export interface Computed {
  shown: number; noticed: number; considered: number; picked: number; rejected: number; walk_past: number;
  pick_rate: number; ci95: [number, number]; mean_sentiment: number;
  byArch: { key: string; shown: number; picked: number; rate: number }[];
  rejects: { mechanism: string; items: DecisionRef[] }[];
  decisions: DecisionRef[];
}

export function productStats(run: Run, code: string, arm: Arm, personas: Record<string, Persona>): Computed {
  const out: Computed = { shown: 0, noticed: 0, considered: 0, picked: 0, rejected: 0, walk_past: 0, pick_rate: 0, ci95: [0, 0], mean_sentiment: 0, byArch: [], rejects: [], decisions: [] };
  const arch: Record<string, { shown: number; picked: number }> = {};
  const rej: Record<string, DecisionRef[]> = {};
  let s = 0, ns = 0;
  for (const a of run.agents.filter(armFilter(arm))) {
    for (const e of a.events) {
      if (e.product !== code || isFailed(e)) continue;
      out.shown++;
      const k = archetypeOf(a, personas);
      arch[k] ??= { shown: 0, picked: 0 };
      arch[k].shown++;
      if (e.noticed) { out.noticed++; if (typeof e.sentiment === 'number') { s += e.sentiment; ns++; } }
      if (pickedUp(e)) out.considered++;
      if (e.decision === 'pick') { out.picked++; arch[k].picked++; }
      if (e.decision === 'reject' && pickedUp(e)) { out.rejected++; if (!isSecondary(e)) (rej[e.mechanism || 'unspecified'] ??= []).push({ agent: a, event: e }); }
      if (e.noticed && !pickedUp(e)) out.walk_past++;
      if (e.decision !== 'not_noticed') out.decisions.push({ agent: a, event: e });
    }
  }
  out.pick_rate = out.shown ? out.picked / out.shown : 0;
  out.ci95 = wilson(out.picked, out.shown);
  out.mean_sentiment = ns ? s / ns : 0;
  out.byArch = Object.entries(arch).map(([key, v]) => ({ key, ...v, rate: v.shown ? v.picked / v.shown : 0 })).sort((a, b) => b.rate - a.rate || b.shown - a.shown);
  out.rejects = Object.entries(rej).map(([mechanism, items]) => ({ mechanism, items })).sort((a, b) => b.items.length - a.items.length);
  return out;
}

/** quick per-product pick rate map for heat colouring & compare view */
export function pickRates(run: Run, arm: Arm) {
  const m: Record<string, { shown: number; picked: number; rate: number; ci: [number, number] }> = {};
  for (const a of run.agents.filter(armFilter(arm))) for (const e of a.events) {
    if (isFailed(e)) continue;
    const r = (m[e.product] ??= { shown: 0, picked: 0, rate: 0, ci: [0, 0] });
    r.shown++; if (e.decision === 'pick') r.picked++;
  }
  for (const r of Object.values(m)) { r.rate = r.shown ? r.picked / r.shown : 0; r.ci = wilson(r.picked, r.shown); }
  return m;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
