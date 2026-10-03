// Store geometry derived entirely from store.config.json. The floor plan follows a UK superstore (Tesco Extra style):
//
//            back wall (z = zMin): goods-in · chilled multidecks: meat · fish · deli · dairy · cheese …   ┐ stockroom
//   left     ┌──────────── back block of numbered aisles (household, health & beauty …) ─────────────┐   right wall:
//   wall:    │                         middle cross aisle (promo end caps)                           │   bakery
//   ready    └──── front block (food cupboard → snacks → drinks → frozen → beer, wine & spirits) ────┘   produce
//   meals,      front cross aisle (end caps)                                                            food to go
//   desserts  café │ staffed tills ═══ self-checkout pods │ corridor │ fruit & veg + flowers
//            front wall (z = zMax): exits + EAS gates, entrance into produce
//
// Units: metres. +z is the street side. Everything (departments, walls, aisles, lanes, café, stockroom) is laid out
// from the units in the config, so any number of aisles / units / rows works. Department info is optional: configs
// without it (standard, xl) get departments derived from unit categories.
// Gondola aisles: a walkway lined by two gondola faces; unit side 'L' = the face on the walkway's -x side.
import type { StoreConfig, Planogram, Unit, Agent, SimEvent } from './types';

export const G = {
  spacing: 7.0, // gondola centre-to-centre (assumption: visual only, widened 3 Oct so crowds spread: ~6m walkway + 1m gondola)
  depth: 1.0, // gondola depth, both sides
  height: 2.1,
  unitLen: 6.4, // one bay of shelving along the aisle
  z0: 6.8, // legacy: front end of every gondola in the old grid (kept for callers that read it)
  standOff: 1.3, // how far in front of the shelf face a shopper stands
  walkSpeed: 1.3, // m/s. assumption: typical in-store walking speed is slower than the ~1.4 m/s street pace
  aiWalkSpeed: 2.2, // m/s. assumption: visual only. ai agents read a feed, so their "walk" is just a way to show which slot they read
  crossGap: 3.6, // cross-aisle distance from the gondola ends (room for end caps + trolleys)
  endcapDepth: 0.7,
  wallDepth: 1.0, // wall multideck / bakery rack / produce rack depth
  wallWalk: 5.2, // walkway in front of wall fixtures (assumption: visual, two trolleys pass)
  midAisle: 5.6, // middle cross aisle between the back and front block (between end caps)
};

/** dwell (replay seconds) per decision. visual pacing only, never feeds a stat. */
export const DWELL = { pick: 2.4, reject: 2.8, walk_past: 1.1, not_noticed: 0.3, ai_walk_past: 0.45, ai_pick: 1.6 } as const;
/** within a dwell, as fractions: when the hand grabs the product, when a pick is thrown, when a reject goes back */
export const BEAT = { grab: 0.28, launch: 0.46, putBack: 0.66, backOnShelf: 0.84 } as const;
/** checkout choreography (replay seconds, visual pacing only: the ops engine owns the real service times) */
export const TILL = { unloadPer: 0.32, scanPer: 0.55, selfScanPer: 0.8, bag: 1.1, pay: 1.4, selfMaxItems: 6 } as const;

// ---------------------------------------------------------------- departments
export type Fixture = 'gondola' | 'freezer' | 'multideck' | 'produce' | 'bakery';
export interface DeptDef {
  id: string; name: string; sign: string; emoji: string; color: string; fixture: Fixture;
  /** route rank: lower = earlier in the UK racetrack (entrance → produce → bakery → chilled → aisles → frozen → bws) */
  rank: number;
}
/** built-in UK superstore departments. assumption: visual grouping + floor tint only, no stat depends on it */
export const DEPARTMENTS: DeptDef[] = [
  { id: 'food_to_go', name: 'food to go', sign: 'food to go', emoji: '🥪', color: '#ffe9a8', fixture: 'multideck', rank: 0 },
  { id: 'flowers', name: 'flowers & plants', sign: 'flowers', emoji: '💐', color: '#ffd9ec', fixture: 'produce', rank: 0.5 },
  { id: 'produce', name: 'fresh fruit & veg', sign: 'fruit & veg', emoji: '🥦', color: '#cdeec2', fixture: 'produce', rank: 1 },
  { id: 'bakery', name: 'bakery', sign: 'bakery', emoji: '🥖', color: '#f6dcb4', fixture: 'bakery', rank: 2 },
  { id: 'meat', name: 'meat & poultry', sign: 'meat & poultry', emoji: '🥩', color: '#ffd3d3', fixture: 'multideck', rank: 3 },
  { id: 'fish', name: 'fish', sign: 'fish', emoji: '🐟', color: '#cfe4ff', fixture: 'multideck', rank: 4 },
  { id: 'deli', name: 'cooked meats & deli', sign: 'deli', emoji: '🍖', color: '#ffdcc8', fixture: 'multideck', rank: 5 },
  { id: 'dairy', name: 'milk, butter & eggs', sign: 'dairy & eggs', emoji: '🥛', color: '#ddefff', fixture: 'multideck', rank: 6 },
  { id: 'cheese', name: 'cheese', sign: 'cheese', emoji: '🧀', color: '#fff0b3', fixture: 'multideck', rank: 7 },
  { id: 'meat_free', name: 'meat free', sign: 'meat free', emoji: '🌱', color: '#d8f5d0', fixture: 'multideck', rank: 8 },
  { id: 'ready_meals', name: 'ready meals & pizza', sign: 'ready meals', emoji: '🍲', color: '#ffd6e0', fixture: 'multideck', rank: 9 },
  { id: 'desserts', name: 'chilled desserts', sign: 'desserts', emoji: '🍮', color: '#efd9ff', fixture: 'multideck', rank: 10 },
  { id: 'chilled', name: 'chilled', sign: 'chilled', emoji: '❄️', color: '#dbf3ff', fixture: 'multideck', rank: 11 },
  { id: 'free_from', name: 'free from', sign: 'free from', emoji: '🌾', color: '#eef6d8', fixture: 'gondola', rank: 19 },
  { id: 'grocery', name: 'food cupboard', sign: 'food cupboard', emoji: '🥫', color: '#f6eee6', fixture: 'gondola', rank: 20 },
  { id: 'snacks', name: 'snacks & treats', sign: 'snacks & treats', emoji: '🍪', color: '#fde6d2', fixture: 'gondola', rank: 21 },
  { id: 'drinks', name: 'drinks', sign: 'drinks', emoji: '🥤', color: '#ffe0da', fixture: 'gondola', rank: 22 },
  { id: 'frozen', name: 'frozen', sign: 'frozen', emoji: '🧊', color: '#d4f1ff', fixture: 'freezer', rank: 30 },
  { id: 'bws', name: 'beer, wine & spirits', sign: 'beer, wine & spirits', emoji: '🍷', color: '#f3d2e1', fixture: 'gondola', rank: 31 },
  { id: 'household', name: 'household', sign: 'household', emoji: '🧽', color: '#e3eaf6', fixture: 'gondola', rank: 40 },
  { id: 'health_beauty', name: 'health & beauty', sign: 'health & beauty', emoji: '💄', color: '#fde0ef', fixture: 'gondola', rank: 41 },
  { id: 'baby', name: 'baby', sign: 'baby', emoji: '🍼', color: '#e2f4ff', fixture: 'gondola', rank: 42 },
  { id: 'pet', name: 'pet', sign: 'pet', emoji: '🐾', color: '#efe5d6', fixture: 'gondola', rank: 43 },
  { id: 'home', name: 'home & seasonal', sign: 'home & seasonal', emoji: '🎁', color: '#ffe6d4', fixture: 'gondola', rank: 44 },
];
const DEPT_BY_ID = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d]));
/** category / department name → built-in department (first match wins) */
const DEPT_RULES: [RegExp, string][] = [
  [/food.?to.?go|sandwich|meal.?deal|sushi|wrap/, 'food_to_go'],
  [/flower|plant(s|_and)/, 'flowers'],
  [/fruit|veg|salad|produce|potato|herb|mushroom/, 'produce'],
  [/bakery|bread|cake|pastr|bagel|roll|croissant|in.?store/, 'bakery'],
  [/fish|seafood|prawn|salmon/, 'fish'],
  [/cooked|deli|charcut|ham|pate|pie/, 'deli'],
  [/meat.?free|vegetarian|tofu|plant.?based/, 'meat_free'],
  [/meat|poultry|chicken|beef|pork|lamb|sausage|bacon|mince/, 'meat'],
  [/cheese/, 'cheese'],
  [/frozen|ice.?cream|freez|ice_/, 'frozen'],
  [/milk|butter|egg|dairy|yog|cream|spread/, 'dairy'],
  [/ready|soup|pizza|pasta_fresh|fresh_pasta|dip/, 'ready_meals'],
  [/dessert|pudding|trifle|cheesecake/, 'desserts'],
  [/beer|wine|spirit|cider|alcohol|lager|gin|whisk|vodka|bws/, 'bws'],
  [/hot.?drink|tea|coffee|cereal|cupboard|tin|pasta|rice|sauce|baking|world/, 'grocery'],
  [/water|juice|smoothie|soft.?drink|cola|squash|drink/, 'drinks'],
  [/crisp|snack|biscuit|confection|sweet|chocolate|nut/, 'snacks'],
  [/free.?from|gluten/, 'free_from'],
  [/clean|laundry|household|paper|toilet.?roll|kitchen.?roll|bin|dish/, 'household'],
  [/health|beauty|toiletr|dental|hair|skin|medicine|pharm/, 'health_beauty'],
  [/baby|nappy|infant/, 'baby'],
  [/pet|dog|cat/, 'pet'],
  [/home|season|cook.?shop|party|stationery|card|toy|electric/, 'home'],
  [/chill|fridge/, 'chilled'],
];
const deptFromText = (t: string) => { const s = t.toLowerCase(); for (const [re, id] of DEPT_RULES) if (re.test(s)) return id; return 'grocery'; };
const fixtureFromText = (t: unknown): Fixture | null => {
  if (typeof t !== 'string' || !t) return null;
  const s = t.toLowerCase();
  if (/freez|frozen/.test(s)) return 'freezer';
  if (/produce|crate|table|veg/.test(s)) return 'produce';
  if (/bakery|bread|rack/.test(s)) return 'bakery';
  if (/multideck|fridge|chill|wall|counter|cool/.test(s)) return 'multideck';
  if (/gondola|ambient|shelf|aisle|bay/.test(s)) return 'gondola';
  return null;
};

// ---------------------------------------------------------------- plan
interface XY { x: number; z: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Lane {
  id: string; kind: 'staffed' | 'self'; idx: number;
  /** staffed: counter centre; self: kiosk centre */
  x: number; z: number;
  /** where the shopper stands to load / scan, queue grows toward -z from here */
  stand: XY; queueDir: XY;
  /** staffed only: belt from load end → scanner, then bagging */
  beltStart?: XY; beltEnd?: XY; scanner: XY & { y: number }; bag: XY & { y: number }; cashier?: XY;
}
/** where one unit stands and what kind of fixture it is */
export interface UnitPlace {
  x: number; z: number; rotY: number; fixture: Fixture; dept: string;
  /** shelf run length (m) and number of shelves this unit actually has (rows 1..rows) */
  len: number; rows: number;
  /** customer-facing aisle number (gondola / freezer aisles), null for wall fixtures */
  aisleNo: number | null; walkway: number | null; wall: 'L' | 'R' | 'B' | null; block: number | null;
}
/** a numbered aisle (walkway between two gondola faces) */
export interface Walkway { id: number; aisleNo: number; x: number; z0: number; z1: number; block: number; dept: string; cats: string[]; fixture: Fixture; units: string[] }
/** a department's floor zone (for the floor tint, border and hanging sign) */
export interface DeptZone extends DeptDef { rect: Rect; kind: 'wall' | 'aisles' | 'service'; units: string[]; aisles: number[]; signAt: XY & { rot: number } }
export interface GondolaRun { col: number; x: number; z0: number; z1: number; block: number; frozen: boolean; faces: { L: boolean; R: boolean } }
export interface StorePlan {
  bays: number; z0: number; z1: number; crossFront: number; crossBack: number;
  frontZ: number; entrances: (XY & { nx: number; nz: number })[]; exits: XY[]; gates: (XY & { id: string })[];
  lanes: Lane[]; checkoutZ: number;
  cafe: { x: number; z: number; w: number; d: number; counter: XY; seats: (XY & { table: number; yaw: number })[]; tables: XY[] };
  stockroom: { x: number; z: number; w: number; d: number; door: XY };
  mealDeal: XY;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number; cx: number; cz: number; w: number; d: number };
  unitPos: Record<string, { bay: number; nb: number }>;
  // ---- department floor plan (additive)
  /** +1: the street / checkouts / doors are on the +z wall */
  streetDir: 1;
  units: Record<string, UnitPlace>;
  walkways: Walkway[];
  depts: DeptZone[];
  gondolas: GondolaRun[];
  blocks: { z0: number; z1: number; aisles: number[] }[];
  /** gondola column x positions, index 1..nCols (index 0 unused) */
  cols: number[];
  produce: { rect: Rect | null; tables: (XY & { w: number; d: number })[]; flowers: XY | null };
  /** low divider walls between departments (cx, cz, w, d) */
  dividers: Rect[];
  /** checkout bank footprint */
  bank: Rect;
  /** goods-in doors on the back wall */
  goodsIn: XY;
  /** seasonal / promo floor between aisle banks (when the chilled racetrack needs a deeper store) + pallet displays on it */
  promo: { zones: Rect[]; pallets: (XY & { w: number; d: number })[] };
  /** obstacles the shopper router walks around (unexpanded) */
  obstacles: Rect[];
  lobbyZ: number;
}

const plans = new WeakMap<StoreConfig, StorePlan>();
/** unit id → shelf run length of the store planned last (slotPlacements has no cfg; one store is on screen at a time) */
const UNIT_LEN = new Map<string, number>();
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
type AnyRec = Record<string, unknown>;
const rec = (v: unknown) => (v && typeof v === 'object' ? (v as AnyRec) : {});

