// "Beats": every logged decision turned into an animation schedule on the replay clock.
// The decision, product and slot come straight from the run log; only the timing inside a dwell is choreography.
import type { Agent, Planogram, StoreConfig } from '../types';
import { isAI } from '../types';
import { BEAT, productWorld, type Timeline } from '../layout';

export type BeatKind = 'pick' | 'reject' | 'glance' | 'ignore';
export interface Beat {
  id: number; agentId: string; ai: boolean; kind: BeatKind;
  code: string; slot: string; step: number; reason: string;
  t0: number; t1: number; tGrab: number; tLaunch: number; tPutBack: number; tBack: number;
  shelf: { x: number; y: number; z: number; h: number; category: string } | null;
  /** nth pick of this agent (stack position in the carrier) */
  pickIdx: number;
}
/** replay seconds before a picked facing is restocked. assumption: visual only, so gaps are readable */
export const RESTOCK = 10;

export interface Beats { byAgent: Record<string, Beat[]>; all: Beat[]; gaps: Record<string, [number, number][]> }

export function buildBeats(cfg: StoreConfig, plan: Planogram, agents: Agent[], timelines: Record<string, Timeline>): Beats {
  const byAgent: Record<string, Beat[]> = {};
  const all: Beat[] = [];
  const gaps: Record<string, [number, number][]> = {};
  let id = 0;
  for (const a of agents) {
    const tl = timelines[a.agent_id]; if (!tl) continue;
    const ai = isAI(a);
    const list: Beat[] = [];
    let picks = 0;
    for (const s of tl.segs) {
      if (s.kind !== 'dwell' || !s.event) continue;
      const e = s.event;
      const kind: BeatKind = e.decision === 'pick' ? 'pick' : e.decision === 'reject' ? 'reject' : e.decision === 'walk_past' ? 'glance' : 'ignore';
      const D = s.t1 - s.t0;
      const pw = e.product ? productWorld(cfg, plan, e.slot, e.product) : null;
      const b: Beat = {
        id: id++, agentId: a.agent_id, ai, kind, code: e.product, slot: e.slot, step: e.step, reason: e.reason ?? '',
        t0: s.t0, t1: s.t1,
        tGrab: s.t0 + BEAT.grab * D, tLaunch: s.t0 + BEAT.launch * D, tPutBack: s.t0 + BEAT.putBack * D, tBack: s.t0 + BEAT.backOnShelf * D,
        shelf: pw ? { x: pw.x, y: pw.y, z: pw.z, h: pw.h, category: plan[pw.slot]?.category ?? pw.unit.category } : null,
        pickIdx: kind === 'pick' ? picks++ : -1,
      };
      list.push(b); all.push(b);
      // humans physically take the pack off the shelf; ai agents read the feed, so their pick is a hologram and leaves no gap
      if (!ai && e.product && kind === 'pick') (gaps[e.product] ??= []).push([b.tGrab, b.tGrab + RESTOCK]);
      if (!ai && e.product && kind === 'reject') (gaps[e.product] ??= []).push([b.tGrab, b.tBack]);
    }
    byAgent[a.agent_id] = list;
  }
  return { byAgent, all, gaps };
}
