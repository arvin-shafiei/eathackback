// Café life. Occupancy comes from the ops day log (minutes[].cafe.occupied of .seats, scaled to this layout's chairs);
// everything a diner does on the way is presentation: walk in through the planter gap, join the FIFO queue
// (spaced slots), order at the counter ("flat white please ☕"), pay (beep), get the cup / plate (menu colour), walk
// to a free chair (chairs are a capacity resource; none free → wait up to wait_for_seat_max_min, then it's a
// takeaway), sit, sip and nibble, and leave when the log's occupancy drops. Replay shoppers that sit down are moved by
// the crowd (Crowd.tsx); a CROWD `cafe_enter` event (cafe/cafeState emitCafe) just pops their order at the counter.
// Spills: on sitting down with a hot drink the cup tips with spill_rate_per_1000_shoppers (×5 if bumped on the way,
// both labelled assumptions in data/ops/params.json) → coffee puddle + "oops!"; the cleaner (Staff.tsx) comes with
// mop + wet-floor sign and mops for spill_clean_and_dry_min. Time constants live in cafe/cafeState.ts.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Product, StoreConfig } from '../types';
import { storePlan } from '../layout';
import { productMaterials, canvasTex } from './textures';
import { INKM, Person, WetFloor, type OpsLive, type Walker } from './Staff';
import { Diners, type D, type Phase, type XZ } from './cafe/Diners';
import { TextSprite } from './cafe/TextSprite';
import { getActiveOpsDay } from '../ops';
import { sfx } from './fx';
import { onCrowd } from './crowdBus';
import { buildMenu, orderLine, type MenuItem } from './cafe/menu';
import {
  addCafeSpill, cafeSpills, clearCafeSpills, onCafe, onSpills, pruneCafeSpills, spillsChanged,
  CLEAN_DRY_S, DWELL_S, ORDER_S, PAY_S, RESPONSE_TARGET_S, SPILL_BUMP_MULT, SPILL_DEMO_MULT, SPILL_P_BASE, WAIT_SEAT_S, type CafeSpill,
} from './cafe/cafeState';

/** assumption (presentation): replay walking speed of a diner, m per replay s */
const SPEED = 1.7;
const COLORS = ['#f6a6b2', '#ffc98a', '#a7d8f0', '#b8e0a8', '#d7c2f2', '#f2d38a', '#9fd6cf', '#f0b6d8'];
const CAFE_CATS = ['snack_bars', 'biscuits_chocolate', 'soft_drinks', 'ready_meals_soup', 'bakery_bread', 'yoghurt', 'hot_drinks', 'confectionery_sweets'];
const PACK = new THREE.BoxGeometry(0.16, 0.2, 0.1);
/** extra diners beyond the chairs: the queue + takeaways (presentation pool) */
const POOL_EXTRA = 14;

interface Props { cfg: StoreConfig; live: MutableRefObject<OpsLive>; products: Record<string, Product> }