/** gondola column x. `aisle` is a gondola index 1..cfg.aisles (fractional = the walkway between two gondolas) */
export function gondolaX(cfg: StoreConfig, aisle: number) {
  const P = storePlan(cfg);
  const n = P.cols.length - 1;
  if (n <= 0) return 0;
  const a = cfg.aisles > 1 && cfg.aisles !== n ? 1 + ((aisle - 1) * (n - 1)) / (cfg.aisles - 1) : aisle;
  // interpolate the real column positions (data-driven plans are not on a uniform G.spacing grid)
  const i = Math.max(1, Math.min(n, a)), lo = Math.floor(i), hi = Math.min(n, lo + 1);
  return P.cols[lo] + (i - lo) * (P.cols[hi] - P.cols[lo] || G.spacing);
}

/** department definitions in play for this config: built-ins merged with cfg.departments */
export function deptDefs(cfg: StoreConfig): Record<string, DeptDef> {
  const out: Record<string, DeptDef> = { ...DEPT_BY_ID };
  const list = (cfg as unknown as AnyRec).departments;
  if (Array.isArray(list)) for (const raw of list) {
    const d = rec(raw); const id = String(d.id ?? d.name ?? ''); if (!id) continue;
    const name = String(d.name ?? id.replace(/_/g, ' '));
    const base = DEPT_BY_ID[id] ?? DEPT_BY_ID[deptFromText(`${id} ${name}`)] ?? DEPT_BY_ID.grocery;
    out[id] = {
      ...base, id, name: name.toLowerCase(),
      sign: String(d.sign_text ?? d.sign ?? name).toLowerCase(),
      emoji: typeof d.emoji === 'string' ? d.emoji : base.emoji,
      color: typeof d.floor_color === 'string' ? d.floor_color : base.color,
      fixture: fixtureFromText(d.fixture_type) ?? base.fixture,
      rank: num(d.rank, base.rank),
    };
  }
  return out;
}

interface Resolved { u: Unit; dept: DeptDef; fixture: Fixture; aisleNo: number | null; side: 'L' | 'R' | null; bay: number; idx: number; len: number; rows: number }
function resolveUnits(cfg: StoreConfig): Resolved[] {
  const defs = deptDefs(cfg);
  const anyAisleNo = cfg.units.some((u) => typeof (u as unknown as AnyRec).aisle_number === 'number');
  return cfg.units.map((u, i) => {
    const x = u as unknown as AnyRec;
    const dId = typeof x.department === 'string' ? x.department : null;
    const dept = (dId && (defs[dId] ?? { ...DEPT_BY_ID[deptFromText(dId)], id: dId, name: dId.replace(/_/g, ' '), sign: dId.replace(/_/g, ' ') })) || defs[deptFromText(u.category)] || DEPT_BY_ID.grocery;
    let fixture: Fixture = fixtureFromText(x.fixture_type) ?? (x.freezer === true ? 'freezer' : x.fridge === true ? 'multideck' : dept.fixture);
    if (fixture === 'gondola' && x.fridge === true) fixture = 'multideck';
    const aisleNo = anyAisleNo ? (typeof x.aisle_number === 'number' ? x.aisle_number : null) : (typeof u.aisle === 'number' ? u.aisle : null);
    const side = u.side === 'L' || u.side === 'R' ? u.side : null;
    // per-unit run length (generator: length_m) and shelf count (generator: rows); default = one 6.4 m bay, every row
    const len = Math.max(1.2, Math.min(12, num(x.length_m, G.unitLen)));
    const rows = Math.max(1, Math.min(cfg.rows_per_unit, num(x.rows, cfg.rows_per_unit)));
    return { u, dept, fixture, aisleNo, side, bay: num(x.bay, i), idx: i, len, rows };
  });
}

// ---------------------------------------------------------------- data-driven plan (formats/*.config.json)
/** assumption (visual only): numbered centre aisles are drawn as one continuous run of ~6 bays x 1.33 m per side, so an
 *  aisle reads as an aisle; the generator's 3 m runs (sized to the ~10% range) would be short stubs. Products are
 *  spread along the full run (slotPlacements + ShelfFill repeat facings to fill). No stat depends on run length. */
export const AISLE_RUN = 18.0;
/** assumption (visual only): centre walkway width in data-driven plans. Real UK superstore aisles are ~2.2-3 m; 4 m keeps
 *  the proportions of a real shop (long runs, narrow-ish aisles) while leaving room for the rendered crowd + trolleys. */
export const DATA_WALKWAY = 4.0;
type Knot = [number, number];
/** monotone piecewise-linear map through knots (slope 1 outside) */
const pwl = (knots: Knot[]) => (v: number) => {
  if (!knots.length) return v;
  if (v <= knots[0][0]) return knots[0][1] + (v - knots[0][0]);
  for (let i = 1; i < knots.length; i++) {
    const [a, A] = knots[i - 1], [b, B] = knots[i];
    if (v <= b) return b - a < 1e-9 ? B : A + ((v - a) * (B - A)) / (b - a);
  }
  const [a, A] = knots[knots.length - 1];
  return A + (v - a);
};

/**
 * Real floor plan from a format config (units with x/z/facing, departments with zone rects, checkouts list, café,
 * entrances/exits/gates, end panels). Data frame: origin front-left, z towards the back wall. Scene frame: back wall at
 * z = 0, street at +z, x centred. The real topology and order are kept; two stretches are applied for readability
 * (assumption, visual only): every centre-aisle walkway is widened to G.spacing - G.depth and every centre bank is
 * drawn AISLE_RUN deep (cross aisle between banks at least 2 end caps + G.midAisle). The checkout bank keeps its real
 * lane pitch and is centred on the stretched aisle block; exits + gates move with it.
 */
