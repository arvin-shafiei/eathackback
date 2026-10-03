import type { SimEvent } from './types';

export const isFailed = (e: SimEvent) => e.mechanism === 'error';
export const isSecondary = (e: SimEvent) => Boolean(e.secondary) || (e.reason ?? '').startsWith('(secondary');

/** Recorded funnel flags win. Older runs infer handling from the recorded stage or decision. */
export function pickedUp(e: SimEvent): boolean {
  if (typeof e.picked_up === 'boolean') return e.picked_up;
  if (e.stage_reached) return e.stage_reached === 'put_back' || e.stage_reached === 'taken';
  return e.noticed && (e.decision === 'pick' || e.decision === 'reject');
}