export function Cafe({ cfg, live, products }: Props) {
  const P = storePlan(cfg);
  const c = P.cafe;
  const menu = useMemo(() => buildMenu(products), [products]);
  const drinks = useMemo(() => menu.filter((m) => m.kind === 'drink'), [menu]);
  const bites = useMemo(() => menu.filter((m) => m.kind === 'bite'), [menu]);
  // ops diners fill chairs from the far end (replay shoppers start at chair 0)
  // spread out: one diner per table first (far tables first), then the second chair at each, …
  const fillOrder = useMemo(() => {
    const k = c.seats.map((s, i) => ({ i, nth: c.seats.slice(0, i).filter((o) => o.table === s.table).length, tb: s.table }));
    return k.sort((a, b) => a.nth - b.nth || b.tb - a.tb).map((x) => x.i);
  }, [c.seats]);
  const pool = useMemo<D[]>(() => Array.from({ length: c.seats.length + POOL_EXTRA }, (_, i) => ({
    i, phase: 'off', x: 0, z: 0, yaw: 0, path: [], tPhase: 0, seat: -1,
    drink: drinks[i % Math.max(1, drinks.length)] ?? menu[0], bite: i % 3 === 1 ? null : bites[(i * 5) % Math.max(1, bites.length)] ?? null,
    color: COLORS[(i * 5) % COLORS.length], order: (i * 7) % 4, bumped: false, walking: false, carrying: false, takeaway: false, tSit: 0, slot: -1,
  })), [c.seats.length, drinks, bites, menu]);
  const seatBy = useRef<number[]>([]);
  if (seatBy.current.length !== c.seats.length) seatBy.current = c.seats.map(() => -1);
  const line = useRef<number[]>([]); // FIFO: diner indices, head first
  const lastT = useRef(0), lastSpawn = useRef(-99), nextName = useRef(0);
  const barX = useRef(0); // barista: 0 at the till, 1 at the machine
  const bubbleHold = useRef({ text: '', until: -1, pay: false });
  const occTxt = useRef('');
  /** chairs held by replay shoppers the crowd walks in itself (seat → replay t they get up) */
  const crowdSeat = useRef<number[]>([]);
  if (crowdSeat.current.length !== c.seats.length) crowdSeat.current = c.seats.map(() => -1);
  const machineBusy = useRef(0), hadRec = useRef(false);

  const rack = useMemo(() => {
    const ps = Object.values(products);
    const pl = ps.filter((p) => p.image && CAFE_CATS.includes(p.category));
    const use = (pl.length >= 6 ? pl : ps.filter((p) => p.image).length ? ps.filter((p) => p.image) : ps).slice(0, 12);
    return use.map((p) => ({ code: p.code, mats: productMaterials(p) }));
  }, [products]);

  // geometry: queue runs from the till toward the café's open side, then down the side; the planter gap at the lobby
  // is the door
  const lobby = Math.min(P.bounds.zMax - 1.2, (P.lobbyZ ?? c.z + c.d / 2 - 1.5));
  const sideX = c.x + c.w / 2 - 0.55;
  const corrZ = c.counter.z + 0.95;
  const door: XZ = { x: c.x + c.w / 2 + 1.3, z: lobby };
  const inside: XZ = { x: sideX, z: lobby };
  const head: XZ = { x: c.counter.x + 0.35, z: corrZ };
  const slotPos = (k: number): XZ => {
    const along = Math.max(1, Math.floor((sideX - head.x) / 0.72));
    if (k < along) return { x: head.x + k * 0.72, z: corrZ };
    return { x: sideX, z: corrZ + (k - along + 1) * 0.72 };
  };
  const laneX = (si: number) => { const s = c.seats[si], t = c.tables[s.table] ?? s; return s.x < t.x ? t.x - 1.1 : t.x + 1.1; };
  const pathToSeat = (si: number): XZ[] => { const s = c.seats[si]; const lx = laneX(si); return [{ x: lx, z: corrZ }, { x: lx, z: s.z }, { x: s.x, z: s.z }]; };
  const pathOut = (d: D): XZ[] => d.seat >= 0 ? [{ x: laneX(d.seat), z: c.seats[d.seat].z }, { x: laneX(d.seat), z: lobby }, inside, door] : [{ x: sideX, z: Math.max(d.z, corrZ) }, inside, door];
  const waitSpot = (k: number): XZ => ({ x: c.counter.x - 1.9 - (k % 3) * 0.55, z: corrZ + 0.1 + Math.floor(k / 3) * 0.5 });

  // a replay shopper reached the café: pop their order at the counter
  useEffect(() => onCafe((e) => {
    const m = drinks[(nextName.current++) % Math.max(1, drinks.length)];
    if (m) { bubbleHold.current = { text: orderLine(m, nextName.current), until: live.current.t + 2.2, pay: false }; sfx.beep(); }
    void e;
  }), [drinks, live]);
  // a crowd bump near walking diners counts as "bumped" for the spill multiplier; a replay shopper entering the café
  // (CROWD cafe_enter) orders at the counter and holds their chair until tEnd, so our own diners leave it free
  useEffect(() => onCrowd((e) => {
    if (e.type === 'cafe_enter') {
      const m = drinks[(nextName.current++) % Math.max(1, drinks.length)];
      if (m) { bubbleHold.current = { text: orderLine(m, nextName.current), until: live.current.t + 2.2, pay: false }; sfx.beep(); machineBusy.current = live.current.t + 2.5; }
      if (e.seat != null && e.seat >= 0 && e.seat < c.seats.length) crowdSeat.current[e.seat] = e.tEnd;
      return;
    }
    if (e.type !== 'bonk') return;
    for (const d of pool) if (d.walking && Math.hypot(d.x - e.x, d.z - e.z) < 1.2) d.bumped = true;
  }), [pool, drinks, live, c.seats.length]);

  // debug / screenshot hook: window.__cafe.focus() frames the café
  const camera = useThree((s) => s.camera), controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const w = window as unknown as { __cafe?: Record<string, unknown> };
    w.__cafe = { ...(w.__cafe ?? {}), pool, plan: c, t: () => live.current.t, focus: () => { camera.position.set(c.x + c.w * 0.25, 8.5, c.z + c.d * 0.5 + 1.5); controls?.target.set(c.x, 0.4, c.z - c.d * 0.12); controls?.update(); } };
  }, [camera, controls, c, pool, live]);

  const setPhase = (d: D, ph: Phase, t: number, path: XZ[] = []) => { d.phase = ph; d.tPhase = t; d.path = path; };
  const freeSeat = () => fillOrder.find((si) => seatBy.current[si] < 0 && crowdSeat.current[si] < live.current.t);

  useFrame((_, __) => {
    const L = live.current, t = L.t, dtR = L.dtR;
    const rec = L.rec;
    const seatsOps = rec?.cafe?.seats ?? 0, occOps = rec?.cafe?.occupied ?? 0;
    // never an empty café in a demo: below the day's own mean occupancy (from the same ops log) we self-spawn up to it;
    // no log at all → FALLBACK_OCC (assumption). Chairs the crowd's own shoppers hold count toward the total.
    const floor01 = dayMeanOcc(getActiveOpsDay());
    const frac = Math.max(seatsOps ? occOps / seatsOps : 0, floor01);
    let crowdHeld = 0; for (const u of crowdSeat.current) if (u >= t) crowdHeld++;
    const want = Math.max(0, Math.min(c.seats.length, Math.round(frac * c.seats.length)) - crowdHeld);
    const jump = L.jump || t < lastT.current - 0.01 || (!!rec && !hadRec.current);
    hadRec.current = !!rec;
    lastT.current = t;
    if (jump) {
      // snap after a scrub: the log's diners already seated, nobody walking, floor dry
      for (const d of pool) { d.phase = 'off'; d.path = []; d.seat = -1; d.walking = false; d.carrying = false; }
      seatBy.current.fill(-1); line.current = []; clearCafeSpills();
      for (let k = 0; k < want; k++) {
        const d = pool[k], si = fillOrder[k];
        d.seat = si; seatBy.current[si] = k; setPhase(d, 'sit', t); d.tSit = t - (k * 7) % 40; d.x = c.seats[si].x; d.z = c.seats[si].z; d.yaw = c.seats[si].yaw;
      }
    }
    // ---- demand: seated + on the way vs the log's occupancy
    let committed = 0, seated = 0;
    for (const d of pool) {
      if (d.phase === 'sit') { seated++; committed++; }
      else if (!d.takeaway && (d.phase === 'queue' || d.phase === 'order' || d.phase === 'pay' || d.phase === 'wait' || d.phase === 'toSeat')) committed++;
    }
    if (dtR > 0 && committed < want && t - lastSpawn.current > 0.45) {
      const d = pool.find((x) => x.phase === 'off');
      if (d) {
        lastSpawn.current = t;
        d.drink = drinks[(nextName.current * 3 + d.i) % Math.max(1, drinks.length)] ?? menu[0];
        d.bite = (nextName.current + d.i) % 3 === 1 ? null : bites[(nextName.current + d.i) % Math.max(1, bites.length)] ?? null;
        nextName.current++;
        d.x = door.x; d.z = door.z; d.bumped = false; d.takeaway = false; d.carrying = false; d.seat = -1;
        line.current.push(d.i);
        setPhase(d, 'queue', t, [inside]);
      }
    }
    // the log says people left: whoever has sat longest gets up (after at least a few replay s)
    if (seated > want) {
      let best: D | null = null;
      for (const d of pool) if (d.phase === 'sit' && t - d.tPhase > 3 && (!best || d.tSit < best.tSit)) best = d;
      if (best) { if (best.seat >= 0) seatBy.current[best.seat] = -1; setPhase(best, 'leave', t, pathOut(best)); best.seat = -1; }
    }
    // diners turn over after the params dwell (assumption) — the log only fixes how many chairs are full
    for (const d of pool) if (d.phase === 'sit' && t - d.tSit > DWELL_S) { if (d.seat >= 0) seatBy.current[d.seat] = -1; setPhase(d, 'leave', t, pathOut(d)); d.seat = -1; }

    // ---- queue: slots follow FIFO order
    line.current = line.current.filter((k) => pool[k].phase === 'queue' || pool[k].phase === 'order' || pool[k].phase === 'pay');
    const counterBusy = line.current.length > 0 && (pool[line.current[0]].phase === 'order' || pool[line.current[0]].phase === 'pay');
    line.current.forEach((k, pos) => {
      const d = pool[k];
      if (d.phase !== 'queue') return;
      if (d.slot !== pos) {
        d.slot = pos; const s = slotPos(pos);
        // still outside the café: come in through the gap and up the side first
        d.path = d.path.length && d.path[0] === inside ? [inside, { x: sideX, z: Math.max(corrZ, s.z) }, s] : [s];
      }
      if (pos === 0 && !counterBusy && !d.path.length) { setPhase(d, 'order', t); d.yaw = Math.PI; bubbleHold.current = { text: orderLine(d.drink, d.i + nextName.current), until: t + ORDER_S, pay: false }; }
    });
    for (const k of line.current) {
      const d = pool[k];
      if (d.phase === 'order' && t - d.tPhase >= ORDER_S) {
        setPhase(d, 'pay', t); sfx.beep(); machineBusy.current = t + ORDER_S + PAY_S;
        bubbleHold.current = { text: `£${(d.drink.price + (d.bite?.price ?? 0)).toFixed(2)} · beep!`, until: t + PAY_S + 0.4, pay: true };
      } else if (d.phase === 'pay' && t - d.tPhase >= PAY_S) {
        d.carrying = true; d.slot = -1;
        const si = freeSeat();
        if (si !== undefined) { d.seat = si; seatBy.current[si] = d.i; setPhase(d, 'toSeat', t, pathToSeat(si)); }
        else { const k2 = pool.filter((x) => x.phase === 'wait').length; setPhase(d, 'wait', t, [waitSpot(k2)]); }
      }
    }
    // ---- everyone else
    for (const d of pool) {
      if (d.phase === 'wait') {
        const si = freeSeat();
        if (si !== undefined) { d.seat = si; seatBy.current[si] = d.i; setPhase(d, 'toSeat', t, pathToSeat(si)); }
        else if (t - d.tPhase > WAIT_SEAT_S) { d.takeaway = true; setPhase(d, 'leave', t, pathOut(d)); } // no seat: take it away
      }
      // walk
      d.walking = false;
      if (d.phase !== 'off' && d.phase !== 'sit' && dtR > 0) {
        let budget = SPEED * dtR;
        while (budget > 0 && d.path.length) {
          const n = d.path[0], dx = n.x - d.x, dz = n.z - d.z, dist = Math.hypot(dx, dz);
          if (dist < 1e-3) { d.path.shift(); continue; }
          const st = Math.min(dist, budget);
          d.x += (dx / dist) * st; d.z += (dz / dist) * st; budget -= st;
          const yw = Math.atan2(dx, dz); d.yaw += Math.atan2(Math.sin(yw - d.yaw), Math.cos(yw - d.yaw)) * 0.3;
          d.walking = true;
          if (st >= dist) d.path.shift();
        }
      }
      if (d.phase === 'queue' && !d.walking) d.yaw += Math.atan2(Math.sin(Math.PI - d.yaw), Math.cos(Math.PI - d.yaw)) * 0.15; // face the till
      if (d.phase === 'toSeat' && !d.path.length) {
        const s = c.seats[d.seat];
        setPhase(d, 'sit', t); d.tSit = t; d.yaw = s.yaw; d.x = s.x; d.z = s.z;
        // the tip-over roll: params spill rate per trip, ×5 if bumped (both assumptions); ?cafespill=N is a demo boost
        const p = SPILL_P_BASE * (d.bumped ? SPILL_BUMP_MULT : 1) * SPILL_DEMO_MULT;
        if (Math.random() < p) {
          const tb = c.tables[s.table] ?? s;
          const sp = addCafeSpill(s.x + (tb.x - s.x) * 0.5, s.z + 0.55, t, d.bumped);
          if (sp) sfx.nope();
        }
      }
      if (d.phase === 'leave' && !d.path.length) { d.phase = 'off'; d.carrying = false; }
    }
    // bumps between walking diners (cups slosh)
    for (let a = 0; a < pool.length; a++) {
      const A = pool[a]; if (!A.walking || !A.carrying) continue;
      for (let b = 0; b < pool.length; b++) { if (a === b) continue; const B = pool[b]; if (B.phase === 'off') continue; if (Math.abs(A.x - B.x) < 0.42 && Math.abs(A.z - B.z) < 0.42) { A.bumped = true; break; } }
    }
    // café porter: the roster cleaner (Staff.tsx) gets first dibs; a spill still unclaimed after PORTER_WAIT_S is ours.
    // walks over with mop + bucket, puts the sign up, mops for spill_clean_and_dry_min (params, assumption), walks back.
    {
      const pw = porter.current!, pt = porterTask.current;
      let sp = pt.id ? cafeSpills.find((x) => x.id === pt.id && x.state !== 'done') : undefined;
      if (!sp) { pt.id = 0; sp = cafeSpills.find((x) => x.state !== 'done' && (!x.claimed || x.claimed === PORTER_ID) && t - x.t0 > PORTER_WAIT_S); if (sp) { pt.id = sp.id; sp.claimed = PORTER_ID; } }
      const goal = sp ? { x: sp.x + 0.75, z: sp.z + 0.1 } : porterHome;
      const dx = goal.x - pw.pos.x, dz = goal.z - pw.pos.z, dist = Math.hypot(dx, dz);
      pw.moving = dist > 0.05 && dtR > 0;
      if (pw.moving) { const st = Math.min(dist, SPEED * 1.2 * dtR); pw.pos.x += (dx / dist) * st; pw.pos.z += (dz / dist) * st; pw.yaw = Math.atan2(dx, dz); }
      pw.task = sp && dist < 0.1 ? 'clean' : 'walk';
      if (sp && dist < 0.1 && dtR > 0) {
        pw.yaw = Math.atan2(sp.x - pw.pos.x, sp.z - pw.pos.z);
        if (sp.state === 'open') { sp.state = 'cleaning'; sp.tClean = t; spillsChanged(); }
        else if (t - sp.tClean >= CLEAN_DRY_S) { sp.state = 'done'; sp.tDone = t; sp.claimed = null; pt.id = 0; spillsChanged(); }
      }
      if (jump) { pw.pos.set(porterHome.x, 0, porterHome.z); pt.id = 0; }
    }
    // safety net (nobody reached it, e.g. paused porter): dry after the response target (assumption) + mop time
    for (const sp of cafeSpills) if (sp.state !== 'done' && t - sp.t0 > RESPONSE_TARGET_S + CLEAN_DRY_S) { sp.state = 'done'; sp.tDone = t; spillsChanged(); }
    pruneCafeSpills(t);

    // ---- barista + bubble + occupancy sticker
    const want01 = t < machineBusy.current ? 1 : 0;
    barX.current += (want01 - barX.current) * Math.min(1, 0.08);
    const bw = barista.current!; bw.pos.x = c.counter.x + 0.3 + barX.current * 0.5; bw.moving = Math.abs(want01 - barX.current) > 0.05; bw.yaw = bw.moving ? (want01 ? Math.PI / 2 : -Math.PI / 2) : 0;
    const qn = line.current.length;
    // chairs actually full on screen (ours + the crowd's) out of this layout's chairs; the log's own seats/occupied are in the KPI panel
    occTxt.current = `café ${Math.min(c.seats.length, seated + crowdHeld)}/${c.seats.length}${qn ? ` · ${qn} in line` : ''}${(rec?.cafe?.turned_away ?? 0) > 0 ? ' · full!' : ''}`;
  });

  const porterHome: XZ = { x: c.x - c.w / 2 + 0.7, z: corrZ };
  const porter = useRef<Walker | null>({ pos: new THREE.Vector3(porterHome.x, 0, porterHome.z), yaw: Math.PI / 2, path: [], goal: '', body: null, moving: false, task: 'idle', work: 0 });
  const porterTask = useRef({ id: 0 });
  const barista = useRef<Walker | null>({ pos: new THREE.Vector3(c.counter.x + 0.3, 0, c.counter.z - 0.75), yaw: 0, path: [], goal: '', body: null, moving: false, task: 'serve', work: 0 });

  const rackX = c.counter.x + Math.min(2.2, c.w / 2 - 0.6), rackZ = c.counter.z + 0.05;
  if (!c.seats.length) return null;
  return (
    <group>
      <Person role="barista" wref={barista} />
      <Person role="cleaner" wref={porter} />
      <CoffeeMachine x={c.counter.x + 0.8} z={c.counter.z - 0.1} busy={() => live.current.t < machineBusy.current} />
      <MenuBoard x={c.counter.x - Math.min(2.6, c.w / 2 - 0.9)} z={c.counter.z - 0.25} menu={menu} />
      {/* grab & go rack: three tiers of real packs */}
      <group position={[rackX, 0, rackZ]}>
        <mesh position={[0, 0.7, -0.05]} castShadow raycast={noRay}><boxGeometry args={[0.9, 1.4, 0.06]} /><meshStandardMaterial color="#fffaf5" /></mesh>
        <mesh position={[0, 1.48, 0]} raycast={noRay}><boxGeometry args={[0.94, 0.16, 0.5]} /><meshStandardMaterial color="#FF4079" /></mesh>
        {[0.35, 0.75, 1.15].map((y, r) => (
          <group key={y}>
            <mesh position={[0, y - 0.02, 0.18]} raycast={noRay}><boxGeometry args={[0.9, 0.03, 0.42]} /><meshStandardMaterial color="#e9dfd8" /></mesh>
            {rack.slice(r * 4, r * 4 + 4).map((p, i) => (
              <mesh key={p.code + i} position={[-0.31 + i * 0.205, y + 0.1, 0.25]} geometry={PACK} material={p.mats} castShadow raycast={noRay} />
            ))}
          </group>
        ))}
        {[-0.46, 0.46].map((x) => <mesh key={x} position={[x, 0.75, 0.18]} material={INKM} raycast={noRay}><boxGeometry args={[0.03, 1.5, 0.44]} /></mesh>)}
      </group>
      {/* takeaway cups on the counter */}
      {[-1.45, -1.32, -1.19].map((x, i) => (
        <mesh key={x} position={[c.counter.x + x, 1.07, c.counter.z + 0.2]} raycast={noRay}>
          <cylinderGeometry args={[0.045, 0.035, 0.13 + i * 0.01, 12]} /><meshStandardMaterial color={i === 1 ? '#FE831B' : '#ffffff'} />
        </mesh>
      ))}
      <Diners pool={pool} seats={c.seats} tables={c.tables} />
      <CafeSpills />
      <TextSprite position={[head.x, 2.3, head.z - 0.2]} height={0.4}
        text={() => (live.current.t < bubbleHold.current.until ? bubbleHold.current.text : '')}
        style={() => ({ bg: bubbleHold.current.pay ? '#d6ff3d' : '#ffffff', tilt: -0.05 })} />
      <TextSprite position={[rackX + 0.2, 2.35, rackZ + 0.3]} height={0.46} text={() => occTxt.current} style={() => OCC_STYLE} />
    </group>
  );
}

