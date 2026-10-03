import type { Agent, Persona, Planogram, Product, Run, SimEvent } from './types';
import { isAI } from './types';
import { archetypeOf, armFilter, pct, wilson, type DecisionRef } from './stats';

/** assumption: a step under one percentage point below the unit median counts as level with it */
export const MIN_GAP_PTS = 1;
/** assumption: below 30 shelf passes a pick rate's Wilson interval is too wide to act on */
export const MIN_HUMAN_SHOWN = 30;
/** breakdown rows with fewer shown events than this are greyed, not hidden */
export const LOW_N_ROW = 5;
/** assumption: a human vs ai pick-rate gap under 10 points is treated as agreement (same cut-off as ProductPanel) */
export const ARM_GAP = 0.1;

export type InsightArm = 'human' | 'ai';
export type Step = 'notice' | 'consider' | 'pick';
export const STEPS: Step[] = ['notice', 'consider', 'pick'];

type Ev = SimEvent & { secondary?: boolean };
/** a model call that failed is logged as a walk-past with mechanism "error"; it is not a shopper decision, so nothing counts it */
export const isFailed = (e: SimEvent) => e.mechanism === 'error';
export const isSecondary = (e: SimEvent) => Boolean((e as Ev).secondary) || (e.reason ?? '').startsWith('(secondary');

export const ratio = (k: number, n: number): number | null => (n > 0 ? k / n : null);
export const pts = (x: number) => Math.round(x * 100);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- shelf geometry

/** humans: the shelving unit ("U3-r2" -> "U3"). ai agents: the whole feed ("feed:<mission>"), which is their shelf. */
export const scopeOf = (slot: string) => (slot.startsWith('feed:') ? slot : slot.split('-r')[0]);
export const rowOf = (slot: string) => (slot.startsWith('feed:') ? '' : slot.split('-r')[1] ?? '');

export function slotOfProduct(planogram: Planogram, code: string): string | undefined {
  return Object.keys(planogram).find((s) => planogram[s].products.includes(code));
}
export function unitProducts(planogram: Planogram, slot: string | undefined): string[] {
  if (!slot) return [];
  const unit = scopeOf(slot);
  return [...new Set(Object.keys(planogram).filter((s) => scopeOf(s) === unit).flatMap((s) => planogram[s].products))];
}
export const slotProducts = (planogram: Planogram, slot: string | undefined) => (slot ? planogram[slot]?.products ?? [] : []);

export interface ShelfOption { code: string; slot: string; brand_supplied: boolean }
export function shelfOptions(planogram: Planogram, products: Record<string, Product>): ShelfOption[] {
  const seen = new Set<string>(), out: ShelfOption[] = [];
  for (const [slot, set] of Object.entries(planogram)) for (const code of set.products) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, slot, brand_supplied: Boolean(products[code]?.brand_supplied) });
  }
  return out.sort((a, b) => Number(b.brand_supplied) - Number(a.brand_supplied));
}

// ---- funnel

export interface Funnel {
  shown: number; noticed: number; considered: number; picked: number; rejected: number; walk_past: number;
  /** distinct agents behind the shown events */
  shoppers: number;
  pick_rate: number; ci95: [number, number];
  /** mean over events with a sentiment that are not secondary, as sim/run.py compute_stats does */
  mean_sentiment: number | null; sentiment_n: number;
}
export const EMPTY_FUNNEL: Funnel = { shown: 0, noticed: 0, considered: 0, picked: 0, rejected: 0, walk_past: 0, shoppers: 0, pick_rate: 0, ci95: [0, 0], mean_sentiment: null, sentiment_n: 0 };

