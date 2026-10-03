import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';

/** Where a number came from. Rule zero: every number on screen carries one of these. */
export type Source = {
  file: string; // repo path, e.g. data/sim/layout/summary.json
  field?: string; // json path inside it, e.g. summary.retailer.revenue.rel_ci95
  note?: string; // method / formula / caveat in plain words
  url?: string | (string | null | undefined)[] | null; // external evidence (OFF page, reddit thread, paper)
  kind?: 'assumption' | 'jev' | 'reddit' | 'off' | 'paper' | 'derived' | 'data';
};

type TipState = { src: Source; rect: DOMRect; pinned: boolean; id: number } | null;
let state: TipState = null;
const subs = new Set<(s: TipState) => void>();
const set = (s: TipState) => { state = s; subs.forEach((f) => f(s)); };
let seq = 0;

/** Wrap any number (or label) to make its source inspectable on hover, focus or click. */
export function S({ src, children, className = '', as = 'span', style }: { src: Source; children?: ReactNode; className?: string; as?: 'span' | 'div'; style?: CSSProperties }) {
  const ref = useRef<HTMLElement | null>(null);
  const id = useRef(++seq).current;
  const show = (pinned: boolean) => ref.current && set({ src, rect: ref.current.getBoundingClientRect(), pinned, id });
  const hide = () => { if (state && state.id === id && !state.pinned) set(null); };
  const Tag = as as 'span';
  const kind = src.kind || (/^assumption/i.test(src.note || '') ? 'assumption' : '');
  return (
    <Tag
      ref={ref as Ref<HTMLSpanElement>}
      className={`d-src ${kind ? `d-src-${kind}` : ''} ${className}`}
      style={style}
      tabIndex={0}
      role="button"
      aria-label={`source: ${src.file}${src.field ? ' → ' + src.field : ''}`}
      onMouseEnter={() => !(state && state.pinned) && show(false)}
      onMouseLeave={hide}
      onFocus={() => !(state && state.pinned) && show(false)}
      onBlur={hide}
      onClick={(e) => { e.stopPropagation(); if (state && state.id === id && state.pinned) set(null); else show(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(true); } }}
    >
      {children}
    </Tag>
  );
}

const urls = (u: Source['url']) => (Array.isArray(u) ? u : u ? [u] : []).filter((x): x is string => !!x && /^https?:/.test(x));

export function SourceTip() {
  const [s, setS] = useState<TipState>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    subs.add(setS);
    const close = () => set(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const outside = (e: MouseEvent) => { if (state?.pinned && box.current && !box.current.contains(e.target as Node)) close(); };
    const scroll = () => { if (state && !state.pinned) close(); };
    window.addEventListener('keydown', esc);
    window.addEventListener('click', outside);
    window.addEventListener('scroll', scroll, true);
    return () => { subs.delete(setS); window.removeEventListener('keydown', esc); window.removeEventListener('click', outside); window.removeEventListener('scroll', scroll, true); };
  }, []);
  useLayoutEffect(() => {
    if (!s || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = s.rect.left + s.rect.width / 2 - b.width / 2;
    left = Math.max(12, Math.min(vw - b.width - 12, left));
    let top = s.rect.bottom + 10;
    if (top + b.height > vh - 12) top = Math.max(12, s.rect.top - b.height - 10);
    setPos({ left, top });
  }, [s]);
  if (!s) return null;
  const { src } = s;
  const us = urls(src.url);
  return (
    <div ref={box} className={`d-tip ${s.pinned ? 'is-pinned' : ''}`} style={{ left: pos.left, top: pos.top }} role="tooltip" onClick={(e) => e.stopPropagation()}>
      <div className="d-tip-head">
        <span className="d-tip-label">source</span>
        {src.kind === 'assumption' || /^assumption/i.test(src.note || '') ? <span className="d-tip-flag">assumption</span> : null}
        {s.pinned ? <button className="d-tip-x" onClick={() => set(null)} aria-label="close source">esc</button> : <span className="d-tip-hint">click to pin</span>}
      </div>
      <code className="d-tip-file">{src.file}</code>
      {src.field ? <div className="d-tip-field">→ <code>{src.field}</code></div> : null}
      {src.note ? <p className="d-tip-note">{src.note}</p> : null}
      {us.length ? (
        <ul className="d-tip-urls">
          {us.slice(0, 4).map((u) => (
            <li key={u}><a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 64)}</a></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** pull http(s) URLs out of a free-text source string */
export function urlsIn(text?: string | null): string[] {
  if (!text) return [];
  return Array.from(new Set((text.match(/https?:\/\/[^\s'")\];,]+/g) || []).map((u) => u.replace(/[.)]+$/, ''))));
}