function dataPlan(cfg: StoreConfig): StorePlan | null {
  const C = cfg as StoreConfig & AnyRec;
  const raw = cfg.units.map((u) => u as unknown as AnyRec);
  if (!raw.length || !raw.every((u) => typeof u.x === 'number' && typeof u.z === 'number' && typeof u.facing === 'string')) return null;
  const fp = rec(C.footprint_m);
  const Wd = num(fp.w, Math.max(...raw.map((u) => u.x as number)) + 1), Dd = num(fp.d, Math.max(...raw.map((u) => u.z as number)) + 1);
  const R = resolveUnits(cfg);
  const defs = deptDefs(cfg);
  const isCentre = (r: Resolved) => (r.fixture === 'gondola' || r.fixture === 'freezer') && r.aisleNo !== null && (r.u as unknown as AnyRec).perimeter !== true;
  const centre = R.filter(isCentre);
  const facing = (r: Resolved) => String((r.u as unknown as AnyRec).facing);
  const ux = (r: Resolved) => (r.u as unknown as AnyRec).x as number, uz = (r: Resolved) => (r.u as unknown as AnyRec).z as number;

  // ---- x stretch: widen walkways between facing gondola faces, gondola bodies = G.depth
  const faceAt = new Map<number, Set<string>>();
  for (const r of centre) { const k = Math.round(ux(r) * 100) / 100; (faceAt.get(k) ?? faceAt.set(k, new Set()).get(k)!).add(facing(r)); }
  const xs = [...faceAt.keys()].sort((a, b) => a - b);
  const xk: Knot[] = [];
  if (xs.length) {
    xk.push([xs[0], xs[0]]);
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1], b = xs[i], A = xk[xk.length - 1][1];
      const fa = faceAt.get(a)!, fb = faceAt.get(b)!;
      let w = b - a;
      if (fa.has('+x') && fb.has('-x')) w = DATA_WALKWAY; // walkway
      else if (fa.has('-x') && fb.has('+x') && b - a < 1.5) w = G.depth; // back-to-back gondola
      xk.push([b, A + w]);
    }
  }
  const sx = pwl(xk);
  // ---- z stretch: centre banks AISLE_RUN deep, cross aisle between banks >= 2 end caps + midAisle
  const iv = centre.map((r) => [uz(r) - r.len / 2, uz(r) + r.len / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
  const banks: [number, number][] = [];
  for (const [a, b] of iv) { const l = banks[banks.length - 1]; if (l && a <= l[1] + 0.05) l[1] = Math.max(l[1], b); else banks.push([a, b]); }
  const zk: Knot[] = [];
  banks.forEach(([a, b], i) => {
    if (i === 0) zk.push([a, a]);
    else { const [pa, pA] = zk[zk.length - 1]; zk.push([a, pA + Math.max(a - pa, 2 * G.endcapDepth + G.midAisle + 0.2)]); }
    zk.push([b, zk[zk.length - 1][1] + AISLE_RUN]);
  });
  const sz = pwl(zk);
  const W = sx(Wd), D = sz(Dd);
  const X = (x: number) => sx(x) - W / 2;
  const Z = (z: number) => D - sz(z);
  const xMin = -W / 2, xMax = W / 2, zMin = 0, zMax = D;

  // ---- units
  const ROT: Record<string, number> = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '-z': 0, '+z': Math.PI };
  const units: Record<string, UnitPlace> = {};
  const unitPos: StorePlan['unitPos'] = {};
  const free: Rect[] = []; // freestanding non-gondola fixtures (produce tables, food-to-go chiller)
  const wallRects: Rect[] = [];
  const SNAP = 1.3; // assumption: a fixture face within 1.3 m of a wall is a wall fixture (wall multideck depth 1.1 m)
  for (const r of R) {
    const u = r.u as unknown as AnyRec, f = facing(r);
    const alongZ = f === '+x' || f === '-x';
    let x: number, z: number, len: number;
    if (alongZ) { const a = Z(uz(r) - r.len / 2), b = Z(uz(r) + r.len / 2); z = (a + b) / 2; len = Math.abs(a - b); x = X(ux(r)); }
    else { const a = X(ux(r) - r.len / 2), b = X(ux(r) + r.len / 2); x = (a + b) / 2; len = Math.abs(b - a); z = Z(uz(r)); }
    let wall: UnitPlace['wall'] = null;
    if (!isCentre(r)) {
      if (alongZ && ux(r) < SNAP && f === '+x') { wall = 'L'; x = xMin + 0.48; }
      else if (alongZ && ux(r) > Wd - SNAP && f === '-x') { wall = 'R'; x = xMax - 0.48; }
      else if (!alongZ && uz(r) > Dd - SNAP && f === '-z') { wall = 'B'; z = zMin + 0.48; }
    }
    units[r.u.id] = { x, z, rotY: ROT[f] ?? 0, len: Math.max(0.6, len - 0.06), rows: r.rows, fixture: r.fixture, dept: r.dept.id, aisleNo: isCentre(r) ? r.aisleNo : null, walkway: null, wall, block: null };
    unitPos[r.u.id] = { bay: num(u.bay, 0), nb: 1 };
    if (!isCentre(r)) {
      const h = len / 2, c = Math.cos(ROT[f] ?? 0), s = Math.sin(ROT[f] ?? 0);
      // footprint: the run, 1 m deep behind the face
      const bx = x - s * 0.5, bz = z - c * 0.5;
      const rr: Rect = alongZ ? { x0: bx - 0.5, x1: bx + 0.5, z0: z - h, z1: z + h } : { x0: x - h, x1: x + h, z0: bz - 0.5, z1: bz + 0.5 };
      (wall ? wallRects : free).push(rr);
    }
  }

  // ---- blocks, walkways, gondola runs
  const bankZ = banks.map(([a, b]) => ({ z0: Z(b), z1: Z(a) })).sort((p, q) => p.z0 - q.z0); // back → front
  const blocks: StorePlan['blocks'] = bankZ.map((b) => ({ z0: b.z0, z1: b.z1, aisles: [] }));
  const blockOf = (z: number) => Math.max(0, blocks.findIndex((b) => z >= b.z0 - 0.1 && z <= b.z1 + 0.1));
  const walkways: Walkway[] = [];
  const byAisle = new Map<number, Resolved[]>();
  for (const r of centre) byAisle.set(r.aisleNo!, [...(byAisle.get(r.aisleNo!) ?? []), r]);
  for (const [no, list] of [...byAisle.entries()].sort((a, b) => a[0] - b[0])) {
    const Lf = list.filter((r) => facing(r) === '+x'), Rf = list.filter((r) => facing(r) === '-x');
    const lx = Lf.length ? Math.max(...Lf.map((r) => units[r.u.id].x)) : Math.min(...Rf.map((r) => units[r.u.id].x)) - DATA_WALKWAY;
    const rx = Rf.length ? Math.min(...Rf.map((r) => units[r.u.id].x)) : lx + DATA_WALKWAY;
    const b = blockOf(units[list[0].u.id].z);
    const cnt = new Map<string, number>(); for (const r of list) cnt.set(r.dept.id, (cnt.get(r.dept.id) ?? 0) + 1);
    const dept = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0][0];
    const id = walkways.length;
    walkways.push({ id, aisleNo: no, x: (lx + rx) / 2, z0: blocks[b].z0, z1: blocks[b].z1, block: b, dept, cats: [...new Set(list.map((r) => r.u.category))], fixture: list.some((r) => r.fixture === 'freezer') ? 'freezer' : 'gondola', units: list.map((r) => r.u.id) });
    blocks[b].aisles.push(no);
    for (const r of list) { units[r.u.id].walkway = id; units[r.u.id].block = b; }
  }
  const gondolas: GondolaRun[] = [];
  blocks.forEach((blk, b) => {
    const faces = centre.filter((r) => units[r.u.id].block === b);
    const bodies = new Map<number, { L: boolean; R: boolean; frozen: boolean }>();
    for (const r of faces) {
      const p = units[r.u.id], f = facing(r);
      const cx = Math.round((f === '-x' ? p.x + G.depth / 2 : p.x - G.depth / 2) * 20) / 20;
      const g = bodies.get(cx) ?? { L: false, R: false, frozen: false };
      if (f === '-x') g.L = true; else g.R = true;
      if (r.fixture === 'freezer') g.frozen = true;
      bodies.set(cx, g);
    }
    [...bodies.entries()].sort((p, q) => p[0] - q[0]).forEach(([gx, g], i) => gondolas.push({ col: i + 1, x: gx, z0: blk.z0, z1: blk.z1, block: b, frozen: g.frozen, faces: { L: g.L, R: g.R } }));
  });
  const cols = [0, ...[...new Set(gondolas.map((g) => g.x))].sort((a, b) => a - b)];
  const z0 = blocks.length ? blocks[0].z0 : D * 0.3, z1 = blocks.length ? blocks[blocks.length - 1].z1 : D * 0.6;
  const crossFront = z0 - G.crossGap, crossBack = z1 + G.crossGap;

  // ---- café zone edge first (the checkout bank is laid out beside it)
  const cr = rec(C.cafe), cz_ = rec(cr.zone);
  const cafeX1 = typeof cz_.x1 === 'number' ? X(cz_.x1 as number) : xMin;
  // ---- doors (real x along the shopfront)
  const ents = (Array.isArray(C.entrances) ? C.entrances : [C.entrance]).map(rec).filter((e) => typeof e.x === 'number');
  const entrances: StorePlan['entrances'] = (ents.length ? ents : [{ x: Wd * 0.2 }]).map((e) => ({ x: X(e.x as number), z: zMax, nx: 0, nz: -1 }));
  // ---- checkouts: real counts (staffed / self) from the config's checkout list; the bank is laid out here across the
  //      front, between the café / main entrance and the far entrance, so it always fits inside the shell.
  //      assumption (visual): till pitch 2.9 m, kiosk pitch 1.45 m in two facing rows (the generator's pitch).
  const coList = (Array.isArray(C.checkouts) ? C.checkouts : []).map(rec);
  const staffed = coList.filter((c) => /staff|till|manned/.test(String(c.type ?? '')));
  const selfs = coList.filter((c) => /self|sco/.test(String(c.type ?? '')));
  const staffedZ = staffed.filter((c) => typeof c.z === 'number');
  const checkoutZ = staffedZ.length ? Z(staffedZ.reduce((s, c) => s + (c.z as number), 0) / staffedZ.length) : D - 8;
  const EXIT_ROOM = 4.6; // assumption: exit door + EAS gate pair beside each end of the bank
  const leftLimit = Math.max(cafeX1 + 1.2, ...entrances.filter((e) => e.x < 0).map((e) => e.x + 2.2)) + EXIT_ROOM;
  const rightLimit = Math.min(xMax - 1.2, ...entrances.filter((e) => e.x > 0).map((e) => e.x - 2.2)) - EXIT_ROOM;
  const avail = Math.max(10, rightLimit - leftLimit);
  const selfCols = Math.ceil(selfs.length / 2);
  let pitchS = 2.9, kpitch = 1.45;
  const want = staffed.length * pitchS + (selfs.length ? 1.6 + selfCols * kpitch : 0);
  if (want > avail) { const k = avail / want; pitchS *= Math.max(0.75, k); kpitch *= Math.max(0.8, k); }
  const bankW = staffed.length * pitchS + (selfs.length ? 1.6 + selfCols * kpitch : 0);
  const bankLeft = Math.max(leftLimit, Math.min(rightLimit - bankW, -bankW / 2));
  const belt = 2.6;
  const lanes: Lane[] = [];
  staffed.forEach((c, i) => {
    const cx = bankLeft + (i + 0.5) * pitchS, cz = checkoutZ;
    lanes.push({
      id: String(c.id ?? `T${i + 1}`), kind: 'staffed', idx: i, x: cx, z: cz,
      stand: { x: cx - 0.95, z: cz - belt / 2 + 0.1 }, queueDir: { x: 0, z: -1 },
      beltStart: { x: cx - 0.12, z: cz - belt / 2 + 0.25 }, beltEnd: { x: cx - 0.12, z: cz + 0.35 },
      scanner: { x: cx - 0.1, y: 0.99, z: cz + 0.55 }, bag: { x: cx - 0.2, y: 0.99, z: cz + belt / 2 - 0.25 }, cashier: { x: cx + 0.65, z: cz + 0.5 },
    });
  });
  const sLeft = bankLeft + staffed.length * pitchS + 1.6;
  selfs.forEach((c, i) => {
    const col = i % selfCols, row = Math.floor(i / selfCols);
    const face = row === 0 ? 1 : -1; // two rows facing each other across a corridor
    const kx = sLeft + (col + 0.5) * kpitch, kz = checkoutZ + (row === 0 ? -1.35 : 1.35);
    lanes.push({
      id: String(c.id ?? `S${i + 1}`), kind: 'self', idx: i, x: kx, z: kz,
      stand: { x: kx, z: kz + face * 0.72 }, queueDir: { x: -1, z: 0 },
      scanner: { x: kx - 0.1, y: 1.0, z: kz + face * 0.2 }, bag: { x: kx + 0.45, y: 0.82, z: kz + face * 0.12 },
    });
  });
  const laneMinX = lanes.length ? Math.min(...lanes.map((l) => l.x)) : 0, laneMaxX = lanes.length ? Math.max(...lanes.map((l) => l.x)) : 0;
  const bank: Rect = { x0: laneMinX - 0.75, x1: laneMaxX + 0.7, z0: checkoutZ - 1.75, z1: checkoutZ + 1.75 };
  const lobbyZ = checkoutZ + belt / 2 + 1.7;
  // ---- exits + EAS gates beside the ends of the bank (as many as the config lists, max one per end)
  const nExit = Math.max(1, Math.min(2, (Array.isArray(C.exits) ? C.exits : []).length || 1));
  const exits: XY[] = nExit === 1 ? [{ x: bank.x1 + 2.6, z: zMax }] : [{ x: bank.x0 - 2.6, z: zMax }, { x: bank.x1 + 2.6, z: zMax }];
  const gates = exits.flatMap((e, i) => [{ id: `G${i + 1}a`, x: e.x - 1.0, z: zMax - 1.3 }, { id: `G${i + 1}b`, x: e.x + 1.0, z: zMax - 1.3 }]);

  // ---- café (real zone, tables, seats, counter)
  let cafe: StorePlan['cafe'] = { x: xMin, z: zMax, w: 0, d: 0, counter: { x: xMin, z: zMax }, seats: [], tables: [] };
  if (typeof cz_.x0 === 'number') {
    const x0 = X(cz_.x0 as number), x1 = X(num(cz_.x1, 0)), za = Z(num(cz_.z1, 0)), zb = Z(cz_.z0 as number);
    const tables = (Array.isArray(cr.table_positions) ? cr.table_positions : []).map(rec).map((t) => ({ x: X(num(t.x, 0)), z: Z(num(t.z, 0)) }));
    const seats = (Array.isArray(cr.seats) ? cr.seats : []).map(rec).map((s) => {
      const t = tables[num(s.table, 0)] ?? tables[0]; const x = X(num(s.x, 0)), z = Z(num(s.z, 0));
      return { x, z, table: num(s.table, 0), yaw: t ? Math.atan2(t.x - x, t.z - z) : 0 };
    });
    const cc = rec(cr.counter);
    cafe = { x: (x0 + x1) / 2, z: (za + zb) / 2, w: x1 - x0, d: zb - za, counter: { x: X(num(cc.x, num(cr.x, 0))), z: Z(num(cc.z, num(cz_.z1, 0) - 1)) }, seats, tables };
  }
  const hasCafe = cafe.w > 0;

  // ---- stockroom (outside a side wall, on the free stretch nearest the back) + goods-in
  const leftBusy = Object.values(units).filter((p) => p.wall === 'L').map((p) => [p.z - p.len / 2, p.z + p.len / 2]);
  let doorZ = 3.0;
  for (let z = 3.0; z < D * 0.6; z += 0.5) if (!leftBusy.some(([a, b]) => z > a - 1.5 && z < b + 1.5)) { doorZ = z; break; }
  const stockroom = { x: xMin - 4.2, z: doorZ + 2, w: 8, d: 8, door: { x: xMin, z: doorZ } };
  const gi = rec(C.goods_in);
  const goodsIn = { x: Math.max(xMin + 3, Math.min(xMax - 3, X(num(gi.x, Wd * 0.9)))), z: zMin };

  // ---- meal deal stand: beside the food-to-go chiller
  const md = rec(C.meal_deal);
  const mdUnit = Array.isArray(md.stand_units) ? units[String(md.stand_units[0])] : undefined;
  const mealDeal = mdUnit ? { x: mdUnit.x + mdUnit.len / 2 + 2.0, z: mdUnit.z - 0.6 } : { x: entrances[0].x + 3, z: zMax - 6 };

  // ---- departments
  const depts: DeptZone[] = [];
  const dList = (Array.isArray(C.departments) ? C.departments : []).map(rec);
  let produceRect: Rect | null = null;
  let flowers: XY | null = null;
  for (const dr of dList) {
    const id = String(dr.id ?? ''); const zr = rec(dr.zone);
    if (!id || typeof zr.x0 !== 'number') continue;
    const def = defs[id] ?? DEPT_BY_ID.grocery;
    const rect: Rect = { x0: X(zr.x0 as number), x1: X(num(zr.x1, 0)), z0: Z(num(zr.z1, 0)), z1: Z(zr.z0 as number) };
    const kindRaw = String(dr.zone_kind ?? '');
    const ids = (Array.isArray(dr.units) ? dr.units : []).map(String).filter((u) => units[u]);
    const aisles = (Array.isArray(dr.aisle_numbers) ? dr.aisle_numbers : []).filter((n): n is number => typeof n === 'number');
    const first = ids.length ? units[ids[0]] : null;
    const cx = (rect.x0 + rect.x1) / 2, czz = (rect.z0 + rect.z1) / 2;
    if (/produce/.test(kindRaw)) {
      produceRect = rect;
      const sub = (Array.isArray(dr.sub_zones) ? dr.sub_zones : []).map(rec).find((s) => /flower/.test(String(s.id ?? s.name)));
      const sr = rec(sub?.zone);
      if (typeof sr.x0 === 'number') flowers = { x: (X(sr.x0 as number) + X(num(sr.x1, 0))) / 2, z: (Z(num(sr.z0, 0)) + Z(num(sr.z1, 0))) / 2 };
    }
    if (aisles.length || /centre|frozen|bws/.test(kindRaw)) {
      const b = blockOf(czz);
      depts.push({ ...def, rect, kind: 'aisles', units: ids, aisles, signAt: { x: cx, z: b === blocks.length - 1 ? rect.z1 + 1.2 : rect.z0 - 1.2, rot: 0 } });
    } else if (first?.wall) {
      const signAt = first.wall === 'B' ? { x: cx, z: zMin + G.wallDepth + 1.6, rot: 0 } : first.wall === 'L' ? { x: xMin + G.wallDepth + 1.6, z: czz, rot: Math.PI / 2 } : { x: xMax - G.wallDepth - 1.6, z: czz, rot: -Math.PI / 2 };
      depts.push({ ...def, rect, kind: 'wall', units: ids, aisles: [], signAt });
    } else {
      depts.push({ ...def, rect, kind: 'service', units: ids, aisles: [], signAt: { x: cx, z: czz, rot: 0 } });
    }
  }
  const service = (id: string, name: string, sign: string, emoji: string, color: string, rect: Rect, signAt: XY & { rot: number }): DeptZone => ({ id, name, sign, emoji, color, fixture: 'gondola', rank: 90, rect, kind: 'service', units: [], aisles: [], signAt });
  if (lanes.length) depts.push(service('checkouts', 'checkouts', 'checkouts', '🧾', '#e9e1f2', { x0: bank.x0 - 0.6, x1: bank.x1 + 0.6, z0: bank.z0 - 0.4, z1: bank.z1 + 0.3 }, { x: (bank.x0 + bank.x1) / 2, z: bank.z0 - 1.9, rot: 0 }));
  if (hasCafe) depts.push(service('cafe', 'café', 'café', '☕', '#f3dcc4', { x0: cafe.x - cafe.w / 2, x1: cafe.x + cafe.w / 2, z0: cafe.z - cafe.d / 2, z1: cafe.z + cafe.d / 2 }, { x: cafe.x, z: cafe.z - cafe.d / 2 - 0.4, rot: 0 }));

  // ---- no promo floor in walkways: the floor between blocks / walls is circulation (promo lives on the end caps)
  const promoZones: Rect[] = [];
  const pallets: StorePlan['promo']['pallets'] = [];

  // ---- dividers: end panels between perimeter departments (perpendicular to the wall they sit on)
  const dividers: Rect[] = [];
  for (const dv of (Array.isArray(C.dividers) ? C.dividers : []).map(rec)) {
    if (typeof dv.x !== 'number' || typeof dv.z !== 'number') continue;
    const x = X(dv.x), z = Z(dv.z);
    if (dv.z > Dd - SNAP - 0.5) dividers.push({ x0: x - 0.08, x1: x + 0.08, z0: zMin + 0.1, z1: zMin + 1.4 });
    else if (dv.x > Wd - SNAP - 0.5) dividers.push({ x0: xMax - 1.4, x1: xMax - 0.1, z0: z - 0.08, z1: z + 0.08 });
    else if (dv.x < SNAP + 0.5) dividers.push({ x0: xMin + 0.1, x1: xMin + 1.4, z0: z - 0.08, z1: z + 0.08 });
  }

  // ---- router obstacles
  const obstacles: Rect[] = [];
  for (const g of gondolas) obstacles.push({ x0: g.x - G.depth / 2 - 0.05, x1: g.x + G.depth / 2 + 0.05, z0: g.z0 - G.endcapDepth, z1: g.z1 + G.endcapDepth });
  obstacles.push(...free, ...wallRects);
  obstacles.push({ x0: mealDeal.x - 1.3, x1: mealDeal.x + 1.3, z0: mealDeal.z - 0.55, z1: mealDeal.z + 0.55 });
  if (flowers) obstacles.push({ x0: flowers.x - 0.9, x1: flowers.x + 0.9, z0: flowers.z - 0.9, z1: flowers.z + 0.9 });
  if (lanes.length) obstacles.push(bank);
  for (const pl of pallets) obstacles.push({ x0: pl.x - pl.w / 2, x1: pl.x + pl.w / 2, z0: pl.z - pl.d / 2, z1: pl.z + pl.d / 2 });
  if (hasCafe) for (const t of cafe.tables) obstacles.push({ x0: t.x - 0.5, x1: t.x + 0.5, z0: t.z - 0.5, z1: t.z + 0.5 });
  if (hasCafe) obstacles.push({ x0: cafe.counter.x - 1.6, x1: cafe.counter.x + 1.6, z0: cafe.counter.z - 0.4, z1: cafe.counter.z + 0.4 });
  for (const d of dividers) obstacles.push(d);

  const bounds = { xMin, xMax, zMin, zMax, cx: 0, cz: (zMin + zMax) / 2, w: W, d: D };
  return {
    bays: 1, z0, z1, crossFront, crossBack, frontZ: zMax, entrances, exits, gates, lanes, checkoutZ, cafe, stockroom, mealDeal, bounds, unitPos,
    streetDir: 1, units, walkways, depts, gondolas, blocks, cols, produce: { rect: produceRect, tables: [], flowers }, dividers, bank, goodsIn, obstacles, lobbyZ, promo: { zones: promoZones, pallets },
  };
}

