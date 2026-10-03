import type { Persona, Planogram, Product, Run, StoreConfig } from '../types';

/** shared by the three brand-upload panels so App.tsx and the panels agree on one shape */
export interface AddProductProps {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  useLLM: boolean; onUseLLM: (v: boolean) => void;
  busy: boolean; msg: string | null;
  /** product is the brand's new product; it takes the place of `replaces` in `slot` */
  onSubmit: (product: Product, slot: string, replaces: string) => void;
  onClose: () => void;
}

export interface PlacementSectionProps {
  product: Product; slot?: string; planogram: Planogram; cfg: StoreConfig; products: Record<string, Product>;
  /** brand-supplied products the current run was simulated with; send them with every api call */
  extraProducts: Product[];
  useLLM: boolean; busy: boolean;
  /** re-run the whole store on this planogram and load the result */
  onApplyPlanogram: (plan: Planogram, label: string) => void;
}

export interface InsightsProps extends PlacementSectionProps {
  run: Run; personas: Record<string, Persona>;
  onUseLLM: (v: boolean) => void;
  onPickProduct: (code: string) => void;
  onTrace: (agentId: string, step: number) => void;
  onClose: () => void;
}