/** one pass over the arm's events; never mixes shelf shoppers with feed agents */
export function funnels(run: Run, arm: InsightArm): Record<string, Funnel> {
  const out: Record<string, Funnel> = {}, sent: Record<string, number> = {};
  for (const a of run.agents.filter(armFilter(arm))) {
    const mine = new Set<string>();
    for (const e of a.events) {
      if (isFailed(e)) continue;
      const f = (out[e.product] ??= { ...EMPTY_FUNNEL, ci95: [0, 0] });
      f.shown++;
      mine.add(e.product);
      if (e.noticed) f.noticed++;
      if (e.decision === 'pick' || e.decision === 'reject') f.considered++;
      if (e.decision === 'pick') f.picked++;
      if (e.decision === 'reject') f.rejected++;
      if (e.decision === 'walk_past') f.walk_past++;
      if (typeof e.sentiment === 'number' && !isSecondary(e)) { sent[e.product] = (sent[e.product] ?? 0) + e.sentiment; f.sentiment_n++; }
    }
    for (const code of mine) out[code].shoppers++;
  }
  for (const [code, f] of Object.entries(out)) {
    f.pick_rate = ratio(f.picked, f.shown) ?? 0;
    f.ci95 = wilson(f.picked, f.shown);
    f.mean_sentiment = ratio(sent[code] ?? 0, f.sentiment_n);
  }
  return out;
}

export interface StepRate { step: Step; k: number; n: number; rate: number | null }
export function stepRates(f: Funnel): StepRate[] {
  return [
    { step: 'notice', k: f.noticed, n: f.shown, rate: ratio(f.noticed, f.shown) },
    { step: 'consider', k: f.considered, n: f.noticed, rate: ratio(f.considered, f.noticed) },
    { step: 'pick', k: f.picked, n: f.considered, rate: ratio(f.picked, f.considered) },
  ];
}

export interface SampleSize { human_shoppers: number; human_shown: number; ai_sessions: number; ai_shown: number; ai_loaded: boolean; thin: boolean }
export function sampleSize(run: Run, human: Funnel, ai: Funnel): SampleSize {
  return {
    human_shoppers: human.shoppers, human_shown: human.shown, ai_sessions: ai.shoppers, ai_shown: ai.shown,
    ai_loaded: run.agents.some(isAI), thin: human.shown < MIN_HUMAN_SHOWN,
  };
}

// ---- diagnosis

export interface StepGap extends StepRate {
  /** median of the same step over the other products in the unit that have a denominator */
  unit_median: number | null; peers: number;
  /** unit median minus this product, in percentage points; positive = this product is worse */
  gap_pts: number | null;
}
export interface ArmGap { human: Funnel; ai: Funnel; gap: number }
export interface Diagnosis {
  verdict: 'no_data' | 'no_peers' | 'at_or_above' | 'below';
  bottleneck: StepGap | null; gaps: StepGap[];
  top_reject: { mechanism: string; count: number } | null;
  arm_gap: ArmGap | null;
}

/**
 * Rule: for each human step conversion (notice = noticed/shown, consider = considered/noticed, pick = picked/considered)
 * take the median over the other products in the same unit; the step where this product sits furthest below that
 * median, in percentage points, is the bottleneck. No step below the median = at or above its neighbours.
 */
export function diagnose(run: Run, code: string, peerCodes: string[], human: Record<string, Funnel>, ai: Record<string, Funnel>): Diagnosis {
  const own = human[code] ?? EMPTY_FUNNEL, aiOwn = ai[code] ?? EMPTY_FUNNEL;
  const peers = peerCodes.filter((c) => c !== code && (human[c]?.shown ?? 0) > 0).map((c) => stepRates(human[c]));
  const gaps: StepGap[] = stepRates(own).map((s, i) => {
    const rates = peers.map((p) => p[i].rate).filter((r): r is number => r !== null);
    const med = median(rates);
    return { ...s, unit_median: med, peers: rates.length, gap_pts: s.rate === null || med === null ? null : (med - s.rate) * 100 };
  });
  const below = gaps.filter((g) => g.gap_pts !== null && g.gap_pts >= MIN_GAP_PTS).sort((a, b) => (b.gap_pts ?? 0) - (a.gap_pts ?? 0));
  const top = rejections(run, code, 'human').groups[0];
  const gap = aiOwn.pick_rate - own.pick_rate;
  return {
    verdict: own.shown === 0 ? 'no_data' : !peers.length ? 'no_peers' : below.length ? 'below' : 'at_or_above',
    bottleneck: own.shown > 0 && peers.length ? below[0] ?? null : null,
    gaps,
    top_reject: top ? { mechanism: top.mechanism, count: top.items.length } : null,
    arm_gap: own.shown > 0 && aiOwn.shown > 0 && Math.abs(gap) >= ARM_GAP ? { human: own, ai: aiOwn, gap } : null,
  };
}