export function storePlan(cfg: StoreConfig): StorePlan {
  const hit = plans.get(cfg); if (hit) return hit;
  const dp = dataPlan(cfg);
  if (dp) {
    UNIT_LEN.clear(); for (const [id, u] of Object.entries(dp.units)) UNIT_LEN.set(id, u.len);
    plans.set(cfg, dp);
    return dp;
  }
  const x = cfg as StoreConfig & AnyRec;
  const R = resolveUnits(cfg);
  const lenOf = (r: Resolved) => r.len;
  const GAPU = 0.06; // gap between neighbouring units in a run

  // ---------------- 1. split: wall fixtures vs numbered gondola / freezer aisles
  const onWall = (r: Resolved) => r.fixture !== 'gondola' && r.fixture !== 'freezer';
  const wallR = R.filter(onWall);
  const aisleR = R.filter((r) => !onWall(r));
  // walkways keyed by customer aisle number (units with no number get one per department, after the numbered ones)
  const byAisle = new Map<number, Resolved[]>();
  let extra = Math.max(0, ...aisleR.map((r) => r.aisleNo ?? 0)) + 1;
  const deptAisle = new Map<string, number>();
  for (const r of aisleR) {
    let n = r.aisleNo;
    if (n === null) { if (!deptAisle.has(r.dept.id)) deptAisle.set(r.dept.id, extra++); n = deptAisle.get(r.dept.id)!; }
    byAisle.set(n, [...(byAisle.get(n) ?? []), r]);
  }
  const anyAisleNo = cfg.units.some((u) => typeof (u as unknown as AnyRec).aisle_number === 'number');
  // legacy configs (aisle = gondola index): renumber to 1..A in route order (food first, frozen + bws last)
  let aisleKeys = [...byAisle.keys()].sort((a, b) => a - b);
  if (!anyAisleNo) {
    const rankOf = (k: number) => Math.min(...byAisle.get(k)!.map((r) => r.dept.rank));
    aisleKeys = aisleKeys.slice().sort((a, b) => rankOf(a) - rankOf(b) || a - b);
  }
  const label = new Map<number, number>(aisleKeys.map((k, i) => [k, anyAisleNo ? k : i + 1]));
  const A = aisleKeys.length;
  // aisle banks: at most 16 walkways side by side; bank 0 (front, by the tills) numbers right→left, the next snakes back
  const nBlocks = Math.max(1, Math.ceil(A / 16));
  const perBlock = Math.max(1, Math.ceil(A / nBlocks));
  // blocks[] runs back (low z) → front; bf = bank index counted from the front
  const blockAisles: number[][] = Array.from({ length: nBlocks }, () => []);
  aisleKeys.forEach((k, i) => blockAisles[nBlocks - 1 - Math.floor(i / perBlock)].push(k));
  const sides = new Map<number, { L: Resolved[]; R: Resolved[] }>();
  for (const k of aisleKeys) {
    const list = byAisle.get(k)!.slice().sort((a, b) => a.bay - b.bay || a.idx - b.idx);
    const s = { L: [] as Resolved[], R: [] as Resolved[] };
    let alt = 0;
    for (const r of list) { const sd = r.side ?? (alt++ % 2 ? 'R' : 'L'); s[sd].push(r); }
    sides.set(k, s);
  }
  const runLen = (list: Resolved[]) => list.reduce((s, r) => s + lenOf(r), 0) + Math.max(0, list.length - 1) * GAPU;
  const blockLen = blockAisles.map((ks) => Math.max(G.unitLen * 0.5, ...ks.map((k) => Math.max(runLen(sides.get(k)!.L), runLen(sides.get(k)!.R)))));
  const nCols = Math.max(2, ...blockAisles.map((ks) => ks.length + 1));

  // ---------------- 2. checkout counts + wall demand (decides width + depth)
  const co = x.checkouts;
  const coRec = rec(co);
  const coList = Array.isArray(co) ? co.map(rec) : null;
  const counts = rec(x.checkout_counts);
  const ptsOf = (v: unknown) => (Array.isArray(v) ? v.length : null);
  const nStaffed = typeof counts.staffed === 'number' ? counts.staffed : coList ? Math.max(1, coList.filter((c) => /staff|till|manned/.test(String(c.type ?? c.kind ?? ''))).length) : ptsOf(coRec.staffed) ?? num(coRec.staffed, Math.max(3, Math.min(10, Math.round(A / 2.5))));
  const nSelf = typeof counts.self === 'number' ? counts.self : coList ? coList.filter((c) => /self|sco/.test(String(c.type ?? c.kind ?? ''))).length : ptsOf(coRec.self) ?? num(coRec.self, Math.max(4, Math.min(16, A + 2)));
  const wallSorted = wallR.slice().sort((a, b) => a.dept.rank - b.dept.rank || a.bay - b.bay || a.idx - b.idx);
  const rightWant = wallSorted.filter((r) => r.dept.rank <= 2.5 || r.fixture === 'produce' || r.fixture === 'bakery');
  const chilled = wallSorted.filter((r) => !rightWant.includes(r));
  const hasCafe = (x.cafe !== false) && (A >= 6 || cfg.units.length >= 24);
  const cafeW = hasCafe ? Math.min(10, 6 + A * 0.12) : 0;
  const pitchS = 2.9, kpitch = 1.45;
  const selfCols = Math.ceil(nSelf / 2);
  const bankW = nStaffed * pitchS + (nSelf ? 1.6 + selfCols * kpitch : 0);
  const produceW = rightWant.length ? 12.6 : 0;
  const leftStrip = G.wallDepth + G.wallWalk + G.depth / 2;
  const blockW = (nCols - 1) * G.spacing + G.depth;
  const rightStrip = G.depth / 2 + (rightWant.length ? produceW : G.wallWalk + G.wallDepth);
  let W = leftStrip + blockW - G.depth + rightStrip;
  W = Math.max(W, cafeW + 3.4 + bankW + 1.4 + 3.2 + produceW * 0.6 + 2, 26);

  // ---------------- 3. z layout (back wall at zMin, street at zMax); deepen with promo floor if the racetrack needs more wall
  const zMin = 0;
  const midGap = 2 * G.endcapDepth + G.midAisle;
  const frontDepth = G.endcapDepth + 6.8 + 1.3 + 6.2; // last bank → tills → lobby → front wall
  const baseD = G.wallDepth + G.wallWalk + G.endcapDepth + blockLen.reduce((s, l) => s + l, 0) + (nBlocks - 1) * midGap + frontDepth;
  const totalWall = runLen(wallSorted);
  // perimeter available for a depth D: right (D - 8.3) + left (D - 15.5) + back (W - 2.5)
  const needD = (totalWall + 8.3 + 15.5 - (W - 2.5)) / 2 + 2;
  const promoExtra = Math.max(0, needD - baseD);
  const promoGap = promoExtra / nBlocks; // added in front of each bank's back edge (seasonal / promo floor)
  const z0 = zMin + G.wallDepth + G.wallWalk + G.endcapDepth + promoGap;
  const blocks: StorePlan['blocks'] = [];
  const promoZones: Rect[] = [];
  let zc = z0;
  for (let b = 0; b < nBlocks; b++) {
    if (b > 0) { promoZones.push({ x0: 0, x1: 0, z0: zc - promoGap, z1: zc }); }
    const zs = zc, ze = zs + blockLen[b];
    blocks.push({ z0: zs, z1: ze, aisles: [] });
    zc = ze + midGap + (b < nBlocks - 1 ? promoGap : 0);
  }
  if (promoGap > 3) promoZones.unshift({ x0: 0, x1: 0, z0: z0 - promoGap, z1: z0 });
  const z1 = blocks[blocks.length - 1].z1;
  const crossFront = z0 - G.crossGap, crossBack = z1 + G.crossGap;
  const belt = 2.6;
  const checkoutZ = z1 + G.endcapDepth + 6.8;
  const lobbyZ = checkoutZ + belt / 2 + 1.7;
  const zMax = checkoutZ + belt / 2 + 6.2;
  const cafeZ0 = checkoutZ - 2.4;

  // ---------------- 4. wall runs (right: food to go → produce → bakery; back: chilled right→left; left: back→front)
  const rightZ0 = zMin + 3.9, rightZ1 = zMax - 4.4; // stockroom door at the back, entrance + flowers at the front
  const leftZ0 = zMin + G.wallDepth + 0.2, leftZ1 = (hasCafe ? cafeZ0 : checkoutZ - 1) - 0.8;
  const take = (queue: Resolved[], cap: number) => { const out: Resolved[] = []; let used = 0; while (queue.length && used + lenOf(queue[0]) <= cap + 1e-6) { const r = queue.shift()!; out.push(r); used += lenOf(r) + GAPU; } return out; };
  const rq = rightWant.slice();
  const rightUnits = take(rq, rightZ1 - rightZ0);
  const backQueue = [...rq, ...chilled];
  const leftCapLen = Math.max(0, leftZ1 - leftZ0);
  // back wall must hold whatever the left wall can't
  const backNeedLen = Math.max(0, runLen(backQueue) - leftCapLen);
  W = Math.max(W, backNeedLen + 2 * (G.wallDepth + 0.25) + 0.5);

  // ---------------- 5. x layout
  const xMin = -W / 2, xMax = W / 2;
  const blockLeft = xMin + leftStrip;
  const cols: number[] = [0];
  for (let c = 1; c <= nCols; c++) cols.push(blockLeft + (c - 1) * G.spacing);
  const produceX0 = rightUnits.length ? xMax - produceW : xMax;
  for (const p of promoZones) { p.x0 = cols[1] - G.depth / 2; p.x1 = cols[nCols] + G.depth / 2; }

  // ---------------- 6. units → frames
  const units: Record<string, UnitPlace> = {};
  const unitPos: StorePlan['unitPos'] = {};
  const walkways: Walkway[] = [];
  const gondolas: GondolaRun[] = [];
  let wid = 0;
  blockAisles.forEach((ks, b) => {
    const blk = blocks[b];
    const n = ks.length;
    const bf = nBlocks - 1 - b; // 0 = front bank
    const rl = bf % 2 === 0; // front bank numbers right→left from the produce side; the next one snakes back
    const colStart = rl ? nCols - n : 1;
    ks.forEach((k, i) => {
      const slotIdx = rl ? n - 1 - i : i;
      const cL = colStart + slotIdx, cR = cL + 1;
      const s = sides.get(k)!;
      const all = [...s.L, ...s.R];
      const wx = (cols[cL] + cols[cR]) / 2;
      const deptCount = new Map<string, number>(); for (const r of all) deptCount.set(r.dept.id, (deptCount.get(r.dept.id) ?? 0) + 1);
      const dept = [...deptCount.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 'grocery';
      const frozen = all.some((r) => r.fixture === 'freezer');
      const w: Walkway = { id: wid, aisleNo: label.get(k)!, x: wx, z0: blk.z0, z1: blk.z1, block: b, dept, cats: [...new Set(all.map((r) => r.u.category))], fixture: frozen ? 'freezer' : 'gondola', units: all.map((r) => r.u.id) };
      walkways.push(w); blk.aisles.push(w.aisleNo);
      (['L', 'R'] as const).forEach((sd) => {
        const list = s[sd];
        let along = 0;
        list.forEach((r, bay) => {
          const gx = sd === 'L' ? cols[cL] + G.depth / 2 : cols[cR] - G.depth / 2;
          const rotY = sd === 'L' ? Math.PI / 2 : -Math.PI / 2;
          const c = along + lenOf(r) / 2; along += lenOf(r) + GAPU;
          // run bays from the end nearest the shopper's way in: the front bank from the tills side
          const zb = bf === 0 ? blk.z1 - c : blk.z0 + c;
          units[r.u.id] = { x: gx, z: zb, rotY, len: lenOf(r), rows: r.rows, fixture: r.fixture, dept: r.dept.id, aisleNo: w.aisleNo, walkway: wid, wall: null, block: b };
          unitPos[r.u.id] = { bay, nb: list.length };
        });
      });
      wid++;
    });
    // gondola columns used by this block (+ faces that carry units)
    for (let c = colStart; c <= colStart + n; c++) {
      const leftW = walkways.find((w) => w.block === b && Math.abs(w.x - (cols[c] - G.spacing / 2)) < 0.01);
      const rightW = walkways.find((w) => w.block === b && Math.abs(w.x - (cols[c] + G.spacing / 2)) < 0.01);
      gondolas.push({ col: c, x: cols[c], z0: blk.z0, z1: blk.z1, block: b, frozen: !!(leftW?.fixture === 'freezer' || rightW?.fixture === 'freezer'), faces: { L: !!leftW, R: !!rightW } });
    }
  });
  // wall fixtures
  const placeWall = (r: Resolved, wall: 'L' | 'R' | 'B', along: number, i: number, n: number) => {
    // frame origin 0.48 m off the wall so the back panel (local z -0.46) sits against it
    const base = { len: lenOf(r), rows: r.rows, fixture: r.fixture, dept: r.dept.id, aisleNo: null, walkway: null, wall, block: null };
    units[r.u.id] = wall === 'B' ? { ...base, x: along, z: zMin + 0.48, rotY: 0 }
      : wall === 'L' ? { ...base, x: xMin + 0.48, z: along, rotY: Math.PI / 2 }
        : { ...base, x: xMax - 0.48, z: along, rotY: -Math.PI / 2 };
    unitPos[r.u.id] = { bay: i, nb: n };
  };
  /** lay a run along a wall from `start` in direction `dir` (+1 / -1) */
  const run = (list: Resolved[], wall: 'L' | 'R' | 'B', start: number, dir: number) => {
    let a = 0;
    list.forEach((r, i) => { placeWall(r, wall, start + dir * (a + lenOf(r) / 2), i, list.length); a += lenOf(r) + GAPU; });
    return a;
  };
  run(rightUnits, 'R', rightZ1, -1);
  const backX1 = xMax - G.wallDepth - 0.25;
  const bq = backQueue.slice();
  const backUnits = take(bq, W - 2 * (G.wallDepth + 0.25));
  const leftUnits = take(bq, leftCapLen);
  const overflow = bq;
  const backUsed = run(backUnits, 'B', backX1, -1);
  run(leftUnits, 'L', leftZ0, 1);
  // anything left over joins the right wall behind the bakery (very chilled-heavy formats)
  run(overflow, 'R', rightZ0, 1);
  const goodsIn = { x: backUsed < W - 2 * (G.wallDepth + 0.25) - 4 ? backX1 - backUsed - 2.2 : xMin + G.wallDepth + 2, z: zMin };

  // ---------------- 7. checkouts: staffed tills (left) + self-checkout pods (right), centred between café and produce
  const regionL = xMin + (hasCafe ? cafeW + 3.4 : 2.5), regionR = (rightUnits.length ? produceX0 : xMax) - 3.4;
  const bankLeft = Math.max(regionL, (regionL + regionR) / 2 - bankW / 2);
  const lanes: Lane[] = [];
  for (let i = 0; i < nStaffed; i++) {
    const cx = bankLeft + (i + 0.5) * pitchS, cz = checkoutZ;
    const sx = cx - 0.95; // shopper walks down the left of the counter
    lanes.push({
      id: `T${i + 1}`, kind: 'staffed', idx: i, x: cx, z: cz,
      stand: { x: sx, z: cz - belt / 2 + 0.1 }, queueDir: { x: 0, z: -1 },
      beltStart: { x: cx - 0.12, z: cz - belt / 2 + 0.25 }, beltEnd: { x: cx - 0.12, z: cz + 0.35 },
      scanner: { x: cx - 0.1, y: 0.99, z: cz + 0.55 }, bag: { x: cx - 0.2, y: 0.99, z: cz + belt / 2 - 0.25 }, cashier: { x: cx + 0.65, z: cz + 0.5 },
    });
  }
  const sLeft = bankLeft + nStaffed * pitchS + 1.6;
  for (let i = 0; i < nSelf; i++) {
    const col = i % selfCols, row = Math.floor(i / selfCols);
    const face = row === 0 ? 1 : -1; // two rows facing each other across a corridor
    const kx = sLeft + (col + 0.5) * kpitch, kz = checkoutZ + (row === 0 ? -1.35 : 1.35);
    lanes.push({
      id: `S${i + 1}`, kind: 'self', idx: i, x: kx, z: kz,
      stand: { x: kx, z: kz + face * 0.72 }, queueDir: { x: -1, z: 0 },
      scanner: { x: kx - 0.1, y: 1.0, z: kz + face * 0.2 }, bag: { x: kx + 0.45, y: 0.82, z: kz + face * 0.12 },
    });
  }
  const laneMinX = Math.min(...lanes.map((l) => l.x)), laneMaxX = Math.max(...lanes.map((l) => l.x));
  const bank: Rect = { x0: laneMinX - 0.75, x1: laneMaxX + 0.7, z0: checkoutZ - 1.75, z1: checkoutZ + 1.75 };

  // ---------------- 7. doors: entrance into produce (front right), 2nd entrance by the café, exits in the lobby
  const nEnt = Math.max(1, Array.isArray(x.entrances) ? (x.entrances as unknown[]).length : 1);
  const entX = rightUnits.length ? produceX0 + produceW * 0.42 : laneMaxX + 2.6;
  const entrances: StorePlan['entrances'] = [{ x: entX, z: zMax, nx: 0, nz: -1 }];
  if (nEnt > 1) entrances.push({ x: hasCafe ? xMin + cafeW + 1.7 : laneMinX - 2.4, z: zMax, nx: 0, nz: -1 });
  const nExit = Array.isArray(x.exits) ? Math.max(1, (x.exits as unknown[]).length) : bankW > 18 ? 2 : 1;
  const exits: XY[] = nExit === 1 ? [{ x: (bank.x0 + bank.x1) / 2, z: zMax }] : Array.from({ length: nExit }, (_, i) => ({ x: bank.x0 + ((i + 0.5) / nExit) * (bank.x1 - bank.x0), z: zMax }));
  const gates = exits.flatMap((e, i) => [{ id: `G${i + 1}a`, x: e.x - 1.15, z: zMax - 1.3 }, { id: `G${i + 1}b`, x: e.x + 1.15, z: zMax - 1.3 }]);

  // ---------------- 8. café (front-left corner, opens onto the lobby)
  const cw = cafeW, cd = hasCafe ? zMax - 0.3 - cafeZ0 : 0;
  const ccx = xMin + 0.3 + cw / 2, ccz = cafeZ0 + cd / 2;
  const tables: XY[] = [];
  const seats: StorePlan['cafe']['seats'] = [];
  if (hasCafe) {
    const tcols = Math.max(1, Math.floor((cw - 0.8) / 2.2)), trows = Math.max(1, Math.floor((cd - 2.6) / 2.1));
    for (let r = 0; r < trows; r++) for (let c = 0; c < tcols; c++) tables.push({ x: ccx - cw / 2 + 1.3 + c * 2.2, z: cafeZ0 + 2.6 + r * 2.1 });
    tables.forEach((t, ti) => seats.push({ x: t.x - 0.62, z: t.z, table: ti, yaw: Math.PI / 2 }, { x: t.x + 0.62, z: t.z, table: ti, yaw: -Math.PI / 2 }));
  }
  const cafe = { x: ccx, z: ccz, w: cw, d: cd, counter: { x: ccx, z: cafeZ0 + 0.75 }, seats, tables };

  // ---------------- 9. stockroom (behind the right wall at the back) + meal deal + produce floor
  const stockroom = { x: xMax + 4, z: zMin + 4, w: 8, d: 8, door: { x: xMax, z: zMin + 2.3 } };
  const produceRect: Rect | null = rightUnits.length ? { x0: produceX0, z0: rightZ0 - 0.6, x1: xMax, z1: zMax } : null;
  const ptables: StorePlan['produce']['tables'] = [];
  let flowers: XY | null = null;
  let mealDeal = { x: entX - 3.2, z: zMax - 5.2 };
  if (produceRect) {
    // produce tables down the middle of the strip (between the wall racks and the outer gondola)
    const tx = xMax - G.wallDepth - G.wallWalk - 1.25;
    const prodUnits = rightUnits.filter((r) => r.fixture === 'produce');
    const pu = prodUnits.map((r) => units[r.u.id]).filter((p) => p.wall === 'R');
    const pz0 = pu.length ? Math.min(...pu.map((p) => p.z - p.len / 2)) : rightZ0 + 2, pz1 = pu.length ? Math.max(...pu.map((p) => p.z + p.len / 2)) : zMax - 8;
    for (let z = pz1 - 1.8; z > pz0 + 0.6; z -= 4.2) ptables.push({ x: tx, z, w: 2.2, d: 2.6 });
    flowers = { x: xMax - 1.6, z: zMax - 2.4 };
    mealDeal = { x: produceX0 + 2.6, z: zMax - 4.6 };
  }

  // ---------------- 10. department zones
  const depts: DeptZone[] = [];
  const defs = deptDefs(cfg);
  const grow = (a: Rect | undefined, b: Rect): Rect => (a ? { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) } : { ...b });
  const wallZones = new Map<string, { rect?: Rect; units: string[]; wall: 'L' | 'R' | 'B' }>();
  for (const r of wallR) {
    const p = units[r.u.id]; if (!p) continue;
    const key = `${r.dept.id}|${p.wall}`;
    const z = wallZones.get(key) ?? { units: [], wall: p.wall! };
    const reach = G.wallDepth + G.wallWalk - 0.6, half = p.len / 2 + 0.03;
    const rr: Rect = p.wall === 'B' ? { x0: p.x - half, x1: p.x + half, z0: zMin, z1: zMin + reach }
      : p.wall === 'L' ? { x0: xMin, x1: xMin + reach, z0: p.z - half, z1: p.z + half }
        : { x0: xMax - reach, x1: xMax, z0: p.z - half, z1: p.z + half };
    z.rect = grow(z.rect, rr); z.units.push(r.u.id); wallZones.set(key, z);
  }
  for (const [key, z] of wallZones) {
    const d = defs[key.split('|')[0]] ?? R.find((r) => r.dept.id === key.split('|')[0])!.dept;
    let rect = z.rect!;
    if (d.id === 'produce' && produceRect) rect = { ...produceRect, z0: rect.z0, z1: Math.max(rect.z1, zMax - 3.2) };
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    const signAt = z.wall === 'B' ? { x: cx, z: zMin + G.wallDepth + 1.6, rot: 0 } : z.wall === 'L' ? { x: xMin + G.wallDepth + 1.6, z: cz, rot: Math.PI / 2 } : { x: d.id === 'produce' ? cx : xMax - G.wallDepth - 1.6, z: cz, rot: -Math.PI / 2 };
    depts.push({ ...d, rect, kind: 'wall', units: z.units, aisles: [], signAt });
  }
  // aisle departments: contiguous runs of walkways in a block with the same department
  for (let b = 0; b < blocks.length; b++) {
    const ws = walkways.filter((w) => w.block === b).sort((p, q) => p.x - q.x);
    let run: Walkway[] = [];
    const flush = () => {
      if (!run.length) return;
      const d = defs[run[0].dept] ?? R.find((r) => r.dept.id === run[0].dept)?.dept ?? DEPT_BY_ID.grocery;
      const rect: Rect = { x0: run[0].x - G.spacing / 2 + G.depth / 2, x1: run[run.length - 1].x + G.spacing / 2 - G.depth / 2, z0: blocks[b].z0 - G.endcapDepth, z1: blocks[b].z1 + G.endcapDepth };
      const cx = (rect.x0 + rect.x1) / 2;
      depts.push({ ...d, rect, kind: 'aisles', units: run.flatMap((w) => w.units), aisles: run.map((w) => w.aisleNo), signAt: { x: cx, z: b === blocks.length - 1 ? rect.z1 + 1.2 : rect.z0 - 1.2, rot: 0 } });
      run = [];
    };
    for (const w of ws) { if (run.length && run[run.length - 1].dept !== w.dept) flush(); run.push(w); }
    flush();
  }
  const service = (id: string, name: string, sign: string, emoji: string, color: string, rect: Rect, signAt: XY & { rot: number }): DeptZone => ({ id, name, sign, emoji, color, fixture: 'gondola', rank: 90, rect, kind: 'service', units: [], aisles: [], signAt });
  depts.push(service('checkouts', 'checkouts', 'checkouts', '🧾', '#e9e1f2', { x0: bank.x0 - 0.6, x1: bank.x1 + 0.6, z0: bank.z0 - 0.4, z1: bank.z1 + 0.3 }, { x: (bank.x0 + bank.x1) / 2, z: checkoutZ - 1.9, rot: 0 }));
  if (hasCafe) depts.push(service('cafe', 'café', 'café', '☕', '#f3dcc4', { x0: xMin, x1: xMin + cw + 0.6, z0: cafeZ0, z1: zMax }, { x: ccx, z: cafeZ0 - 0.4, rot: 0 }));

  // ---------------- 11. dividers: low walls separating produce from the aisles, and the café from the chilled run
  const dividers: Rect[] = [];
  if (produceRect) {
    const dx = produceX0 + 0.1;
    // gaps at the cross aisles so the racetrack stays open
    const gaps: [number, number][] = [[crossFront - 2.4, crossFront + 2.4], [crossBack - 2.2, zMax]];
    for (let b = 0; b < blocks.length - 1; b++) gaps.push([blocks[b].z1, blocks[b + 1].z0]);
    gaps.sort((p, q) => p[0] - q[0]);
    let s = produceRect.z0 + 1.2;
    for (const [g0, g1] of gaps) { if (g0 - s > 2) dividers.push({ x0: dx - 0.12, x1: dx + 0.12, z0: s, z1: g0 }); s = Math.max(s, g1); }
  }
  if (hasCafe) dividers.push({ x0: xMin + 0.2, x1: xMin + cw + 0.4, z0: cafeZ0 - 0.25, z1: cafeZ0 - 0.05 });

  // ---------------- 12. obstacles for the router
  const obstacles: Rect[] = [];
  for (const g of gondolas) obstacles.push({ x0: g.x - G.depth / 2 - 0.05, x1: g.x + G.depth / 2 + 0.05, z0: g.z0 - G.endcapDepth, z1: g.z1 + G.endcapDepth });
  for (const t of ptables) obstacles.push({ x0: t.x - t.w / 2, x1: t.x + t.w / 2, z0: t.z - t.d / 2, z1: t.z + t.d / 2 });
  obstacles.push({ x0: mealDeal.x - 1.3, x1: mealDeal.x + 1.3, z0: mealDeal.z - 0.55, z1: mealDeal.z + 0.55 });
  if (flowers) obstacles.push({ x0: flowers.x - 0.9, x1: flowers.x + 0.9, z0: flowers.z - 0.9, z1: flowers.z + 0.9 });
  obstacles.push(bank);
  // promo / seasonal floor: pallet displays in a loose grid, walkways kept clear round the edges
  const pallets: StorePlan['promo']['pallets'] = [];
  for (const zn of promoZones) {
    const zA = zn.z0 + 3.2, zB = zn.z1 - 3.2;
    if (zB - zA < 1) continue;
    const nz = Math.max(1, Math.floor((zB - zA) / 5.5) + 1);
    for (let iz = 0; iz < nz; iz++) {
      const pz = nz === 1 ? (zA + zB) / 2 : zA + (iz * (zB - zA)) / (nz - 1);
      for (let px = zn.x0 + 3.5 + (iz % 2) * 3; px < zn.x1 - 3; px += 7.5) pallets.push({ x: px, z: pz, w: 1.6, d: 1.3 });
    }
  }
  for (const pl of pallets) obstacles.push({ x0: pl.x - pl.w / 2, x1: pl.x + pl.w / 2, z0: pl.z - pl.d / 2, z1: pl.z + pl.d / 2 });
  for (const zn of promoZones) if (zn.z1 - zn.z0 > 4) depts.push(service('seasonal', 'seasonal & offers', 'seasonal & offers', '🎉', '#ffe3c2', zn, { x: (zn.x0 + zn.x1) / 2, z: (zn.z0 + zn.z1) / 2, rot: 0 }));
  if (hasCafe) obstacles.push({ x0: xMin, x1: xMin + cw + 0.4, z0: cafeZ0 - 0.25, z1: zMax });
  for (const d of dividers) obstacles.push(d);
  // wall runs (so nobody cuts a corner through a fridge)
  const wallRect = (ids: Resolved[]) => ids.reduce<Rect | undefined>((a, r) => {
    const p = units[r.u.id]; const h = p.len / 2;
    const rr: Rect = p.wall === 'B' ? { x0: p.x - h, x1: p.x + h, z0: zMin, z1: zMin + G.wallDepth } : p.wall === 'L' ? { x0: xMin, x1: xMin + G.wallDepth, z0: p.z - h, z1: p.z + h } : { x0: xMax - G.wallDepth, x1: xMax, z0: p.z - h, z1: p.z + h };
    return grow(a, rr);
  }, undefined);
  for (const list of [rightUnits, backUnits, leftUnits, overflow]) { const r = wallRect(list); if (r) obstacles.push(r); }

  const bays = Math.max(1, ...[...sides.values()].map((v) => Math.max(v.L.length, v.R.length)));
  const bounds = { xMin, xMax, zMin, zMax, cx: 0, cz: (zMin + zMax) / 2, w: W, d: zMax - zMin };
  const plan: StorePlan = {
    bays, z0, z1, crossFront, crossBack, frontZ: zMax, entrances, exits, gates, lanes, checkoutZ, cafe, stockroom, mealDeal, bounds, unitPos,
    streetDir: 1, units, walkways, depts, gondolas, blocks, cols, produce: { rect: produceRect, tables: ptables, flowers }, dividers, bank, goodsIn, obstacles, lobbyZ, promo: { zones: promoZones, pallets },
  };
  UNIT_LEN.clear(); for (const [id, u] of Object.entries(units)) UNIT_LEN.set(id, u.len);
  plans.set(cfg, plan);
  return plan;
}

