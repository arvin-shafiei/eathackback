// Rule zero (no black box): every run says which engine produced its decisions.
//   mock   → "mock engine: layout & traffic demo — not evidence"
//   jev    → "jev-1.13.0 · calibrated"
//   router → "jev-router (LLM, uncalibrated)" (models name the OpenRouter fallback, or any jev request has calibrated:false)
//   other LLM runs → their model names · uncalibrated
import type { Run } from '../types';
import './engine.css';

export type EngineKind = 'mock' | 'jev' | 'router' | 'llm' | 'unknown';
export interface EngineInfo { kind: EngineKind; text: string; title: string }

type Loose = Run & { engine?: unknown };
const anyUncalibrated = (run: Run) => {
  for (const a of run.agents) for (const e of a.events) {
    const j = (e as unknown as { jev?: { requests?: { calibrated?: boolean }[]; calibrated?: boolean }; calibrated?: boolean });
    if (j.calibrated === false || j.jev?.calibrated === false || j.jev?.requests?.some((r) => r.calibrated === false)) return true;
  }
  return false;
};

/** perf: App asks every render (~8x/s); a run object never changes, so cache per run */
const engineCache = new WeakMap<Run, EngineInfo | null>();
export function engineOf(run: Run | null | undefined): EngineInfo | null {
  if (!run) return null;
  if (engineCache.has(run)) return engineCache.get(run)!;
  const info = engineOfUncached(run); engineCache.set(run, info); return info;
}
function engineOfUncached(run: Run): EngineInfo | null {
  const r = run as Loose;
  const models = (run.models ?? []).map(String);
  const eng = typeof r.engine === 'string' ? r.engine : '';
  if (run.mock === true || eng === 'mock' || (models.length > 0 && models.every((m) => m === 'mock')))
    return { kind: 'mock', text: 'mock engine: layout & traffic demo — not evidence', title: 'decisions come from the rule-based mock engine (no model call). Use it to check the layout and shopper traffic only; its pick rates are not evidence.' };
  if (models.some((m) => /jev-router/.test(m)) || anyUncalibrated(run))
    return { kind: 'router', text: 'jev-router (LLM, uncalibrated)', title: 'decisions from the OpenRouter typesafe/jev-router fallback: an LLM, not the calibrated Jev System One model. Probabilities are not calibrated.' };
  const jev = models.find((m) => /^jev-/.test(m));
  if (jev || eng === 'jev')
    return { kind: 'jev', text: `${jev ?? 'jev-1.13.0'} · calibrated`, title: 'decisions from TypeSafe Jev (System One), which returns calibrated probabilities (see run.jev_legend).' };
  if (models.length) return { kind: 'llm', text: `${models.map((m) => m.split('/').pop()).join(', ')} · uncalibrated`, title: `decisions from LLM(s): ${models.join(', ')}. Not calibrated probabilities.` };
  return { kind: 'unknown', text: 'engine not recorded', title: 'this run file does not say which engine made its decisions' };
}

/** worst-case badge across the loaded runs (a mock arm makes the whole view mock) */
export function engineOfAll(...runs: (Run | null | undefined)[]): EngineInfo | null {
  const infos = runs.map(engineOf).filter((x): x is EngineInfo => !!x);
  const rank: EngineKind[] = ['mock', 'unknown', 'router', 'llm', 'jev'];
  return infos.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind))[0] ?? null;
}

export function EngineBadge({ info, className = '' }: { info: EngineInfo | null; className?: string }) {
  if (!info) return null;
  return <span className={`engine-badge engine-${info.kind} ${className}`} title={info.title} role="note">{info.kind === 'mock' ? '⚠ ' : ''}{info.text}</span>;
}
