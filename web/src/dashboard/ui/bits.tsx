import type { ReactNode } from 'react';
import { S, type Source } from '../lib/src';
import { clamp, pct } from '../lib/stats';

export function Card({ title, sub, children, foot, className = '', right, id }: {
  title?: ReactNode; sub?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string; right?: ReactNode; id?: string;
}) {
  return (
    <section className={`d-card ${className}`} id={id}>
      {title || right ? (
        <header className="d-card-head">
          <div>
            {title ? <h3 className="d-card-title">{title}</h3> : null}
            {sub ? <p className="d-card-sub">{sub}</p> : null}
          </div>
          {right ? <div className="d-card-right">{right}</div> : null}
        </header>
      ) : null}
      {children}
      {foot ? <footer className="d-foot">{foot}</footer> : null}
    </section>
  );
}

export function Sticker({ children, tone = 'white', title }: { children: ReactNode; tone?: 'white' | 'ink' | 'brand' | 'yellow' | 'ai' | 'good' | 'bad' | 'dim'; title?: string }) {
  return <span className={`d-sticker d-sticker-${tone}`} title={title}>{children}</span>;
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="d-state" aria-busy="true">
      <div className="d-skel" /><div className="d-skel short" /><div className="d-skel" />
      <p className="d-state-text">loading {what}…</p>
    </div>
  );
}

export function ErrorBox({ error, hint }: { error: string; hint?: ReactNode }) {
  return (
    <div className="d-state d-state-error" role="alert">
      <p className="d-state-title">couldn't load this</p>
      <p className="d-state-text"><code>{error}</code></p>
      {hint ? <p className="d-state-text">{hint}</p> : <p className="d-state-text">run <code>cd web && node scripts/sync-dashboard.mjs</code> to copy the latest data, then reload.</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="d-state d-empty"><p className="d-state-text">{children}</p></div>;
}

/** rate with its 95% CI on a 0..1 track; the dot is the point estimate */
export function CIBar({ rate, ci, src, base, baseLabel, max = 1, tone = 'ink' }: {
  rate: number; ci?: number[] | null; src: Source; base?: number; baseLabel?: string; max?: number; tone?: 'ink' | 'hot' | 'ai';
}) {
  const x = (v: number) => `${clamp(v / max, 0, 1) * 100}%`;
  return (
    <S src={src} className="d-cibar-wrap" as="div">
      <div className="d-cibar" aria-label={`${pct(rate)} (95% CI ${ci ? pct(ci[0]) + '–' + pct(ci[1]) : 'n/a'})`}>
        {ci ? <div className={`d-cibar-ci tone-${tone}`} style={{ left: x(ci[0]), width: `calc(${x(ci[1])} - ${x(ci[0])})` }} /> : null}
        {base !== undefined ? <div className="d-cibar-ref" style={{ left: x(base) }} title={baseLabel} /> : null}
        <div className={`d-cibar-dot tone-${tone}`} style={{ left: x(rate) }} />
      </div>
    </S>
  );
}

/** horizontal value bar (0..max) */
export function Bar({ v, max = 1, tone = 'ink', label }: { v: number; max?: number; tone?: string; label?: string }) {
  return (
    <div className="d-bar" aria-label={label}>
      <div className={`d-bar-fill tone-${tone}`} style={{ width: `${clamp(v / (max || 1), 0, 1) * 100}%` }} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="d-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={`d-seg-btn ${o.id === value ? 'is-on' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Ext({ href, children }: { href?: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return <a href={href} target="_blank" rel="noreferrer" className="d-ext">{children}</a>;
}

export function FootSrc({ items }: { items: (string | [string, string])[] }) {
  return (
    <span className="d-footsrc">
      <span className="d-footsrc-label">sources</span>
      {items.map((it) => {
        const [file, what] = Array.isArray(it) ? it : [it, ''];
        return <span key={file + what} className="d-footsrc-item"><code>{file}</code>{what ? <> {what}</> : null}</span>;
      })}
    </span>
  );
}