const OCC_STYLE = { bg: '#ffe6cc' };
const PORTER_ID = 'cafe-porter';
/** presentation: replay s a café spill waits for the roster cleaner before the café's own porter goes */
const PORTER_WAIT_S = 1.5;
/** assumption (no ops log loaded): share of café chairs taken, so the demo café is never empty */
const FALLBACK_OCC = 0.3;
const meanCache = new WeakMap<object, number>();
/** mean café occupancy share over the day's open minutes, from the ops log itself (minutes[].cafe) */
function dayMeanOcc(day: ReturnType<typeof getActiveOpsDay>): number {
  if (!day) return FALLBACK_OCC;
  const hit = meanCache.get(day); if (hit !== undefined) return hit;
  let sum = 0, n = 0;
  for (const m of day.minutes) { const se = m.cafe?.seats ?? 0; if (se > 0) { sum += (m.cafe?.occupied ?? 0) / se; n++; } }
  const v = n && sum > 0 ? sum / n : FALLBACK_OCC;
  meanCache.set(day, v);
  return v;
}

// ---------------------------------------------------------------- props
const STEAM = new THREE.SphereGeometry(0.05, 8, 6);

function CoffeeMachine({ x, z, busy }: { x: number; z: number; busy: () => boolean }) {
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(() => Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })), []);
  const light = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => {
    const now = st.clock.elapsedTime, on = busy();
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const k = (now * (on ? 0.9 : 0.35) + i / 6) % 1;
      m.position.set(Math.sin(now * 3 + i * 2) * 0.06 + (i % 2 ? 0.08 : -0.08), 1.55 + k * (on ? 0.9 : 0.4), 0.05);
      m.scale.setScalar((0.5 + k * 1.6) * (on ? 1.3 : 0.7));
      mats[i].opacity = (1 - k) * (on ? 0.75 : 0.3);
    });
    if (light.current) light.current.emissiveIntensity = on ? 1 + Math.sin(now * 12) * 0.5 : 0.3;
  });
  return (
    <group position={[x, 0, z]}>
      {/* chrome espresso machine (decor) with two group heads + a glowing "brewing" light */}
      <mesh position={[0, 1.27, 0]} raycast={noRay}><boxGeometry args={[0.62, 0.5, 0.42]} /><meshStandardMaterial color="#d84a3a" roughness={0.35} metalness={0.3} /></mesh>
      <mesh position={[0, 1.54, 0]} raycast={noRay}><boxGeometry args={[0.64, 0.05, 0.44]} /><meshStandardMaterial color="#c9cfdc" metalness={0.7} roughness={0.2} /></mesh>
      {[-0.15, 0.15].map((dx) => <mesh key={dx} position={[dx, 1.12, 0.24]} raycast={noRay}><cylinderGeometry args={[0.05, 0.05, 0.08, 12]} /><meshStandardMaterial color="#2a2230" /></mesh>)}
      <mesh position={[0.22, 1.42, 0.215]} raycast={noRay}><sphereGeometry args={[0.03, 10, 8]} /><meshStandardMaterial ref={light} color="#7dff7a" emissive="#7dff7a" emissiveIntensity={0.3} /></mesh>
      {mats.map((m, i) => <mesh key={i} ref={(r) => { puffs.current[i] = r; }} geometry={STEAM} material={m} raycast={noRay} />)}
    </group>
  );
}

