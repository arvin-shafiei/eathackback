// The ops layer: the store "running itself" from the ops day log (sim/ops.py → data/sim/ops/day_*.json; fixture until
// it exists), replayed on a time-of-day clock (clockStart + replay seconds × OPS_RATE).
//   Staff.tsx     restockers + roll cages (refill shelves via shelfBus), cleaner + wet-floor signs, manager + tablet,
//                 guard, cashiers on every staffed till (kinematic rapier bodies: shoppers bonk off them)
//   Checkout.tsx  ops queues per lane → people in line, belts carrying packs to the scanner, beeps, bagging, card pay
//   Cafe.tsx      ops café occupancy → diners walking in, sitting, sipping, leaving; barista; grab-and-go rack
//   Security.tsx  ops alarms → EAS gate strobe + beep beep beep + shoplifter frozen in the gate + guard runs over
// This file owns the clock → minute lookup, the one-shot events (alarms, orders) and the pop-ups.
// Tasks, queues, occupancy, spills, orders and alarms come from the log; walking paths and animation are presentation.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Planogram, Product, StoreConfig } from '../types';
import { productWorld, storePlan } from '../layout';
import { minuteAt, gateFor, setActiveOpsDay, useOpsDay, defaultClockStart, OPS_RATE, type OpsDay, type OpsMinute, type OpsStaff } from '../ops';
import { bus, sfx } from './fx';
import { INK, prodLabel } from '../theme';
import { StaffCrew, Spills, type OpsLive, type Walker } from './Staff';
import { Checkout } from './Checkout';
import { Cafe } from './Cafe';
import { Security, type Lifter } from './Security';

interface Props {
  cfg: StoreConfig; timeRef: MutableRefObject<number>;
  /** the ops day; leave undefined and the layer loads public/data/ops itself (newest real day, else the fixture) */
  ops?: OpsDay | null;
  /** minute of day at replay t=0; undefined → ?clock=HH:MM or 12:00 */
  clockStart?: number;
  planogram: Planogram; products: Record<string, Product>; live: boolean;
  /** optional switches (default all on) */
  show?: Partial<Record<'staff' | 'checkout' | 'cafe' | 'security', boolean>>;
}

interface Pop { id: number; text: string; sub?: string; x: number; z: number; until: number; kind: 'order' | 'alarm' }