export const zRange = (cfg: StoreConfig) => { const p = storePlan(cfg); return [p.z0, p.z1] as const; };
export const storeBounds = (cfg: StoreConfig) => storePlan(cfg).bounds;

export function unitFrame(cfg: StoreConfig, u: Unit) {
  const p = storePlan(cfg).units[u.id];
  if (!p) return { x: 0, z: 0, rotY: 0, dir: 0, gx: 0 };
  const dir = Math.round(Math.sin(p.rotY)); // +1 faces +x, -1 faces -x, 0 faces ±z (wall units on the back wall)
  return { x: p.x, z: p.z, rotY: p.rotY, dir, gx: p.x - dir * (G.depth / 2) };
}
/** local (along-row x, out-of-shelf z) → world xz */
export function unitLocalToWorld(cfg: StoreConfig, u: Unit, lx: number, lz: number) {
  const f = unitFrame(cfg, u);
  const c = Math.cos(f.rotY), s = Math.sin(f.rotY);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}

export function rowY(cfg: StoreConfig, row: number) {
  // row 1 = top. Spread rows from 0.12m to ~1.5m shelf base (4+ rows go a little higher).
  const n = cfg.rows_per_unit;
  const lo = 0.12, hi = n >= 4 ? 1.6 : 1.45;
  return n === 1 ? 0.8 : hi - ((row - 1) * (hi - lo)) / (n - 1);
}
export const rowGap = (cfg: StoreConfig) => (cfg.rows_per_unit > 1 ? ((cfg.rows_per_unit >= 4 ? 1.6 : 1.45) - 0.12) / (cfg.rows_per_unit - 1) : 1);