function MenuBoard({ x, z, menu }: { x: number; z: number; menu: MenuItem[] }) {
  const tex = useMemo(() => canvasTex(512, 640, (ctx) => {
    ctx.fillStyle = '#2a2230'; ctx.fillRect(0, 0, 512, 640);
    ctx.strokeStyle = '#e8c39a'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 496, 624);
    ctx.fillStyle = '#ffe14d'; ctx.font = '800 58px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.fillText('☕ menu', 256, 76);
    ctx.font = '600 17px Inter, system-ui'; ctx.fillStyle = '#c9b8a8'; ctx.fillText('real catalog items · shelf prices (assumption)', 256, 104);
    let y = 150;
    const section = (title: string, items: MenuItem[]) => {
      if (!items.length) return;
      ctx.textAlign = 'left'; ctx.fillStyle = '#FE831B'; ctx.font = '800 30px "Baloo 2", system-ui'; ctx.fillText(title, 30, y); y += 40;
      for (const m of items) {
        ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(40, y - 9, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = '700 25px Inter, system-ui'; ctx.textAlign = 'left'; ctx.fillText(m.name.slice(0, 24), 60, y);
        ctx.textAlign = 'right'; ctx.fillStyle = '#d6ff3d'; ctx.fillText(`£${m.price.toFixed(2)}`, 488, y); y += 40;
      }
      y += 8;
    };
    section('drinks', menu.filter((m) => m.kind === 'drink'));
    section('bites', menu.filter((m) => m.kind === 'bite'));
  }), [menu]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.85, 0]} raycast={noRay}><planeGeometry args={[1.5, 1.875]} /><meshBasicMaterial map={tex} /></mesh>
      <mesh position={[0, 1.85, -0.03]} material={INKM} raycast={noRay}><boxGeometry args={[1.6, 1.97, 0.04]} /></mesh>
      {[-0.6, 0.6].map((dx) => <mesh key={dx} position={[dx, 0.45, -0.03]} material={INKM} raycast={noRay}><boxGeometry args={[0.05, 0.9, 0.05]} /></mesh>)}
    </group>
  );
}