const STEP_LEAD: Record<Step, string> = {
  notice: "most shoppers don't see it.",
  consider: 'shoppers see it, then move on.',
  pick: 'shoppers weigh it up, then put it back.',
};
const STEP_DID: Record<Step, string> = { notice: 'noticed it', consider: 'considered it', pick: 'bought it' };
const STEP_FIX: Record<Step, string> = {
  notice: 'try a better spot below',
  consider: 'work on the pack copy or claim',
  pick: 'look at price and ingredients',
};
export const mechLabel = (m: string) => m.replace(/_/g, ' ');

export function diagnosisText(d: Diagnosis): { main: string; arm: string | null } {
  let main: string;
  const b = d.bottleneck;
  if (d.verdict === 'no_data') main = 'no shopper passed this product in this run.';
  else if (d.verdict === 'no_peers') main = 'nothing else in its unit was passed, so there is no neighbour to compare it with.';
  else if (!b || b.rate === null || b.unit_median === null) {
    const bought = d.gaps.find((g) => g.step === 'pick');
    main = bought && bought.k === 0
      ? 'it gets noticed and considered as often as its neighbours, but nobody bought it in this run.'
      : 'it keeps up with its neighbours at every step: noticed, considered and bought.';
  }
  else {
    const rej = b.step === 'pick' && d.top_reject ? `. top reason: ${mechLabel(d.top_reject.mechanism)} (${d.top_reject.count})` : '';
    main = `${STEP_LEAD[b.step]} ${pct(b.rate)} ${STEP_DID[b.step]} (${b.k} of ${b.n}); the unit median is ${pct(b.unit_median)}. ${STEP_FIX[b.step]}${rej}.`;
  }
  const g = d.arm_gap;
  const arm = g
    ? `ai agents pick it ${g.gap < 0 ? 'less' : 'more'} than shoppers do: ${pct(g.ai.pick_rate)} (${g.ai.picked} of ${g.ai.shown}) against ${pct(g.human.pick_rate)} (${g.human.picked} of ${g.human.shown}).`
    : null;
  return { main, arm };
}

// ---- breakdowns

export type Dimension = 'archetype' | 'mission' | 'ocean' | 'model';
/** archetype, mission and ocean count human shoppers only; model counts ai agents only */
export const DIMENSION_ARM: Record<Dimension, InsightArm> = { archetype: 'human', mission: 'human', ocean: 'human', model: 'ai' };
export interface BreakdownRow { key: string; shown: number; picked: number; rate: number; ci95: [number, number]; thin: boolean }

const TRAITS = ['O', 'C', 'E', 'A', 'N'] as const;
function segmentKeys(a: Agent, dim: Dimension, personas: Record<string, Persona>): string[] {
  if (dim === 'archetype') return [archetypeOf(a, personas)];
  if (dim === 'mission') return [a.mission ?? personas[a.persona_id]?.mission ?? 'unknown'];
  if (dim === 'model') return [a.model ?? 'unknown'];
  return TRAITS.map((t) => `${t}_${(a.ocean?.[t] ?? 0.5) >= 0.5 ? 'high' : 'low'}`);
}

