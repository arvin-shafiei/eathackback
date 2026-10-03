import type { Planogram, RearrangeMove, RearrangePlan, RearrangeUnit } from './types';

export const MAX_SWAPS = 2;
export const MAX_STEPS = 3;
const spotKey = (s: { slot: string; pos: number }) => `${s.slot}#${s.pos}`;

/** Order a single closed loop as the numbered manual moves used by the 3D screen. */
export function orderSteps(moves: RearrangeMove[]): RearrangeMove[] | null {
  if (!moves.length) return null;
  const byFrom = new Map(moves.map((m) => [spotKey(m.from), m]));
  const seq = [moves[0]];
  for (let m = byFrom.get(spotKey(moves[0].to)); m && m !== moves[0]; m = byFrom.get(spotKey(m.to))) {
    if (seq.length > moves.length) return null;
    seq.push(m);
  }
  if (spotKey(seq[seq.length - 1].to) !== spotKey(moves[0].from)) return null;
  return [...seq.slice(1).reverse(), seq[0]];
}

export function applySteps(before: Planogram, steps: RearrangeMove[]): Planogram {
  const out = { ...before };
  const touch = (slot: string) => (out[slot] = { ...out[slot], products: [...out[slot].products], facings: { ...out[slot].facings } });
  const facings = new Map(steps.map((m) => [m.code, before[m.from.slot]?.facings?.[m.code] ?? 1]));
  for (const m of steps) if (out[m.from.slot] === before[m.from.slot]) touch(m.from.slot);
  for (const m of steps) if (out[m.to.slot] === before[m.to.slot]) touch(m.to.slot);
  for (const m of steps) delete out[m.from.slot].facings[m.code];
  for (const m of steps) { out[m.to.slot].products[m.to.pos] = m.code; out[m.to.slot].facings[m.code] = facings.get(m.code) ?? 1; }
  return out;
}

/** Prefer a single loop of at most three products; fall back to the one-swap plan. */
export function shelfSuggestions(one: RearrangePlan | null, two: RearrangePlan | null): { u: RearrangeUnit; steps: RearrangeMove[] }[] {
  if (!two) return [];
  const byOne = new Map((one?.units ?? []).map((u) => [u.unit, u]));
  const out: { u: RearrangeUnit; steps: RearrangeMove[] }[] = [];
  for (const u of two.units) {
    const loop = orderSteps(u.moves);
    if (loop && loop.length === u.moves.length && loop.length <= MAX_STEPS) { out.push({ u, steps: loop }); continue; }
    const fallback = byOne.get(u.unit), simple = fallback && orderSteps(fallback.moves);
    if (fallback && simple && simple.length === fallback.moves.length) out.push({ u: fallback, steps: simple });
  }
  return out.sort((a, b) => b.u.lift_pct - a.u.lift_pct);
}