/** café spills: coffee puddle + tipped cup + "oops!", wet-floor sign once the cleaner's on it, fades as it dries */
function CafeSpills() {
  const [, bump] = useState(0);
  useEffect(() => onSpills(() => bump((n) => n + 1)), []);
  return <>{cafeSpills.map((sp) => <CafeSpillView key={sp.id} sp={sp} />)}</>;
}
function CafeSpillView({ sp }: { sp: CafeSpill }) {
  // tooltip-free label; source: spill_rate_per_1000_shoppers = 2, ×5 when bumped (assumptions, data/ops/params.json)
  return (
    <group>
      <WetFloor x={sp.x} z={sp.z} cleaning={sp.state === 'cleaning'} color="#6b3f22" sign={sp.state !== 'open'} fade={() => (sp.state === 'done' ? 0 : 1)} size={0.75} />
      {sp.state !== 'done' && (
        <mesh position={[sp.x + 0.25, 0.05, sp.z - 0.1]} rotation={[0, 0.4, Math.PI / 2]} raycast={noRay}>
          <cylinderGeometry args={[0.05, 0.04, 0.11, 12]} /><meshStandardMaterial color="#ffffff" />
        </mesh>
      )}
      <TextSprite position={[sp.x, 1.4, sp.z]} height={0.42} text={() => (sp.state === 'open' ? (sp.bumped ? 'oops! (bumped)' : 'oops!') : sp.state === 'cleaning' ? 'mopping…' : '')}
        style={() => ({ bg: sp.state === 'open' ? '#ff8a3d' : '#ffe14d', fg: sp.state === 'open' ? '#ffffff' : undefined, tilt: 0.08 })} />
    </group>
  );
}

const noRay = () => null;
