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
  /** Original human run ID for server-side learning; the displayed run may include an AI feed arm. */
  sourceRun: Run;
  onUseLLM: (v: boolean) => void;
  onPickProduct: (code: string) => void;
  onTrace: (agentId: string, step: number) => void;
  /** open the shelf rearrangement for this product's unit */
  onRearrange?: () => void;
  onClose: () => void;
}

export interface RearrangeProps {
  /** the shopper run to learn from (not the merged human + ai view): its run_id must exist on the sim server */
  run: Run; planogram: Planogram; cfg: StoreConfig; products: Record<string, Product>;
  extraProducts: Product[];
  /** product the user came from; its unit is shown first and its move is highlighted */
  focus?: string;
  useLLM: boolean; onUseLLM: (v: boolean) => void; busy: boolean;
  /** show a proposed layout on the 3d shelves without running anything; null puts the real one back */
  onPreview: (plan: Planogram | null) => void;
  onApplyPlanogram: (plan: Planogram, label: string) => void;
  onPickProduct: (code: string) => void;
  onClose: () => void;
}

export interface SelectOption { value: string; label: string; hint?: string; group?: string; disabled?: boolean }
export interface SelectProps {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
  /** accessible name; also shown before the value when `prefix` is set */
  ariaLabel: string;
  /** small bold word inside the button before the value, e.g. "run" */
  prefix?: string;
  placeholder?: string;
  /** show a filter box above the list (use for long lists) */
  searchable?: boolean;
  /** forwarded to the button, so a <label htmlFor> and field error wiring keep working */
  id?: string; invalid?: boolean; describedBy?: string;
  className?: string;
}
