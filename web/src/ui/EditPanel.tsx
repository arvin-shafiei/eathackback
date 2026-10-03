import { Fragment, useState } from 'react';
import type { Planogram, Product, StoreConfig } from '../types';
import { catColor, catLabel } from '../theme';

interface Props {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  changed: Set<string>; selected: string | null;
  onSwap: (a: string, b: string) => void; onSelect: (slot: string | null) => void;
  onReset: () => void; onRerun: () => void; rerunState: { busy: boolean; msg: string | null; ok?: boolean };
  moves: string[]; useLLM: boolean; onUseLLM: (v: boolean) => void;
}

export function EditPanel({ cfg, planogram, products, changed, selected, onSwap, onSelect, onReset, onRerun, rerunState, moves, useLLM, onUseLLM }: Props) {
  const [over, setOver] = useState<string | null>(null);
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const download = () => {
    const blob = new Blob([JSON.stringify(planogram, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'planogram.edited.json'; a.click();
  };
  return (
    <section className="card edit" aria-label="planogram editor">
      <div className="edit-top">
        <div>
          <h2 className="display">move things around</h2>
          <p className="muted">drag a product set onto another slot to swap them, or click two slots on the shelves. then re-run the shoppers.</p>
        </div>
        <div className="edit-actions">
          <label className="toggle llm" title="off = rule-based shoppers, free. on = real llm calls via openrouter (costs money, cached)"><input type="checkbox" checked={useLLM} onChange={(e) => onUseLLM(e.target.checked)} /> use llm (costs)</label>
          <button className="btn btn-white" onClick={download}>download json</button>
          <button className="btn btn-white" onClick={onReset} disabled={!changed.size}>reset</button>
          <button className="btn btn-brand" onClick={onRerun} disabled={!changed.size || rerunState.busy}>{rerunState.busy ? 're-running…' : 're-run shoppers'}</button>
        </div>
      </div>
      {rerunState.msg && <p className={`notice ${rerunState.ok ? 'ok' : ''}`} role="status">{rerunState.msg}</p>}
      <div className="grid" style={{ gridTemplateColumns: `64px repeat(${cfg.units.length}, minmax(96px, 1fr))` }}>
        <div />
        {cfg.units.map((u) => (
          <div key={u.id} className="grid-head"><span className="dot" style={{ background: catColor(u.category) }} />{u.id} <span className="muted">{catLabel(u.category)}</span></div>
        ))}
        {rows.map((r) => (
          <Fragment key={r}>
            <div className="grid-row-h">{cfg.row_names[String(r)] ?? `row ${r}`}</div>
            {cfg.units.map((u) => {
              const slot = `${u.id}-r${r}`;
              const set = planogram[slot];
              return (
                <div
                  key={slot}
                  className={`cell ${changed.has(slot) ? 'is-changed' : ''} ${selected === slot ? 'is-sel' : ''} ${over === slot ? 'is-over' : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', slot); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); setOver(slot); }}
                  onDragLeave={() => setOver((o) => (o === slot ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); const from = e.dataTransfer.getData('text/plain'); if (from && from !== slot) onSwap(from, slot); }}
                  onClick={() => onSelect(slot)}
                  title={slot}
                >
                  {(set?.products ?? []).map((c) => (
                    <div key={c} className="cell-prod">
                      <span className="sw" style={{ background: products[c]?.color || catColor(products[c]?.category ?? set.category) }} />
                      <span className="nm">{products[c]?.brand ?? c}</span>
                      <span className="fc">×{set.facings?.[c] ?? 1}</span>
                    </div>
                  ))}
                  {!set && <span className="muted">empty</span>}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      {!!moves.length && <p className="moves"><b>{moves.length} move{moves.length > 1 ? 's' : ''}:</b> {moves.join(' · ')}</p>}
    </section>
  );
}
