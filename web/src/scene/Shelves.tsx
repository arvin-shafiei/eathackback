// Product shelves. Kept as the entry point Scene already renders; the packing, atlas, LOD and stock API live in
// ShelfFill.tsx (takeFromShelf / restockShelf / facingWorld / resetShelves are re-exported here for convenience).
import type { MutableRefObject } from 'react';
import type { Planogram, Product, StoreConfig } from '../types';
import { ShelfFill } from './ShelfFill';

export { takeFromShelf, restockShelf, facingWorld, shelfStock, resetShelves, setShelfDriven, onShelfChange, packDims } from './ShelfFill';
export type { ShelfUnitPos } from './ShelfFill';

interface Props {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  gaps: Record<string, [number, number][]>; timeRef: MutableRefObject<number>; live: boolean;
  selectedProduct: string | null; onProduct: (code: string) => void; editMode: boolean; onSlot: (slot: string) => void;
  lodDistance?: number; decor?: boolean; highlightMoves?: boolean;
}

export function Shelves(p: Props) {
  return <ShelfFill {...p} />;
}