export function breakdown(run: Run, code: string, dim: Dimension, personas: Record<string, Persona>): BreakdownRow[] {
  const acc: Record<string, { shown: number; picked: number }> = {};
  for (const a of run.agents.filter(armFilter(DIMENSION_ARM[dim]))) {
    const keys = segmentKeys(a, dim, personas);
    for (const e of a.events) {
      if (e.product !== code || isFailed(e)) continue;
      for (const k of keys) {
        const r = (acc[k] ??= { shown: 0, picked: 0 });
        r.shown++;
        if (e.decision === 'pick') r.picked++;
      }
    }
  }
  return Object.entries(acc)
    .map(([key, v]) => ({ key, ...v, rate: ratio(v.picked, v.shown) ?? 0, ci95: wilson(v.picked, v.shown), thin: v.shown < LOW_N_ROW }))
    .sort((a, b) => b.rate - a.rate || b.shown - a.shown);
}

// ---- lost to

export interface LostTo {
  /** distinct agents who noticed the product and never picked it */
  denominator: number;
  /** of those, how many picked nothing else in the same unit (humans) or feed (ai) */
  none: number;
  rows: { code: string; count: number; share: number }[];
}
export function lostTo(run: Run, code: string, arm: InsightArm): LostTo {
  const counts: Record<string, number> = {};
  let denominator = 0, none = 0;
  for (const a of run.agents.filter(armFilter(arm))) {
    const mine = a.events.filter((e) => e.product === code && !isFailed(e));
    const seen = mine.filter((e) => e.noticed);
    if (!seen.length || mine.some((e) => e.decision === 'pick')) continue;
    denominator++;
    const scopes = new Set(seen.map((e) => scopeOf(e.slot)));
    const rivals = new Set(a.events.filter((e) => e.decision === 'pick' && e.product !== code && scopes.has(scopeOf(e.slot))).map((e) => e.product));
    if (!rivals.size) none++;
    for (const r of rivals) counts[r] = (counts[r] ?? 0) + 1;
  }
  const rows = Object.entries(counts).map(([c, count]) => ({ code: c, count, share: ratio(count, denominator) ?? 0 })).sort((a, b) => b.count - a.count);
  return { denominator, none, rows };
}

// ---- rejections

export interface Rejections {
  /** rejections with the shopper's own reason */
  total: number;
  /** rejections logged only because attention went to another product; left out of the groups */
  secondary: number;
  groups: { mechanism: string; items: DecisionRef[] }[];
}
export function rejections(run: Run, code: string, arm: InsightArm): Rejections {
  const by: Record<string, DecisionRef[]> = {};
  let total = 0, secondary = 0;
  for (const a of run.agents.filter(armFilter(arm))) for (const e of a.events) {
    if (isFailed(e)) continue;
    if (e.product !== code || e.decision !== 'reject') continue;
    if (isSecondary(e)) { secondary++; continue; }
    total++;
    (by[e.mechanism || 'unspecified'] ??= []).push({ agent: a, event: e });
  }
  const groups = Object.entries(by).map(([mechanism, items]) => ({ mechanism, items })).sort((a, b) => b.items.length - a.items.length);
  return { total, secondary, groups };
}

// ---- behaviour log: what each human shopper did at this product, straight from the run's events

