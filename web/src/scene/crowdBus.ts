// Typed event stream out of the crowd: what shoppers physically did, on the replay clock.
// Presentation only (sounds, flashes, counters): never feeds a stat. Subscribe with onCrowd; returns unsubscribe.
// Events fire only on forward playback (not while scrubbing).

export type CrowdEvent =
  | { type: 'enter'; agentId: string; door: number; t: number }
  | { type: 'take'; agentId: string; slot: string; code: string; t: number }
  | { type: 'putback'; agentId: string; slot: string; code: string; t: number }
  | { type: 'drop'; agentId: string; code: string; t: number } // pack landed in the basket / trolley
  | { type: 'queue'; agentId: string; lane: string; pos: number; t: number }
  | { type: 'unload'; agentId: string; lane: string; code: string; t: number } // pack onto the belt / scanner
  | { type: 'scan'; agentId: string; lane: string; kind: 'staffed' | 'self'; code: string; t: number } // beep
  | { type: 'bag'; agentId: string; lane: string; t: number }
  | { type: 'pay'; agentId: string; lane: string; t: number }
  | { type: 'bonk'; a: string; b: string; x: number; z: number }
  /** café hand-off: the crowd walks the shopper to the café entrance and hides them until `tEnd`; Cafe.tsx animates
   *  the visit (counter, seat `seat`, sitting) using the shopper's look (`color`, `arch`). cafe_leave = back at the door */
  | { type: 'cafe_enter'; shopperId: string; agentId: string; t: number; tEnd: number; seat: number | null; x: number; z: number; color: string; arch: string }
  | { type: 'cafe_leave'; shopperId: string; agentId: string; t: number; x: number; z: number };

type Fn = (e: CrowdEvent) => void;
const subs = new Set<Fn>();

export function onCrowd(fn: Fn): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function emitCrowd(e: CrowdEvent): void {
  for (const f of subs) { try { f(e); } catch { /* a bad listener never breaks the crowd */ } }
}

/** live crowd health (updated ~10 Hz by the crowd): handy for HUDs and headless checks */
export const crowdStats = { active: 0, overlaps: 0, queued: 0, inCarriers: 0, flights: 0 };

if (typeof window !== 'undefined') (window as unknown as { __crowd?: unknown }).__crowd = { onCrowd, stats: crowdStats };