export function Ops({ cfg, ops: opsProp, timeRef, clockStart: clockProp, planogram, products, live, show }: Props) {
  const P = storePlan(cfg);
  const loaded = useOpsDay(opsProp === undefined);
  const ops = opsProp === undefined ? loaded : opsProp;
  const clockStart = Number.isFinite(clockProp) ? (clockProp as number) : defaultClockStart();
  const roster = useMemo<OpsStaff[]>(() => {
    const base = (ops?.staff ?? []).filter((s) => s.role !== 'cashier');
    // every staffed till gets a cashier (the replay sends shoppers to all of them)
    const cashiers = P.lanes.filter((l) => l.kind === 'staffed').map((l) => ({ id: `K-${l.id}`, role: 'cashier', lane: l.id }));
    return [...(base.length ? base : [{ id: 'G1', role: 'guard' }]), ...cashiers];
  }, [ops, P]);

  useEffect(() => { setActiveOpsDay(ops); return () => setActiveOpsDay(null); }, [ops]);

  const liveRef = useRef<OpsLive>({ rec: null, t: 0, dtR: 0, jump: true, now: 0, guard: null });
  const walkersOut = useRef<Record<string, Walker | null>>({});
  const [rec, setRec] = useState<OpsMinute | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [lifters, setLifters] = useState<Lifter[]>([]);
  const last = useRef({ minute: -1, t: 0, n: 0 });

  // runs before the children's frames (priority -1 never takes over rendering)
  useFrame((st) => {
    const t = timeRef.current, now = st.clock.elapsedTime;
    const opsMin = clockStart + t * OPS_RATE;
    bus.opsMin = opsMin;
    const L = last.current;
    const dtR = t - L.t; L.t = t;
    const jump = Math.abs(dtR) > 2 || dtR < 0;
    const r = live ? minuteAt(ops, opsMin) : null;
    const lv = liveRef.current;
    lv.t = t; lv.dtR = dtR; lv.jump = jump; lv.now = now;
    if (jump) { lv.guard = null; setPops((c) => (c.length ? [] : c)); setLifters((c) => (c.length ? [] : c)); }
    const mi = r ? r.t : -1;
    if (mi !== L.minute) {
      // fire the one-shot events (alarms, orders) of every minute we just crossed, unless the clock jumped
      if (ops && r && !jump && L.minute >= 0 && mi > L.minute && mi - L.minute <= 4) {
        const crossed = ops.minutes.filter((m) => m.t > L.minute && m.t <= mi);
        const add: Pop[] = [], addL: Lifter[] = [];
        for (const m of crossed) {
          for (const a of m.alarms ?? []) {
            const g = a.at && typeof a.at === 'object' ? { x: a.at.x, z: a.at.z, id: a.gate ?? 'G1a' } : gateFor(cfg, a.gate);
            if (!g) continue;
            bus.alarm[g.id] = now + 5;
            sfx.alarm(); setTimeout(() => sfx.alarm(), 1100);
            bus.shake = Math.min(1, bus.shake + 0.5);
            lv.guard = { x: g.x, z: g.z, until: t + 30 };
            addL.push({ id: L.n++, gate: g, t0: t, value: a.value_gbp, kind: a.kind });
            const gbp = a.value_gbp ? ` · £${a.value_gbp.toFixed(2)}` : '';
            add.push({ id: L.n++, kind: 'alarm', text: 'beep beep beep!', sub: a.kind === 'skip_scan' ? `skip-scan at self-checkout${gbp}` : `unscanned items at gate ${g.id}${gbp}`, x: g.x, z: g.z, until: t + 6 });
          }
          for (const o of m.orders ?? []) {
            const mgr = roster.find((s) => s.role === 'manager');
            const w = mgr ? walkersOut.current[mgr.id] : null;
            const p = products[o.code];
            add.push({ id: L.n++, kind: 'order', text: `order placed: ${o.qty ? `${o.qty}× ` : ''}${p ? prodLabel(p).slice(0, 30) : o.code}`, sub: o.why, x: w?.pos.x ?? P.stockroom.door.x, z: w?.pos.z ?? P.stockroom.door.z, until: t + 5 });
            sfx.ding();
          }
        }
        if (add.length) setPops((cur) => [...cur.filter((x) => x.until > t), ...add].slice(-6));
        if (addL.length) setLifters((cur) => [...cur.filter((x) => t - x.t0 < 8), ...addL].slice(-3));
      }
      L.minute = mi;
      setRec(r);
      bus.stock = r?.stock ?? null;
    }
    lv.rec = r;
    if (pops.length && pops.some((p) => p.until < t)) setPops((cur) => cur.filter((x) => x.until > t));
  }, -1);

  const stockouts = useMemo(() => {
    if (!rec?.stock) return [];
    return Object.entries(rec.stock).filter(([, v]) => v < 0.05).map(([slot]) => ({ slot, p: productWorld(cfg, planogram, slot, null) })).filter((x) => x.p).slice(0, 8);
  }, [rec, cfg, planogram]);

  const on = (k: 'staff' | 'checkout' | 'cafe' | 'security') => show?.[k] !== false;
  return (
    <group>
      {on('staff') && <StaffCrew cfg={cfg} roster={roster} live={liveRef} planogram={planogram} walkersOut={walkersOut} />}
      {on('staff') && <Spills cfg={cfg} spills={rec?.spills} />}
      {on('checkout') && live && <Checkout cfg={cfg} live={liveRef} products={products} />}
      {on('cafe') && <Cafe cfg={cfg} live={liveRef} products={products} />}
      {on('security') && <Security cfg={cfg} lifters={lifters} live={liveRef} />}
      {stockouts.map(({ slot, p }) => (
        <Html key={slot} position={[p!.x, p!.y + 0.1, p!.z]} center zIndexRange={[12, 0]}>
          <div style={{ ...STICKER, background: '#FFE14D', transform: 'rotate(-4deg)' }} title={`ops stock for ${slot} < 5% (ops day log)`}>sold out!</div>
        </Html>
      ))}
      {pops.map((p) => (
        <Html key={p.id} position={[p.x, p.kind === 'alarm' ? 2.7 : 2.4, p.z]} center zIndexRange={[40, 30]}>
          <div style={{ ...STICKER, ...(p.kind === 'alarm' ? ALARM : ORDER), display: 'flex', flexDirection: 'column', alignItems: 'center', borderRadius: 14, padding: '4px 12px' }}>
            <b style={{ font: '800 15px "Baloo 2", system-ui' }}>{p.kind === 'alarm' ? '🚨 ' : '📦 '}{p.text}</b>
            {p.sub && <span style={{ font: '600 11px Inter, system-ui', opacity: 0.85 }}>{p.sub}</span>}
          </div>
        </Html>
      ))}
    </group>
  );
}

const STICKER: React.CSSProperties = {
  font: '800 13px "Baloo 2", system-ui', color: INK, background: '#fff', border: `2px solid ${INK}`, borderRadius: 999,
  padding: '2px 10px', boxShadow: `0 3px 0 ${INK}`, whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
};
const ALARM: React.CSSProperties = { background: '#ff2244', color: '#fff', boxShadow: `0 4px 0 ${INK}`, animation: 'none' };
const ORDER: React.CSSProperties = { background: '#fff', boxShadow: `0 4px 0 #6d28d9` };
