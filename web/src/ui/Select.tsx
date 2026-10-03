import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SelectOption, SelectProps } from './featureProps';
import './select.css';

const MAX_H = 320, MAX_W = 420, MIN_H = 120, GAP = 8, LEDGE = 6, EDGE = 8;

/** the box the popover has to stay inside: every scrolling or clipping ancestor, cut to the window */
function clipBox(el: HTMLElement) {
  const box = { top: EDGE, left: EDGE, right: window.innerWidth - EDGE, bottom: window.innerHeight - EDGE };
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    box.top = Math.max(box.top, r.top + EDGE); box.left = Math.max(box.left, r.left + EDGE);
    box.right = Math.min(box.right, r.right - EDGE); box.bottom = Math.min(box.bottom, r.bottom - EDGE);
  }
  return box;
}

export function Select({ value, options, onChange, ariaLabel, prefix, placeholder, searchable, id, invalid, describedBy, className }: SelectProps) {
  const uid = useId();
  const btnId = id ?? `${uid}-btn`, listId = `${uid}-list`, optId = (i: number) => `${uid}-opt-${i}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLSpanElement>(null), btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const match = (text: string) => {
    const q = text.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q)) : options;
  };
  const shown = useMemo(() => match(query), [options, query]);

  const step = (list: SelectOption[], from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < list.length; i += dir) if (!list[i].disabled) return i;
    return list[from] && !list[from].disabled ? from : -1;
  };
  const show = (at?: number) => {
    const sel = options.findIndex((o) => o.value === value && !o.disabled);
    setQuery(''); setActive(at ?? (sel >= 0 ? sel : step(options, -1, 1))); setOpen(true);
  };
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const pick = (o?: SelectOption) => {
    if (!o || o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  };

  useLayoutEffect(() => {
    const p = pop.current, r = root.current;
    if (!open || !p || !r) return;
    const box = clipBox(r), at = r.getBoundingClientRect();
    p.style.maxHeight = `${MAX_H}px`;
    p.style.maxWidth = `${Math.min(MAX_W, box.right - box.left)}px`;
    const below = box.bottom - at.bottom - GAP - LEDGE, above = at.top - box.top - GAP;
    const up = below < Math.min(MAX_H, p.offsetHeight) && above > below;
    p.toggleAttribute('data-up', up);
    p.style.maxHeight = `${Math.max(MIN_H, Math.min(MAX_H, up ? above : below))}px`;
    const overRight = Math.min(0, box.right - (at.left + p.offsetWidth));
    p.style.left = `${Math.max(overRight, box.left - at.left)}px`;
    if (searchable) search.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const jump = (ch: string) => {
    const hit = (i: number) => !options[i].disabled && options[i].label.toLowerCase().startsWith(ch.toLowerCase());
    const order = options.map((_, i) => (Math.max(active, -1) + 1 + i) % options.length);
    const i = order.find(hit);
    if (i === undefined) return;
    if (open) setActive(i); else show(i);
  };

  const onKey = (e: KeyboardEvent) => {
    const k = e.key, letter = !searchable && k.length === 1 && k !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); show(); }
      else if (letter) jump(k);
      return;
    }
    if (k === 'Tab') return close(false);
    if (letter) return jump(k);
    const next = k === 'ArrowDown' ? step(shown, active, 1) : k === 'ArrowUp' ? step(shown, Math.max(active, 0), -1)
      : k === 'Home' ? step(shown, -1, 1) : k === 'End' ? step(shown, shown.length, -1) : undefined;
    if (next !== undefined) { e.preventDefault(); setActive(next); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'Enter' || (k === ' ' && !searchable)) { e.preventDefault(); pick(shown[active]); }
  };

  const activeId = open && active >= 0 && shown[active] ? optId(active) : undefined;
  return (
    <span ref={root} className={`sel ${open ? 'is-open' : ''} ${className ?? ''}`} onKeyDown={onKey}>
      <button
        ref={btn} type="button" id={btnId} className="sel-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${selected?.label ?? placeholder ?? 'not chosen'}`} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
        aria-activedescendant={searchable ? undefined : activeId}
        onClick={() => (open ? close(false) : show())}
        /* space activates a button on keyup, which would reopen the list right after it picked */
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
      >
        {prefix && <b className="sel-pre">{prefix}</b>}
        <span className={`sel-val ${selected ? '' : 'is-empty'}`}>{selected ? selected.label : placeholder ?? ''}</span>
        <svg className="sel-chev" width="10" height="7" viewBox="0 0 10 7" aria-hidden="true"><path d="M1 1.2l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={pop} className="sel-pop">
          {searchable && (
            <input
              ref={search} className="sel-search" type="text" value={query} placeholder="search" autoComplete="off" spellCheck={false}
              role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={`search ${ariaLabel}`} aria-activedescendant={activeId}
              onChange={(e) => { setQuery(e.target.value); setActive(step(match(e.target.value), -1, 1)); }}
            />
          )}
          {/* keep focus on the button or the search box while the list is clicked or scrolled */}
          <div className="sel-list" id={listId} role="listbox" aria-label={ariaLabel} onMouseDown={(e) => e.preventDefault()}>
            {shown.map((o, i) => (
              <div key={o.value} role="presentation">
                {o.group && o.group !== shown[i - 1]?.group && <div className="sel-group" role="presentation">{o.group}</div>}
                <div
                  id={optId(i)} role="option" aria-selected={o.value === value} aria-disabled={o.disabled ? true : undefined}
                  className={`sel-opt ${i === active ? 'is-active' : ''}`}
                  onPointerMove={() => { if (!o.disabled && i !== active) setActive(i); }} onClick={() => pick(o)}
                >
                  <svg className="sel-tick" width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M1.5 5.2l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="sel-lbl">{o.label}</span>
                  {o.hint && <span className="sel-hint">{o.hint}</span>}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div className="sel-none" role="presentation">no match</div>}
          </div>
        </div>
      )}
    </span>
  );
}
