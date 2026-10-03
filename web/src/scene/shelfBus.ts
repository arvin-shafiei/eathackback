// Shelf <-> crowd contract. The crowd calls takeFromShelf when a hand closes on a pack and restockShelf when a
// rejected pack goes back. The shelf renderer (ShelfFill) registers the real implementation with registerShelf
// and may re-export these two functions. Until one registers, both are harmless no-ops (take returns null and the
// crowd falls back to the beat's slot position).
import type * as THREE from 'three';

export interface ShelfImpl {
  /** hide one facing of `code` in `slot`; returns the world centre of the facing that was taken, or null if none left */
  take(slot: string, code: string): THREE.Vector3 | null;
  /** put n packs of `code` back into `slot` */
  restock(slot: string, code: string, n: number): void;
}

let impl: ShelfImpl | null = null;

/** register the shelf renderer; returns an unregister function (call it on unmount) */
export function registerShelf(i: ShelfImpl): () => void {
  impl = i;
  return () => { if (impl === i) impl = null; };
}

export function takeFromShelf(slot: string, code: string): THREE.Vector3 | null {
  try { return impl ? impl.take(slot, code) : null; } catch { return null; }
}

export function restockShelf(slot: string, code: string, n: number): void {
  try { impl?.restock(slot, code, n); } catch { /* shelf renderer gone */ }
}
