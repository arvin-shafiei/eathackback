import { useMemo } from 'react';
import type { Arm, Product, Run } from '../types';
import { isAI } from '../types';
import { armFilter, pct, wilson } from '../stats';
import { catColor, prodLabel } from '../theme';
import { EngineBadge, type EngineInfo } from './engineBadge';

interface Row { code: string; k: number; n: number; note: string; big: string; tone: 'good' | 'warn' | 'ai' }

/** three headline counts, each a plain count of logged decisions in the loaded run(s) */
export function Leaderboard({ run, arm, products, onProduct, engine = null }: { run: Run; arm: Arm; products: Record<string, Product>; onProduct: (code: string) => void; engine?: EngineInfo | null }) {
  const rows = useMemo(() => {
    const per: Record<string, { shown: number; picked: number; walk: number; hs: number; hp: number; as: number; ap: number }> = {};
    for (const a of run.agents) {
      const inArm = armFilter(arm)(a), ai = isAI(a);
      for (const e of a.events) {
        if (!e.product) continue;
        const r = (per[e.product] ??= { shown: 0, picked: 0, walk: 0, hs: 0, hp: 0, as: 0, ap: 0 });
        if (inArm) { r.shown++; if (e.decision === 'pick') r.picked++; if (e.decision === 'walk_past') r.walk++; }
        if (ai) { r.as++; if (e.decision === 'pick') r.ap++; } else { r.hs++; if (e.decision === 'pick') r.hp++; }
      }
    }
    const list = Object.entries(per);
    const best = (f: (v: (typeof per)[string]) => number) => list.reduce<[string, (typeof per)[string]] | null>((b, x) => (!b || f(x[1]) > f(b[1]) ? x : b), null);
    const out: (Row & { title: string; emoji: string })[] = [];
    const mp = best((v) => v.picked + v.picked / (v.shown + 1));
    if (mp && mp[1].picked) out.push({ title: 'best seller', emoji: '🏆', code: mp[0], k: mp[1].picked, n: mp[1].shown, big: `${mp[1].picked}`, note: `bought by ${mp[1].picked} of ${mp[1].shown} who passed it`, tone: 'good' });
    const mw = best((v) => v.walk + v.walk / (v.shown + 1));
    if (mw && mw[1].walk) out.push({ title: 'most ignored', emoji: '👻', code: mw[0], k: mw[1].walk, n: mw[1].shown, big: `${mw[1].walk}`, note: `${mw[1].walk} of ${mw[1].shown} walked past it`, tone: 'warn' });
    // one population: people and ai agents are counted together (no separate gap card)
    return out;
  }, [run, arm]);

  return (
    <div className="leaderboard" role="list" aria-label="leaderboard">
      {rows.map((r) => {
        const p = products[r.code];
        return (
          <button key={r.title} role="listitem" className={`lb-card lb-${r.tone}`} onClick={() => r.code && onProduct(r.code)} disabled={!r.code} title={r.code ? 'counts of logged decisions in this run. click for the trace' : undefined}>
            <span className="lb-thumb" style={{ background: p ? catColor(p.category) : '#eee' }}>
              {p?.image ? <img src={p.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span aria-hidden>{r.emoji}</span>}
            </span>
            <span className="lb-body">
              <span className="lb-title">{r.title}</span>
              <span className="lb-name">{p ? prodLabel(p) : r.code || 'nothing yet'}</span>
              <span className="lb-note">{r.note}</span>
            </span>
            <span className="lb-big">{r.big}</span>
          </button>
        );
      })}
      <EngineBadge info={engine} className="lb-engine" />
    </div>
  );
}
