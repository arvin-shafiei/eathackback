export const INK = '#141014';
export const BRAND_A = '#FF4079';
export const BRAND_B = '#FE831B';
export const MAGENTA = '#C2185B';

export const CATEGORY_COLOR: Record<string, string> = {
  soft_drinks: '#e8463c', crisps_savoury: '#f4b400', snack_bars: '#a0643a', breakfast_cereal: '#f08a24',
  yoghurt: '#7fb8e6', biscuits_chocolate: '#6b4430', plant_milk_dairy_alt: '#8fbf4a', ready_meals_soup: '#c0392b',
  bakery_bread: '#d9a05b', frozen_icecream: '#9ad7f5', hot_drinks: '#7a4b2a', confectionery_sweets: '#ff7ac8',
};
/** categories that live in a fridge/freezer: glass doors + cold glow in the 3D store */
export const CHILLED = new Set(['yoghurt', 'plant_milk_dairy_alt', 'ready_meals_soup', 'frozen_icecream']);
export const CAT_EMOJI: Record<string, string> = {
  soft_drinks: '🥤', crisps_savoury: '🥔', snack_bars: '🍫', breakfast_cereal: '🥣', yoghurt: '🥛', biscuits_chocolate: '🍪',
  plant_milk_dairy_alt: '🌱', ready_meals_soup: '🍲', bakery_bread: '🍞', frozen_icecream: '🍦', hot_drinks: '☕', confectionery_sweets: '🍬',
};
export const catColor = (c: string) => CATEGORY_COLOR[c] ?? '#b9a9b5';
export const catLabel = (c: string) => c.replace(/_/g, ' ');

const ARCH: Record<string, string> = {
  eco_low_chemical: '#2bb673', upf_avoider_parent: '#1f9e89', glp1_small_appetite: '#4cc9f0', frugal_unit_price: '#f7b801',
  protein_gym: '#ff6b35', protein_sceptic_gimmick_reactant: '#e63946', habit_loyalist_shrinkflation_angry: '#8d6e63',
  meal_deal_office: '#3a86ff', vegan_ethical: '#80b918', allergen_coeliac: '#f4a3c8', ai_delegator: '#9b5de5', novelty_seeker_tiktok: '#ff4ecd',
};
/** "brand name" without repeating the brand when the OFF name already starts with it */
export const prodLabel = (p: { brand?: string; name?: string } | undefined, fallback = '') => {
  if (!p) return fallback;
  const b = (p.brand ?? '').trim(), n = (p.name ?? '').trim();
  return b && n.toLowerCase().startsWith(b.toLowerCase()) ? n : `${b} ${n}`.trim();
};
export const AI_COLOR = '#6d28d9';
export function archColor(arch: string) {
  if (arch.startsWith('ai')) return AI_COLOR;
  if (ARCH[arch]) return ARCH[arch];
  let h = 0; for (const ch of arch) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 52%)`;
}
export const archLabel = (a: string) => a.replace(/_/g, ' ');

export const DECISION = {
  pick: { emoji: '✅', label: 'picked', color: '#16a34a' },
  reject: { emoji: '✖', label: 'rejected', color: '#e11d48' },
  walk_past: { emoji: '👀', label: 'walked past', color: '#f59e0b' },
  not_noticed: { emoji: '·', label: "didn't notice", color: '#9ca3af' },
} as const;

/** what each shopper carries. visual only: mission → carrier (assumption: big shops use trolleys, top-ups use baskets) */
export type Carrier = 'trolley' | 'basket' | 'none';
const TROLLEY_MISSIONS = /weekly|big|family|stock/;
const TROLLEY_ARCH = new Set(['upf_avoider_parent', 'habit_loyalist_shrinkflation_angry']);
export function carrierFor(arch: string, mission: string | undefined, ai: boolean): Carrier {
  if (ai || arch.startsWith('ai ·') || arch === 'ai_agent') return 'none';
  if (TROLLEY_ARCH.has(arch) || TROLLEY_MISSIONS.test(mission ?? '')) return 'trolley';
  return 'basket';
}
/** one emoji per archetype for the legend: mirrors the 3D accessory */
export const ARCH_GEAR: Record<string, string> = {
  eco_low_chemical: '🍃 leaf hat', upf_avoider_parent: '🔍 label magnifier', glp1_small_appetite: '🧢 beanie', frugal_unit_price: '🧮 calculator',
  protein_gym: '🏋️ headband + dumbbell', protein_sceptic_gimmick_reactant: '🤨 side-eye brows', habit_loyalist_shrinkflation_angry: '🧢 flat cap',
  meal_deal_office: '👔 tie + lanyard', vegan_ethical: '🌱 sprout', allergen_coeliac: '🏷️ gf badge', ai_delegator: '🎧 headphones', novelty_seeker_tiktok: '🤳 selfie stick',
};
