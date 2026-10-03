// Shapes from /CONTRACT.md. Optional fields are tolerated so real pipeline output can be a bit sparse.

export interface Unit { id: string; aisle: number; side: 'L' | 'R'; category: string }
export interface StoreConfig {
  aisles: number;
  rows_per_unit: number;
  row_names: Record<string, string>;
  units: Unit[];
  entrance: { x: number; z: number };
  checkout: { x: number; z: number };
}

export interface SlotSet { category: string; products: string[]; facings: Record<string, number> }
export type Planogram = Record<string, SlotSet>;

export interface LensGrade { score: number; why: string[] }
export interface Product {
  code: string; name: string; brand: string; category: string;
  role: 'challenger' | 'incumbent' | 'own_label' | string;
  price_gbp: number; price_source?: string; pack_copy?: string;
  nova?: number | null; nutriscore?: string | null; ecoscore?: string | null;
  additives_n?: number; additives?: string[]; labels?: string[]; allergens?: string[];
  ingredients_n?: number; ingredients_text?: string;
  sugars_100g?: number; fiber_100g?: number; proteins_100g?: number; salt_100g?: number;
  sweeteners?: number; palm_oil_n?: number; recycling?: string[];
  image?: string; off_url?: string; color?: string; fixture?: boolean;
  lens_grades?: Record<string, LensGrade>;
  [k: string]: unknown;
}

export type Ocean = Partial<Record<'O' | 'C' | 'E' | 'A' | 'N', number>>;
export interface Sourced { source?: string }
export interface Persona {
  id: string; name: string; archetype: string; mission?: string; budget_gbp?: number; channel?: string;
  ocean: Ocean;
  ocean_effects?: ({ trait: string; effect: string; coef: number } & Sourced)[];
  lens?: ({ attribute: string; off_field?: string; direction: string; weight: number; why?: string } & Sourced)[];
  rejection_triggers?: ({ trigger: string } & Sourced)[];
  trust_signals?: unknown[]; habits?: unknown[];
  dossier?: string;
  verbatims?: { quote: string; url: string; subreddit?: string }[];
}

export type Decision = 'pick' | 'reject' | 'walk_past' | 'not_noticed';
export interface SimEvent {
  step: number; slot: string; product: string; p_notice: number;
  notice_factors?: Record<string, unknown>;
  noticed: boolean; decision: Decision; reason?: string;
  attributes_cited?: string[]; feeling?: string; sentiment?: number;
  mechanism?: string; source_refs?: string[];
}
export interface Agent {
  agent_id: string; persona_id: string; model?: string; ocean?: Ocean;
  path: string[]; events: SimEvent[];
}
export interface ProductStats {
  shown: number; noticed: number; considered: number; picked: number; rejected: number; walk_past: number;
  pick_rate: number; ci95: [number, number];
  by_archetype?: Record<string, unknown>; by_ocean_segment?: Record<string, unknown>;
  top_reject_reasons?: unknown[]; mean_sentiment?: number;
}
export interface Run {
  run_id: string; created?: string; planogram?: string; models?: string[];
  agents: Agent[];
  stats?: { per_product?: Record<string, ProductStats> };
  notice_model?: Record<string, unknown>;
  _fixture?: string;
}
export interface RunIndexEntry { run_id: string; file: string; created?: string; agents?: number; fixture?: boolean }

export type Arm = 'human' | 'ai' | 'both';
export const isAI = (a: Agent) => a.persona_id === 'ai_agent' || a.persona_id.startsWith('ai_');