export const parseSlot = (slot: string) => {
  const m = /^(.*)-r(\d+)$/.exec(slot);
  return m ? { unit: m[1], row: Number(m[2]) } : { unit: slot, row: 1 };
};

/** shelf run length of a unit (m): generator `length_m`, else one 6.4 m bay */
export const unitLength = (unitId: string) => UNIT_LEN.get(unitId) ?? G.unitLen;

export interface ProductPlacement { code: string; slot: string; lx: number; width: number; facings: number; index: number }
/** lay products of a slot out along the row; facings contiguous */
export function slotPlacements(slot: string, set: { products: string[]; facings: Record<string, number> } | undefined): ProductPlacement[] {
  if (!set) return [];
  const total = set.products.reduce((s, c) => s + Math.max(1, set.facings?.[c] ?? 1), 0);
  const usable = unitLength(parseSlot(slot).unit) - 0.4;
  // spread the set along the whole run (ShelfFill repeats facings to fill each product's share), so long runs are full
  const fw = usable / Math.max(total, 1);
  let x = -(total * fw) / 2;
  return set.products.map((code, index) => {
    const f = Math.max(1, set.facings?.[code] ?? 1);
    const p = { code, slot, lx: x + (f * fw) / 2, width: fw, facings: f, index };
    x += f * fw;
    return p;
  });
}

export function categoryHeight(cat: string) {
  return CAT_H[cat] ?? 0.3;
}
const CAT_H: Record<string, number> = {
  soft_drinks: 0.36, crisps_savoury: 0.34, snack_bars: 0.22, breakfast_cereal: 0.44, yoghurt: 0.2, biscuits_chocolate: 0.24,
  plant_milk_dairy_alt: 0.4, ready_meals_soup: 0.3, bakery_bread: 0.3, frozen_icecream: 0.26, hot_drinks: 0.32, confectionery_sweets: 0.2,
};
const unitCache = new WeakMap<StoreConfig, Record<string, Unit>>();
export const unitsById = (cfg: StoreConfig) => { let m = unitCache.get(cfg); if (!m) { m = Object.fromEntries(cfg.units.map((u) => [u.id, u])); unitCache.set(cfg, m); } return m; };
/** world centre of the front facing of `code` in `slot` (falls back to slot centre) */
export function productWorld(cfg: StoreConfig, plan: Planogram, rawSlot: string, code: string | null) {
  storePlan(cfg);
  const slot = shelfSlotFor(plan, rawSlot, code);
  const { unit, row } = parseSlot(slot);
  const u = unitsById(cfg)[unit];
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const w = unitLocalToWorld(cfg, u, p ? p.lx : 0, -0.2);
  const h = Math.min(categoryHeight(plan[slot]?.category ?? u.category), rowGap(cfg) - 0.1);
  return { x: w.x, y: rowY(cfg, row) + h / 2, z: w.z, slot, unit: u, h };
}
/** where a person stands to work on a slot (restockers, spills) */
export function slotStand(cfg: StoreConfig, slot: string, off = G.standOff) {
  const u = unitsById(cfg)[parseSlot(slot).unit];
  if (!u) return null;
  return unitLocalToWorld(cfg, u, 0, off);
}