export type Outcome = 'pick' | 'reject' | 'walk_past' | 'not_noticed';
export interface BehaviourRow {
  agent_id: string; persona_id: string; archetype: string; mission: string; slot: string;
  /** seconds this shopper gives a shelf: the persona's sim_parameters.seconds_at_shelf, an input to the notice model */
  seconds_at_shelf: number | null;
  p_notice: number; noticed: boolean;
  /** jev runs only: the shopper took it off the shelf, and turned it over */
  picked_up: boolean | null; back_of_pack: boolean | null;
  decision: Outcome; mechanism: string; feeling: string; sentiment: number | null; reason: string;
}
export interface BehaviourGroup { key: string; shown: number; noticed: number; picked_up: number; picked: number; mean_seconds: number | null; mean_sentiment: number | null }
export interface Behaviour {
  rows: BehaviourRow[];
  /** every human shopper in the run, whether or not they passed this shelf */
  store_shoppers: number;
  buys_per_100_visits: number | null; buys_per_100_passes: number | null;
  /** mean seconds at shelf by what the shopper did */
  seconds: Record<Outcome, { mean: number | null; n: number }>;
  picked_up: { k: number; n: number } | null;
  back_of_pack: { k: number; n: number } | null;
  by_archetype: BehaviourGroup[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function behaviour(run: Run, code: string, personas: Record<string, Persona>): Behaviour {
  const humans = run.agents.filter(armFilter('human'));
  const rows: BehaviourRow[] = [];
  for (const a of humans) for (const e of a.events) {
    if (e.product !== code || isFailed(e)) continue;
    const x = e as SimEvent & { picked_up?: unknown; back_of_pack_seen?: unknown };
    const secs = (e.notice_factors as Record<string, unknown> | undefined)?.seconds_at_shelf;
    rows.push({
      agent_id: a.agent_id, persona_id: a.persona_id, archetype: archetypeOf(a, personas), mission: a.mission ?? '', slot: e.slot,
      seconds_at_shelf: typeof secs === 'number' ? secs : null, p_notice: e.p_notice, noticed: e.noticed,
      picked_up: typeof x.picked_up === 'boolean' ? x.picked_up : null,
      back_of_pack: typeof x.back_of_pack_seen === 'boolean' ? x.back_of_pack_seen : null,
      decision: e.decision, mechanism: e.mechanism ?? '', feeling: e.feeling ?? '',
      sentiment: typeof e.sentiment === 'number' && !isSecondary(e) ? e.sentiment : null, reason: e.reason ?? '',
    });
  }
  const picked = rows.filter((r) => r.decision === 'pick').length;
  const noticed = rows.filter((r) => r.noticed);
  const flag = (k: 'picked_up' | 'back_of_pack') => {
    const known = noticed.filter((r) => r[k] !== null);
    return known.length ? { k: known.filter((r) => r[k]).length, n: known.length } : null;
  };
  const secsOf = (o: Outcome) => { const xs = rows.filter((r) => r.decision === o && r.seconds_at_shelf !== null).map((r) => r.seconds_at_shelf as number); return { mean: mean(xs), n: xs.length }; };
  const groups: Record<string, BehaviourRow[]> = {};
  for (const r of rows) (groups[r.archetype] ??= []).push(r);
  return {
    rows, store_shoppers: humans.length,
    buys_per_100_visits: humans.length ? (picked / humans.length) * 100 : null,
    buys_per_100_passes: rows.length ? (picked / rows.length) * 100 : null,
    seconds: { pick: secsOf('pick'), reject: secsOf('reject'), walk_past: secsOf('walk_past'), not_noticed: secsOf('not_noticed') },
    picked_up: flag('picked_up'), back_of_pack: flag('back_of_pack'),
    by_archetype: Object.entries(groups).map(([key, g]) => ({
      key, shown: g.length, noticed: g.filter((r) => r.noticed).length, picked_up: g.filter((r) => r.picked_up).length,
      picked: g.filter((r) => r.decision === 'pick').length,
      mean_seconds: mean(g.filter((r) => r.seconds_at_shelf !== null).map((r) => r.seconds_at_shelf as number)),
      mean_sentiment: mean(g.filter((r) => r.sentiment !== null).map((r) => r.sentiment as number)),
    })).sort((a, b) => b.shown - a.shown),
  };
}

const CSV_COLS: (keyof BehaviourRow)[] = ['agent_id', 'persona_id', 'archetype', 'mission', 'slot', 'seconds_at_shelf', 'p_notice', 'noticed', 'picked_up', 'back_of_pack', 'decision', 'mechanism', 'feeling', 'sentiment', 'reason'];
export function behaviourCsv(rows: BehaviourRow[]): string {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((c) => cell(r[c])).join(','))].join('\n');
}
