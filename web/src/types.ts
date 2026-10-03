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
  /** typed in by a brand (sim/uploads.py), not checked against Open Food Facts */
  brand_supplied?: boolean; source?: string;
  lens_grades?: Record<string, LensGrade>;
  [k: string]: unknown;
}

export type Ocean = Partial<Record<'O' | 'C' | 'E' | 'A' | 'N', number>>;
export interface Sourced { source?: string }
export interface Persona {
  id: string; name: string; archetype: string; mission?: string; budget_gbp?: number; channel?: string;
  /** AI-agent archetypes: kind "ai_agent", display label, why OCEAN is empty, the brief the agent is given */
  kind?: string; label?: string; ocean_note?: string; agent_brief?: string; acts_for?: string;
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
  attributes_cited?: string[]; feeling?: string; sentiment?: number | null;
  mechanism?: string; source_refs?: string[];
  stage_reached?: 'not_noticed' | 'looked' | 'put_back' | 'taken';
  picked_up?: boolean; back_of_pack_seen?: boolean; secondary?: boolean;
}
export interface Agent {
  agent_id: string; persona_id: string; archetype?: string; mission?: string; model?: string; ocean?: Ocean;
  /** "ai_agent" for AI shoppers; archetype_label = display name; prompt_state = what the deciding model saw before the feed */
  kind?: string; archetype_label?: string; prompt_state?: string; purchase_history?: string[]; mission_text?: string;
  path: string[]; events: SimEvent[];
}
export interface ProductStats {
  shown: number; noticed: number; considered: number; picked: number; rejected: number; walk_past: number;
  pick_rate: number; ci95: [number, number];
  by_archetype?: Record<string, unknown>; by_ocean_segment?: Record<string, unknown>;
  top_reject_reasons?: unknown[]; mean_sentiment?: number;
}
export interface Run {
  run_id: string; created?: string; planogram?: string; models?: string[]; seed?: number;
  agents: Agent[];
  stats?: { per_product?: Record<string, ProductStats> };
  notice_model?: Record<string, unknown>;
  planogram_inline?: Planogram;
  /** brand-supplied products this run was simulated with */
  catalog_inline?: Product[];
  excluded?: string[];
  arm?: string; label?: string; mock?: boolean;
  cost?: { usd?: number; llm_calls?: number; cached?: number; errors?: number };
  _fixture?: string;
}
export interface RunIndexEntry { run_id: string; file: string; created?: string; agents?: number; ai_agents?: number; fixture?: boolean }

export type Arm = 'human' | 'ai' | 'both';
/** AI-agent archetype persona ids (data/personas/lens/ai_*.json with kind "ai_agent"). p_ai_delegator is a HUMAN who uses ChatGPT. */
export const AI_PERSONA_IDS = new Set(['p_ai_assistant_general', 'p_ai_retailer_assistant', 'p_ai_price_bot']);
export const isAI = (a: Agent) => a.kind === 'ai_agent' || a.persona_id === 'ai_agent' || AI_PERSONA_IDS.has(a.persona_id) || a.persona_id.startsWith('ai_');

// ---- sim server responses (sim/optimise.py, sim/placement.py)
export interface OptimiseResult {
  edit: string; skipped?: boolean; why?: string; what_changed?: string;
  pick_base?: number; pick_new?: number; delta_pick?: number; delta_ci95?: [number, number];
  n_base?: number; n_new?: number; cost_usd?: number; significant?: boolean;
}
export interface OptimiseResponse {
  product: string; name?: string; agents: number; seeds: number[]; models: string[]; method: string;
  true_claims_available: { claim: string; why: string; source: string }[];
  results: OptimiseResult[];
}
export interface Placement { slot: string; pos: number; facings: number }
export interface PlacementCandidate extends Placement {
  row: number; row_name: string;
  /** product currently at that slot+pos, which would swap places with ours; null if it is our own position */
  displaces: string | null;
  /** mean p_notice over the shoppers who pass the unit */
  notice_rate: number;
  /** share of all shoppers who pass the unit at all */
  reach: number;
  lift_vs_current: number; is_current?: boolean;
}
export interface PlacementScan {
  product: string; unit: string; category: string; n_agents: number; seed: number;
  current: PlacementCandidate; candidates: PlacementCandidate[];
  method: string; sources: string[];
}
export interface PlacementResult {
  placement: Placement; what_changed: string;
  pick_base: number; pick_new: number; delta_pick: number; delta_ci95: [number, number];
  notice_base: number; notice_new: number; n_base: number; n_new: number;
  significant: boolean; cost_usd?: number;
  /** the full planogram with this placement applied, ready to re-run */
  planogram: Planogram;
}
export interface PlacementExperiment {
  product: string; agents: number; seeds: number[]; models: string[]; mock: boolean; method: string;
  baseline: { pick_rate: number; notice_rate: number; n: number; run_ids: string[] };
  results: PlacementResult[];
}

// ---- sim/rearrange.py
export interface SpotRef { slot: string; row: number; row_name: string; pos: number }
export interface RearrangeMove {
  code: string; name: string; brand: string; brand_supplied: boolean;
  from: SpotRef; to: SpotRef;
  /** chance a shopper passing the unit notices it, before and after */
  notice_before: number; notice_after: number;
  /** share of shoppers who bought it once they noticed it, blended with the unit average when thin */
  conversion: number; noticed: number; picked: number; thin: boolean;
  why: string;
}
export interface RearrangeUnit {
  unit: string; category: string;
  /** share of all shoppers who pass this unit */
  reach: number; products: number; unit_conversion: number; noticed: number; picked: number;
  before: number; after: number; lift: number; lift_pct: number; value_unit: string;
  swaps: number; moves: RearrangeMove[];
}
export interface RearrangePlan {
  objective: 'picks' | 'revenue'; max_swaps: number | null;
  units: RearrangeUnit[]; planogram: Planogram; moves: number;
  /** units no shopper noticed anything in during the runs learned from: left alone */
  no_data_units?: { unit: string; category: string }[];
  total: { before: number; after: number; lift: number; lift_pct: number; value_unit: string };
  learned_from: { runs: string[]; missing: string[]; shoppers: number; engines: string[]; other_store?: boolean };
  units_total?: number;
  method: string; assumptions: string[]; sources: string[];
}
export interface RearrangeDiff {
  picks_before: number; picks_after: number; shown_before: number; shown_after: number;
  rate_before: number; rate_after: number; noticed_before: number; noticed_after: number;
  delta_rate: number; delta_ci95: [number, number]; significant: boolean;
}
export interface RearrangeCheck {
  engine: string; mock: boolean; agents: number; seeds: number[]; shoppers: number; cost_usd: number;
  store: RearrangeDiff; units: (RearrangeDiff & { unit: string })[]; method: string;
}