// ---------------- router: visibility graph around every fixture (gondolas, tables, tills, café, wall runs) -------------
interface Router { rects: Rect[]; nodes: { x: number; z: number; dx: number; dz: number }[]; dist: Float32Array; next: Int16Array; vis: Map<string, [number, number][]> }
const routers = new WeakMap<StorePlan, Router>();
const MARGIN = 0.5, NODE_OFF = 0.62;
function segHitsRect(ax: number, az: number, bx: number, bz: number, r: Rect) {
  // Liang–Barsky against the open rect
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz], q = [ax - r.x0, r.x1 - ax, az - r.z0, r.z1 - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] <= 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-6;
}
function routerFor(sp: StorePlan): Router {
  const hit = routers.get(sp); if (hit) return hit;
  const B = sp.bounds;
  const rects = sp.obstacles.map((r) => ({ x0: r.x0 - MARGIN, z0: r.z0 - MARGIN, x1: r.x1 + MARGIN, z1: r.z1 + MARGIN }));
  const inside = (x: number, z: number) => rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  const nodes: Router['nodes'] = [];
  for (const o of sp.obstacles) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = (sx < 0 ? o.x0 : o.x1) + sx * NODE_OFF, z = (sz < 0 ? o.z0 : o.z1) + sz * NODE_OFF;
    if (x < B.xMin + 0.4 || x > B.xMax - 0.4 || z < B.zMin + 0.4 || z > B.zMax - 0.4) continue;
    if (inside(x, z)) continue;
    if (nodes.some((n) => Math.abs(n.x - x) < 0.3 && Math.abs(n.z - z) < 0.3)) continue;
    nodes.push({ x, z, dx: sx, dz: sz });
  }
  const n = nodes.length;
  const dist = new Float32Array(n * n).fill(Infinity);
  const next = new Int16Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) {
    dist[i * n + i] = 0; next[i * n + i] = i;
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j];
      if (rects.some((r) => segHitsRect(a.x, a.z, b.x, b.z, r))) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      dist[i * n + j] = dist[j * n + i] = d; next[i * n + j] = j; next[j * n + i] = i;
    }
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const dik = dist[i * n + k]; if (dik === Infinity) continue;
    for (let j = 0; j < n; j++) { const v = dik + dist[k * n + j]; if (v < dist[i * n + j]) { dist[i * n + j] = v; next[i * n + j] = next[i * n + k]; } }
  }
  const r: Router = { rects, nodes, dist, next, vis: new Map() };
  routers.set(sp, r);
  return r;
}
const losR = (r: Router, a: XY, b: XY) => !r.rects.some((q) => segHitsRect(a.x, a.z, b.x, b.z, q));
function visibleFrom(r: Router, p: XY) {
  const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)}`;
  let v = r.vis.get(key);
  if (!v) { v = []; r.nodes.forEach((nd, i) => { if (losR(r, p, nd)) v!.push([i, Math.hypot(nd.x - p.x, nd.z - p.z)]); }); r.vis.set(key, v); }
  return v;
}
/** waypoints from a to b around every fixture (b included). `spread` 0..1 widens the corners per shopper so crowds don't share one line */
export function routeBetween(cfg: StoreConfig, a: XY, b: XY, spread = 0.5): XY[] {
  const sp = storePlan(cfg), r = routerFor(sp);
  if (losR(r, a, b)) return [b];
  const va = visibleFrom(r, a), vb = visibleFrom(r, b), n = r.nodes.length;
  let best = Infinity, bi = -1, bj = -1;
  for (const [i, di] of va) for (const [j, dj] of vb) { const d = di + r.dist[i * n + j] + dj; if (d < best) { best = d; bi = i; bj = j; } }
  if (bi < 0) return [b];
  const out: XY[] = [];
  const off = 0.05 + spread * 0.45;
  let i = bi, guard = 0;
  while (i !== -1 && guard++ < 400) {
    const nd = r.nodes[i];
    out.push({ x: nd.x + nd.dx * off, z: nd.z + nd.dz * off });
    if (i === bj) break;
    i = r.next[i * n + bj];
  }
  out.push(b);
  return out;
}

// ---------------- shopper routing & timeline ----------------
export interface WP { x: number; z: number; walkway: number | null }
export type Phase = 'queue' | 'unload' | 'scan' | 'bag' | 'pay' | 'cafe' | 'exit';
export interface Seg { t0: number; t1: number; a: WP; b: WP; kind: 'move' | 'dwell' | 'phase'; event?: SimEvent; slot?: string; face?: number; phase?: Phase; lane?: string }
export interface CheckoutPlan { lane: Lane; tArrive: number; tUnload0: number; tScan: number[]; tBag: number; tPay: number; tDone: number; items: number; balked?: boolean }
/** one held queue position: slot k (0 = next to be served) at (x, z) from t0 to t1 */
export interface QueueSlot { t0: number; t1: number; k: number; x: number; z: number }
/** a shopper's place in a checkout line over time. group = staffed lane id, or 'self' for the shared self-checkout snake */
export interface QueueTrack { group: string; kind: 'staffed' | 'self'; tJoin: number; tServe: number; slots: QueueSlot[]; balked: boolean }
export interface Timeline { segs: Seg[]; start: number; end: number; checkout?: CheckoutPlan; cafeSeat?: number; queue?: QueueTrack; mission?: MissionKind }

/** events from the ai-agent arm use slot "feed:<mission>"; place them at the product's shelf slot */
const slotIndex = new WeakMap<Planogram, Record<string, string>>();
export function shelfSlotFor(plan: Planogram, slot: string, code: string | null): string {
  if (plan[slot] || !code) return slot;
  let idx = slotIndex.get(plan);
  if (!idx) { idx = {}; for (const [k, s] of Object.entries(plan)) for (const c of s?.products ?? []) idx[c] ??= k; slotIndex.set(plan, idx); }
  return idx[code] ?? slot;
}

function standPoint(cfg: StoreConfig, plan: Planogram, rawSlot: string, code: string | null, jitter: number): WP | null {
  const slot = shelfSlotFor(plan, rawSlot, code);
  const u = unitsById(cfg)[parseSlot(slot).unit];
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const w = unitLocalToWorld(cfg, u, p ? p.lx : 0, G.standOff + jitter);
  return { ...w, walkway: storePlan(cfg).units[u.id]?.walkway ?? null };
}

// ---------------- mission-driven routes ----------------
export type MissionKind = 'meal_deal' | 'top_up' | 'big_shop' | 'browse';
/** mission → route style. assumption: keyword match on the run's mission / archetype / persona id */
export function missionKind(a: Agent): MissionKind {
  const s = `${a.mission ?? ''} ${a.archetype ?? ''} ${a.persona_id ?? ''}`.toLowerCase();
  if (/meal.?deal|lunch|office/.test(s)) return 'meal_deal';
  if (/week|big|family|parent|stock.?up|monthly/.test(s)) return 'big_shop';
  if (/top.?up|quick|express|gym|treat|commut|student|single/.test(s)) return 'top_up';
  return 'browse';
}
/** meal deal priority by department text: main → drink → snack, everything else after. assumption: UK meal-deal flow */
const mealDealRank = (dept: string) => (/food.?to.?go|sandwich|meal/.test(dept) ? 0 : /drink|water|juice/.test(dept) ? 1 : /snack|crisp|biscuit|confection/.test(dept) ? 2 : 3);

/** route tuning (replay metres / seconds). Every number is an assumption, visual only (no stat reads a route) */
const ROUTE = {
  congBucket: 15, // s: congestion is counted per 15 replay-second window per aisle / wall department
  congCost: 6, // m of detour a shopper accepts to avoid one other planned shopper in that aisle + window
  twinCost: 4, // m: preference for the product's own slot over a same-category twin aisle
  rankCost: 9, // m per department rank step for the produce-first racetrack (big shops)
  mealRankCost: 80, // m per meal-deal step (main → drink → snack is near-strict)
  endTurn: 1.1, // m past the end of a walkway when leaving it via a cross aisle
};

interface RouteState { cong: Map<string, Map<number, number>>; twins: Map<string, string[]> }
const routeStates = new WeakMap<StorePlan, RouteState>();
/** per-store planned congestion. App builds timelines in order 0..n, so seedIdx 0 starts a fresh plan */
function routeState(sp: StorePlan, plan: Planogram, reset: boolean): RouteState {
  let st = routeStates.get(sp);
  if (!st || reset) {
    // twins: slots with the same category in another unit (other aisles / bays carrying that category)
    const twins = new Map<string, string[]>();
    for (const slot of Object.keys(plan)) {
      const { unit, row } = parseSlot(slot);
      if (!sp.units[unit]) continue;
      void row; const key = `${plan[slot]?.category}`;
      const l = twins.get(key) ?? twins.set(key, []).get(key)!;
      if (!l.some((x) => parseSlot(x).unit === unit)) l.push(slot); // one twin per unit
    }
    st = { cong: new Map(), twins };
    routeStates.set(sp, st);
  }
  return st;
}
const areaOf = (sp: StorePlan, unitId: string) => { const p = sp.units[unitId]; return p ? (p.walkway !== null ? `w${p.walkway}` : `d${p.dept}`) : 'none'; };
const congAt = (st: RouteState, area: string, t: number) => st.cong.get(area)?.get(Math.floor(t / ROUTE.congBucket)) ?? 0;
const congAdd = (st: RouteState, area: string, t0: number, t1: number) => {
  const m = st.cong.get(area) ?? st.cong.set(area, new Map()).get(area)!;
  for (let b = Math.floor(t0 / ROUTE.congBucket); b <= Math.floor(t1 / ROUTE.congBucket); b++) m.set(b, (m.get(b) ?? 0) + 1);
};
const seeded = (seed: number) => { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

/**
 * Shopping part of a trip. The logged events (what the shopper saw / picked / rejected) are all kept, but the ORDER and
 * the aisle are planned here so the floor fills like a real store instead of one trunk route:
 *  - meal deal: main (food to go) → drink → snack, then the tills; top-up / browse: nearest-next over its own list only;
 *    big shop: produce first, then the racetrack by department rank, clockwise or anticlockwise per shopper.
 *  - congestion-aware: each candidate stop costs walking distance + ROUTE.congCost per shopper already planned in that
 *    aisle in that time window, so a crowded aisle is visited later (or a twin aisle with the same category is used).
 *  - twin aisles: if the category sits on the same shelf row in another aisle, the shopper may use that aisle instead
 *    (visual only: the logged event still names the product; the stand point is in the chosen aisle).
 *  - leaving a numbered aisle uses the end facing the next stop (front / middle / back cross aisle), entrances alternate.
 */
export function buildTimeline(cfg: StoreConfig, plan: Planogram, agent: Agent, startAt: number, seedIdx: number, ai = false): Timeline {
  const sp = storePlan(cfg);
  const st = routeState(sp, plan, seedIdx === 0);
  const rnd = seeded(seedIdx * 7919 + 17);
  const jitter = rnd() * 0.5 - 0.25;
  const lane = rnd();
  const speed = ai ? G.aiWalkSpeed : G.walkSpeed;
  const mission = ai ? 'browse' : missionKind(agent);
  const segs: Seg[] = [];
  let t = startAt + rnd() * 1.5; // assumption: up to 1.5 s arrival jitter so the doors don't pulse
  const door = sp.entrances[Math.floor(rnd() * sp.entrances.length) % sp.entrances.length];
  let cur: WP = { x: door.x + jitter * 3 - door.nx * 4.2, z: door.z - door.nz * 4.2, walkway: null };
  const step = (w: XY & { walkway?: number | null }) => {
    const d = Math.hypot(w.x - cur.x, w.z - cur.z);
    const b: WP = { x: w.x, z: w.z, walkway: w.walkway ?? null };
    if (d < 1e-3) { cur = b; return; }
    const dt = d / speed;
    segs.push({ t0: t, t1: t + dt, a: cur, b, kind: 'move' });
    t += dt; cur = b;
  };
  const moveTo = (b: WP) => {
    // leave a numbered aisle by the end that faces the target (keeps the cross aisles all in use)
    if (cur.walkway !== null && cur.walkway !== b.walkway) {
      const w = sp.walkways[cur.walkway];
      if (w) {
        const goBack = b.z < w.z0 || (b.z <= w.z1 && (b.walkway === null ? cur.z - w.z0 < w.z1 - cur.z : lane < 0.5));
        const ez = goBack ? w.z0 - G.endcapDepth - ROUTE.endTurn : w.z1 + G.endcapDepth + ROUTE.endTurn;
        step({ x: w.x + (lane - 0.5) * 1.2, z: cur.z, walkway: w.id });
        step({ x: w.x + (lane - 0.5) * 1.2, z: ez, walkway: null });
      }
    }
    const pts = routeBetween(cfg, cur, b, lane); pts.forEach((p, i) => step(i === pts.length - 1 ? b : p));
  };
  step({ x: door.x + jitter * 2 + door.nx * 2.2, z: door.z + door.nz * 2.2 });
  const evs = agent.events.length ? agent.events : agent.path.map((slot, i) => ({ step: i, slot, product: '', p_notice: 0, noticed: false, decision: 'not_noticed' as const }));
  const units = unitsById(cfg);
  const defs = deptDefs(cfg);
  const walkOrder = (rec(rec(cfg as unknown as AnyRec).adjacency).walk_order as unknown[] | undefined)?.map(String) ?? [];
  const rankOf = (dept: string) => { const i = walkOrder.indexOf(dept); return i >= 0 ? i : (defs[dept]?.rank ?? 20); };
  const reverse = mission === 'big_shop' && rnd() < 0.5;

  // stops = shelf units (all of a unit's events are done in one visit, in order along the run). A unit's stop may be
  // moved to a twin unit carrying the same category (another aisle) when that is less crowded.
  interface Ev { e: SimEvent; slot: string; at: WP; lx: number }
  interface Stop { unit: string; evs: Ev[]; dept: string; area: string; twins: string[] }
  const stops = new Map<string, Stop>();
  for (const e of evs) {
    const slot = shelfSlotFor(plan, e.slot, e.product || null);
    const unit = parseSlot(slot).unit;
    const u = units[unit];
    if (!u || !sp.units[unit]) continue;
    const at = standPoint(cfg, plan, e.slot, e.product || null, jitter); if (!at) continue;
    const p = sp.units[unit], c = Math.cos(p.rotY), s = Math.sin(p.rotY);
    const lx = (at.x - p.x) * c - (at.z - p.z) * s; // along-run coordinate
    let st0 = stops.get(unit);
    if (!st0) {
      const cat = plan[slot]?.category ?? u.category;
      const tw = ai ? [] : (st.twins.get(cat) ?? []).map((x) => parseSlot(x).unit).filter((x) => x !== unit && sp.units[x]).slice(0, 4);
      st0 = { unit, evs: [], dept: p.dept, area: areaOf(sp, unit), twins: tw };
      stops.set(unit, st0);
    }
    st0.evs.push({ e, slot, at, lx });
  }
  const unitCentre = (id: string) => { const p = sp.units[id]; return { x: p.x + Math.sin(p.rotY) * G.standOff, z: p.z + Math.cos(p.rotY) * G.standOff }; };
  const todo = new Set(stops.keys());
  // big shop: produce first, then the racetrack in rank order, or the other way round (reverse) for half the shoppers
  const rr = (dept: string) => { const r = rankOf(dept); return reverse && r > 1 ? 100 - r : r; };
  while (todo.size) {
    let best: { stop: Stop; unit: string; cost: number } | null = null;
    const r0 = mission === 'big_shop' ? Math.min(...[...todo].map((k) => rr(stops.get(k)!.dept))) : 0;
    for (const key of todo) {
      const stp = stops.get(key)!;
      for (const uid of [stp.unit, ...stp.twins]) {
        const c = unitCentre(uid);
        const d = Math.hypot(c.x - cur.x, c.z - cur.z);
        let cost = d + ROUTE.congCost * congAt(st, areaOf(sp, uid), t + d / speed) + (uid !== stp.unit ? ROUTE.twinCost : 0) + rnd() * 0.8;
        if (mission === 'meal_deal') cost += ROUTE.mealRankCost * mealDealRank(stp.dept);
        else if (mission === 'big_shop') cost += ROUTE.rankCost * Math.max(0, rr(stp.dept) - r0);
        if (!best || cost < best.cost) best = { stop: stp, unit: uid, cost };
      }
    }
    if (!best) break;
    todo.delete(best.stop.unit);
    const uid = best.unit, p = sp.units[uid], u = units[uid];
    const twin = uid !== best.stop.unit;
    const rotY = p.rotY, face = Math.atan2(-Math.sin(rotY), -Math.cos(rotY));
    // walk the run from the end nearest to us
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const myLx = (cur.x - p.x) * c - (cur.z - p.z) * s;
    const list = best.stop.evs.slice().sort((a, b) => (myLx < 0 ? a.lx - b.lx : b.lx - a.lx));
    const half = Math.max(0, p.len / 2 - 0.5);
    const t0 = t;
    list.forEach((ev, i) => {
      // on a twin unit, spread the stops along its run in the same order (visual only)
      const at: WP = twin ? { ...unitLocalToWorld(cfg, u, (list.length > 1 ? i / (list.length - 1) - 0.5 : 0) * 2 * half * (myLx < 0 ? 1 : -1), G.standOff + jitter), walkway: p.walkway } : ev.at;
      if (i === 0) moveTo(at); else step(at);
      const e = ev.e;
      const dwell = ai ? (e.decision === 'pick' ? DWELL.ai_pick : DWELL.ai_walk_past) : DWELL[e.decision] ?? DWELL.walk_past;
      segs.push({ t0: t, t1: t + dwell, a: cur, b: cur, kind: 'dwell', event: e, slot: twin ? `${uid}-r${parseSlot(ev.slot).row}` : ev.slot, face });
      t += dwell;
    });
    congAdd(st, areaOf(sp, uid), t0, t);
  }
  // finish in the front cross aisle, spread along the bank
  const fx = Math.max(sp.bank.x0, Math.min(sp.bank.x1, cur.x + (lane - 0.5) * 6));
  moveTo({ x: fx, z: Math.min(sp.crossBack + 0.4 + (lane - 0.5) * 1.1, sp.bank.z0 - 1.2), walkway: null });
  return { segs, start: startAt, end: t, mission };
}

// ---------------- checkout queues ----------------
/** queue geometry + choice rules. assumption (visual only; the ops engine owns real service times + routing) */
export const QUEUE = {
  staffedFirst: 1.6, // m from the till stand to the first waiting slot (the person unloading has the belt)
  staffedGap: 1.15, // m per waiting shopper in a till line (person + basket/trolley)
  selfGap: 0.9, // m between people in the shared self-checkout snake
  selfPerRow: 8, // people per row of the snake before it folds back
  selfRowGap: 1.1, // m between snake rows
  overhead: 3.4, // s per customer at a till on top of scanning (bag + pay + hand-over), replay pacing
  balkAhead: 5, // people already waiting at every preferred lane → a small basket balks to the other kind
};
/** world position of waiting slot k (0 = next to be served) of a line: a staffed lane id, or 'self' */
export function queueSlotPos(sp: StorePlan, group: string, k: number): XY {
  if (group === 'self') {
    const self = sp.lanes.filter((l) => l.kind === 'self');
    const x0 = Math.min(...self.map((l) => l.x)) - 0.7;
    const row = Math.floor(k / QUEUE.selfPerRow), i = k % QUEUE.selfPerRow;
    return { x: x0 + (row % 2 === 0 ? i : QUEUE.selfPerRow - 1 - i) * QUEUE.selfGap, z: sp.bank.z0 - 0.9 - row * QUEUE.selfRowGap };
  }
  const L = sp.lanes.find((l) => l.id === group);
  if (!L) return { x: 0, z: 0 };
  const n = Math.hypot(L.queueDir.x, L.queueDir.z) || 1, off = QUEUE.staffedFirst + k * QUEUE.staffedGap;
  return { x: L.stand.x + (L.queueDir.x / n) * off, z: L.stand.z + (L.queueDir.z / n) * off };
}
/** who is waiting where at time t: group → [{id, k, x, z}] in line order (from Timeline.queue) */
export function queueAt(tls: Record<string, Timeline>, t: number) {
  const out = new Map<string, { id: string; k: number; x: number; z: number }[]>();
  for (const [id, tl] of Object.entries(tls)) {
    const q = tl.queue; if (!q || t < q.tJoin || t >= q.tServe) continue;
    const s = q.slots.find((x) => t >= x.t0 && t < x.t1); if (!s) continue;
    (out.get(q.group) ?? out.set(q.group, []).get(q.group)!).push({ id, k: s.k, x: s.x, z: s.z });
  }
  for (const l of out.values()) l.sort((a, b) => a.k - b.k);
  return out;
}

/**
 * Checkout + exit for every shopper, scheduled together so lines are real FIFO queues:
 *  - staffed tills: one line per lane, waiting slots spaced QUEUE.staffedGap behind the belt; everyone steps up one slot
 *    when the person at the front starts unloading.
 *  - self-checkout: ONE shared snake feeding the kiosk bank; the head goes to the next free kiosk.
 *  - lane choice: basket rule (small basket + no trolley → self) then lowest expected wait = time until the lane frees
 *    (items ahead x scan s + QUEUE.overhead per customer, TILL pacing); a small basket balks to the tills if every
 *    self-checkout is QUEUE.balkAhead deep. Visual only: no decision or stat depends on it (the ops engine has its own).
 */
export function scheduleCheckouts(cfg: StoreConfig, tls: Record<string, Timeline>, items: Record<string, number>, carriers: Record<string, string>, aiIds: Set<string>, cafeIds: Set<string>) {
  const sp = storePlan(cfg);
  const staffedL = sp.lanes.filter((l) => l.kind === 'staffed'), selfL = sp.lanes.filter((l) => l.kind === 'self');
  const free: Record<string, number> = Object.fromEntries(sp.lanes.map((l) => [l.id, 0]));
  const starts: Record<string, number[]> = { self: [], ...Object.fromEntries(staffedL.map((l) => [l.id, [] as number[]])) };
  const order = Object.keys(tls).sort((a, b) => tls[a].end - tls[b].end);
  const seatFree = sp.cafe.seats.map(() => 0);
  const selfMaxX = Math.max(...selfL.map((l) => l.x), -Infinity), selfMinX = Math.min(...selfL.map((l) => l.x), Infinity);
  const ahead = (g: string, t: number) => starts[g].filter((s) => s > t).length;
  const svc = (kind: 'staffed' | 'self', n: number) => (kind === 'staffed' ? n * TILL.scanPer + QUEUE.overhead : n * TILL.selfScanPer + 0.5 + TILL.bag + TILL.pay);
  // ---- pass 1: lane choice per shopper (in the order they reach the front), against an approximate lane state.
  //      choose: basket rule, then lowest expected cost; a small basket balks to the tills if the snake is long
  interface Dec { L: Lane; kind: 'staffed' | 'self'; group: string; arrive: number; balked: boolean }
  const decided = new Map<string, Dec>();
  {
    const free1: Record<string, number> = Object.fromEntries(sp.lanes.map((l) => [l.id, 0]));
    const starts1: Record<string, number[]> = { self: [], ...Object.fromEntries(staffedL.map((l) => [l.id, [] as number[]])) };
    for (const id of order) {
      const n = items[id] ?? 0;
      if (aiIds.has(id) || n <= 0 || !sp.lanes.length) continue;
      const tl = tls[id], last = tl.segs[tl.segs.length - 1];
      const cur = last ? last.b : { x: 0, z: sp.crossBack };
      const t = tl.end;
      const est = (L: Lane) => {
        const arrive = t + Math.hypot(L.stand.x - cur.x, L.stand.z - cur.z) / G.walkSpeed;
        const freeAt = L.kind === 'self' ? Math.min(...selfL.map((x) => free1[x.id])) : free1[L.id];
        return { L, arrive, wait: Math.max(0, freeAt - arrive), q: starts1[L.kind === 'self' ? 'self' : L.id].filter((x) => x > arrive).length };
      };
      // assumption: shoppers weigh walking time at ~0.35 of queueing time (they will walk past tills to a short line)
      const cost = (a: ReturnType<typeof est>) => a.wait + svc(a.L.kind, n) + 0.35 * (a.arrive - t) + a.q * 0.5;
      const pickBest = (pool: Lane[]) => pool.map(est).sort((a, b) => cost(a) - cost(b))[0];
      const small = carriers[id] !== 'trolley' && n <= TILL.selfMaxItems;
      let kind: 'staffed' | 'self' = (small && selfL.length) || !staffedL.length ? 'self' : 'staffed';
      let choice = pickBest(kind === 'self' ? [selfL[0]] : staffedL);
      let balked = false;
      if (kind === 'self' && choice.q >= QUEUE.balkAhead && staffedL.length) {
        const alt = pickBest(staffedL);
        if (alt.q < choice.q) { choice = alt; kind = 'staffed'; balked = true; }
      }
      const group = kind === 'self' ? 'self' : choice.L.id;
      const K = kind === 'self' ? selfL.reduce((b, x) => (free1[x.id] < free1[b.id] ? x : b), selfL[0]) : choice.L;
      const start = Math.max(choice.arrive, free1[K.id], ...starts1[group]);
      starts1[group].push(start); free1[K.id] = start + svc(kind, n) + (kind === 'staffed' ? n * TILL.unloadPer : 0);
      decided.set(id, { L: choice.L, kind, group, arrive: choice.arrive, balked });
    }
  }
  // ---- pass 2: build the walks + FIFO lines in the order shoppers actually reach their line
  order.sort((a, b) => (decided.get(a)?.arrive ?? tls[a].end) - (decided.get(b)?.arrive ?? tls[b].end));
  order.forEach((id, k) => {
    const tl = tls[id];
    let t = tl.end;
    const last = tl.segs[tl.segs.length - 1];
    let cur: WP = last ? { ...last.b } : { x: 0, z: sp.crossBack, walkway: null };
    const ai = aiIds.has(id);
    const speed = ai ? G.aiWalkSpeed : G.walkSpeed;
    const go = (b: WP, phase?: Phase, lane?: string) => {
      const d = Math.hypot(b.x - cur.x, b.z - cur.z);
      if (d < 1e-3) return;
      const dt = d / speed;
      tl.segs.push({ t0: t, t1: t + dt, a: cur, b, kind: 'move', phase, lane }); t += dt; cur = b;
    };
    const goR = (b: WP, phase?: Phase, lane?: string) => { const pts = routeBetween(cfg, cur, b, ((k * 29) % 10) / 10); pts.forEach((p, i) => go(i === pts.length - 1 ? b : { ...p, walkway: null }, phase, lane)); };
    const hold = (dur: number, phase: Phase, face: number, lane?: string) => { if (dur <= 1e-3) return; tl.segs.push({ t0: t, t1: t + dur, a: cur, b: cur, kind: 'phase', phase, face, lane }); t += dur; };
    const n = items[id] ?? 0;
    const lobby = sp.lobbyZ + ((k % 3) - 1) * 0.4;
    if (!ai && n > 0 && sp.lanes.length) {
      const dec = decided.get(id)!;
      const { kind, group, balked } = dec;
      const choice = { L: dec.L, arrive: dec.arrive };
      // ---- walk to the tail of the line (slot = people still waiting when we get there)
      let kq = ahead(group, choice.arrive);
      const tail = queueSlotPos(sp, group, kq);
      goR({ ...tail, walkway: null }, 'queue', group === 'self' ? selfL[0]?.id : group);
      kq = ahead(group, t);
      const tJoin = t;
      let pos = queueSlotPos(sp, group, kq);
      go({ ...pos, walkway: null }, 'queue', group === 'self' ? selfL[0]?.id : group);
      // ---- service start: FIFO behind everyone already in this line
      const prev = starts[group].length ? Math.max(...starts[group]) : 0;
      let L = choice.L;
      let tStart: number;
      if (kind === 'self') {
        L = selfL.reduce((b, s) => (free[s.id] < free[b.id] ? s : b), selfL[0]);
        tStart = Math.max(t, free[L.id], prev);
      } else tStart = Math.max(t, free[L.id], prev);
      // ---- step up one slot each time someone ahead is called
      const slots: QueueSlot[] = [];
      const faceQ = kind === 'staffed' ? 0 : Math.PI;
      const calls = starts[group].filter((s) => s > t).sort((a, b) => a - b);
      let since = t;
      for (const c of calls) {
        if (c >= tStart) break;
        hold(c - t, 'queue', faceQ, L.id);
        slots.push({ t0: since, t1: t, k: kq, x: pos.x, z: pos.z });
        kq = Math.max(0, kq - 1); pos = queueSlotPos(sp, group, kq);
        since = t; go({ ...pos, walkway: null }, 'queue', L.id);
      }
      hold(tStart - t, 'queue', faceQ, L.id);
      slots.push({ t0: since, t1: t, k: kq, x: pos.x, z: pos.z });
      starts[group].push(t);
      tl.queue = { group, kind, tJoin, tServe: t, slots, balked };
      // ---- to the till / kiosk
      if (kind === 'self') { go({ x: selfMinX - 1.0, z: sp.checkoutZ, walkway: null }, 'queue', L.id); go({ x: L.stand.x, z: sp.checkoutZ, walkway: null }, 'queue', L.id); }
      go({ ...L.stand, walkway: null }, 'queue', L.id);
      const tArrive = t;
      const faceTill = L.kind === 'staffed' ? Math.PI / 2 : (L.stand.z > L.z ? Math.PI : 0);
      let tScan: number[] = [];
      const tUnload0 = t;
      if (L.kind === 'staffed') {
        hold(n * TILL.unloadPer + 0.3, 'unload', faceTill, L.id);
        const s0 = tUnload0 + 0.9;
        tScan = Array.from({ length: n }, (_, i) => Math.max(s0 + i * TILL.scanPer, tUnload0 + (i + 1) * TILL.unloadPer + 0.7));
        go({ x: L.stand.x, z: L.bag.z, walkway: null }, 'scan', L.id);
        const ends = tScan[n - 1];
        if (ends > t) hold(ends - t, 'scan', faceTill, L.id);
      } else {
        tScan = Array.from({ length: n }, (_, i) => t + 0.35 + (i + 1) * TILL.selfScanPer);
        hold(n * TILL.selfScanPer + 0.5, 'scan', faceTill, L.id);
      }
      const tBag = t; hold(TILL.bag, 'bag', faceTill, L.id);
      const tPay = t; hold(TILL.pay, 'pay', faceTill, L.id);
      // the next shopper may start unloading while this one bags + pays (staffed); a kiosk frees when they step away
      free[L.id] = t - (L.kind === 'staffed' ? TILL.bag + TILL.pay - 0.4 : -0.6);
      tl.checkout = { lane: L, tArrive, tUnload0, tScan, tBag, tPay, tDone: t, items: n, balked };
      if (L.kind === 'self') go({ x: selfMaxX + 1.1, z: cur.z, walkway: null }, 'exit');
      go({ x: cur.x, z: lobby, walkway: null }, 'exit');
    } else {
      // nothing to pay for (ai agents read a feed; empty-handed humans): past the end of the bank
      const gapX = sp.bank.x1 + 1.3;
      goR({ x: gapX, z: sp.bank.z0 - 0.8, walkway: null });
      go({ x: gapX, z: lobby, walkway: null });
    }
    // café: some shoppers sit down with a drink before leaving
    if (cafeIds.has(id) && sp.cafe.seats.length) {
      let si = 0; for (let i = 1; i < seatFree.length; i++) if (seatFree[i] < seatFree[si]) si = i;
      const seat = sp.cafe.seats[si];
      const c = sp.cafe;
      const door = { x: c.x + c.w / 2 + 0.9, z: lobby, walkway: null };
      go(door);
      go({ x: c.x + c.w / 2 - 0.6, z: lobby, walkway: null });
      go({ x: c.x + c.w / 2 - 0.6, z: c.counter.z + 1.0, walkway: null });
      go({ x: c.counter.x, z: c.counter.z + 0.8, walkway: null });
      hold(1.2, 'cafe', Math.PI, 'counter');
      go({ x: seat.x, z: seat.z, walkway: null });
      const sit = 9 + ((k * 7) % 6);
      hold(sit, 'cafe', seat.yaw, `seat:${si}`);
      seatFree[si] = t;
      tl.cafeSeat = si;
      go({ x: c.x + c.w / 2 - 0.6, z: Math.min(sp.bounds.zMax - 1.2, seat.z + 1), walkway: null }, 'exit');
      go({ x: c.x + c.w / 2 - 0.6, z: lobby, walkway: null }, 'exit');
      go({ ...door }, 'exit');
    }
    const ex = sp.exits.reduce((b, e) => (Math.abs(e.x - cur.x) < Math.abs(b.x - cur.x) ? e : b), sp.exits[0]);
    const jx = ((k % 3) - 1) * 0.35;
    go({ x: ex.x + jx, z: lobby, walkway: null }, 'exit');
    go({ x: ex.x + jx, z: ex.z - 2.2, walkway: null }, 'exit');
    go({ x: ex.x + jx, z: ex.z + 3.5, walkway: null }, 'exit');
    tl.end = t;
  });
}

export function sampleTimeline(tl: Timeline, t: number): { x: number; z: number; heading: number; seg: Seg | null; visible: boolean } {
  if (!tl.segs.length || t < tl.start) return { x: 0, z: 0, heading: 0, seg: null, visible: false };
  if (t >= tl.end) { const s = tl.segs[tl.segs.length - 1]; return { x: s.b.x, z: s.b.z, heading: 0, seg: null, visible: false }; }
  let lo = 0, hi = tl.segs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.segs[mid].t1 < t) lo = mid + 1; else hi = mid; }
  const s = tl.segs[lo];
  const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
  const x = s.a.x + (s.b.x - s.a.x) * k, z = s.a.z + (s.b.z - s.a.z) * k;
  let heading = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
  if (s.kind !== 'move') heading = s.face ?? 0;
  return { x, z, heading, seg: s, visible: true };
}
