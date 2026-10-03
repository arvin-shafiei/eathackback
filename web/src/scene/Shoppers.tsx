import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import type { Agent, Persona, Product } from '../types';
import { isAI } from '../types';
import { sampleTimeline, type Timeline } from '../layout';
import { archColor, DECISION, INK, BRAND_A } from '../theme';
import { archetypeOf } from '../stats';

export type ThoughtMode = 'off' | 'selected' | 'all';

interface Props {
  agents: Agent[];
  timelines: Record<string, Timeline>;
  timeRef: MutableRefObject<number>;
  personas: Record<string, Persona>;
  products: Record<string, Product>;
  selectedAgent: string | null;
  onAgent: (id: string) => void;
  onEvent: (agentId: string, step: number) => void;
  thoughts: ThoughtMode;
}

function Body({ ai, color, selected }: { ai: boolean; color: string; selected: boolean }) {
  return (
    <group>
      {ai ? (
        <group>
          <RoundedBox args={[0.5, 1.15, 0.42]} radius={0.12} position={[0, 0.72, 0]} castShadow>
            <meshStandardMaterial color={color} roughness={0.35} metalness={0.15} />
          </RoundedBox>
          <mesh position={[0, 1.42, 0]}><cylinderGeometry args={[0.015, 0.015, 0.22]} /><meshStandardMaterial color={INK} /></mesh>
          <mesh position={[0, 1.55, 0]}><sphereGeometry args={[0.05, 12, 12]} /><meshStandardMaterial color="#FFE14D" emissive="#FFE14D" emissiveIntensity={0.6} /></mesh>
          <mesh position={[0, 1.0, 0.215]}><planeGeometry args={[0.36, 0.14]} /><meshBasicMaterial color="#1a1030" /></mesh>
          {[-0.08, 0.08].map((x) => <mesh key={x} position={[x, 1.0, 0.22]}><circleGeometry args={[0.03, 12]} /><meshBasicMaterial color="#7CFFCB" /></mesh>)}
        </group>
      ) : (
        <group>
          <mesh position={[0, 0.78, 0]} castShadow>
            <capsuleGeometry args={[0.24, 0.9, 6, 16]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          {[-0.08, 0.08].map((x) => (
            <mesh key={x} position={[x, 1.2, 0.21]}><sphereGeometry args={[0.035, 10, 10]} /><meshBasicMaterial color={INK} /></mesh>
          ))}
        </group>
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.38, 0.5, 32]} />
          <meshBasicMaterial color={BRAND_A} />
        </mesh>
      )}
    </group>
  );
}

function Shopper({ agent, tl, timeRef, color, selected, onAgent }: { agent: Agent; tl: Timeline; timeRef: MutableRefObject<number>; color: string; selected: boolean; onAgent: (id: string) => void }) {
  const ref = useRef<THREE.Group>(null);
  const ai = isAI(agent);
  useFrame(() => {
    const g = ref.current; if (!g) return;
    const s = sampleTimeline(tl, timeRef.current);
    g.visible = s.visible;
    if (!s.visible) return;
    g.position.set(s.x, 0, s.z);
    // smooth turn
    const cur = g.rotation.y; let d = s.heading - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y = cur + d * 0.2;
    const walking = s.seg?.kind === 'move';
    g.children[0].position.y = walking ? Math.abs(Math.sin(timeRef.current * 9 + agent.agent_id.length)) * 0.05 : 0;
  });
  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onAgent(agent.agent_id); }} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      <Body ai={ai} color={color} selected={selected} />
    </group>
  );
}

interface Active { id: string; x: number; z: number; step: number; decision: keyof typeof DECISION; reason: string; product: string }

export function Shoppers({ agents, timelines, timeRef, personas, products, selectedAgent, onAgent, onEvent, thoughts }: Props) {
  const colors = useMemo(() => Object.fromEntries(agents.map((a) => [a.agent_id, archColor(isAI(a) ? 'ai' : archetypeOf(a, personas))])), [agents, personas]);
  const [active, setActive] = useState<Active[]>([]);
  const last = useRef({ t: 0, key: '' });
  useFrame((state) => {
    if (state.clock.elapsedTime - last.current.t < 0.1) return;
    last.current.t = state.clock.elapsedTime;
    const t = timeRef.current;
    const out: Active[] = [];
    for (const a of agents) {
      const tl = timelines[a.agent_id]; if (!tl) continue;
      const s = sampleTimeline(tl, t);
      const e = s.seg?.kind === 'dwell' ? s.seg.event : undefined;
      if (!s.visible || !e || e.decision === 'not_noticed') continue;
      out.push({ id: a.agent_id, x: s.x, z: s.z, step: e.step, decision: e.decision, reason: e.reason ?? '', product: e.product });
    }
    const key = out.map((o) => `${o.id}:${o.step}`).join('|');
    if (key !== last.current.key) { last.current.key = key; setActive(out); }
  });
  return (
    <group>
      {agents.map((a) => timelines[a.agent_id] && (
        <Shopper key={a.agent_id} agent={a} tl={timelines[a.agent_id]} timeRef={timeRef} color={colors[a.agent_id]} selected={selectedAgent === a.agent_id} onAgent={onAgent} />
      ))}
      {active.map((o) => {
        const d = DECISION[o.decision];
        const showThought = o.reason && (thoughts === 'all' || (thoughts === 'selected' && o.id === selectedAgent));
        const prod = products[o.product];
        return (
          <Html key={`${o.id}-${o.step}`} position={[o.x, 2.05, o.z]} center distanceFactor={11} zIndexRange={[20, 0]}>
            <div className="float-stack" onClick={() => onEvent(o.id, o.step)}>
              {showThought && (
                <div className={`thought ${o.id === selectedAgent ? 'is-sel' : ''}`}>
                  <span className="thought-prod">{prod ? prod.brand : o.product}</span>
                  {o.reason.length > 90 ? `${o.reason.slice(0, 88)}…` : o.reason}
                </div>
              )}
              <div className="sticker pop" style={{ ['--stk' as string]: d.color }}>
                <span aria-hidden>{d.emoji}</span> {d.label}
              </div>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
