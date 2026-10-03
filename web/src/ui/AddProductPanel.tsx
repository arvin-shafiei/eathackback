import { useEffect, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from 'react';
import type { Product } from '../types';
import { catColor, catLabel } from '../theme';
import type { AddProductProps } from './featureProps';
import { api, type ImportDraft } from '../api';
import { Select } from './Select';
import './add-product.css';

type Key = 'name' | 'brand' | 'category' | 'role' | 'price_gbp' | 'quantity' | 'pack_copy' | 'labels' | 'ingredients_text'
  | 'sugars_100g' | 'fiber_100g' | 'proteins_100g' | 'salt_100g' | 'energy_kcal_100g' | 'allergens' | 'nutriscore';
type Form = Record<Key, string>;
type Errs = Partial<Record<Key | 'replaces' | 'image', string>>;

const EMPTY: Form = {
  name: '', brand: '', category: '', role: 'challenger', price_gbp: '', quantity: '', pack_copy: '', labels: '', ingredients_text: '',
  sugars_100g: '', fiber_100g: '', proteins_100g: '', salt_100g: '', energy_kcal_100g: '', allergens: '', nutriscore: '',
};
/** every value here is invented for the demo button; it is not a real product and not from open food facts */
const EXAMPLE: Form = {
  name: 'Peanut & Date Oat Bar', brand: 'Oatsmith', category: 'snack_bars', role: 'challenger', price_gbp: '1.45', quantity: '40 g',
  pack_copy: 'Just 5 ingredients. Dates, oats and roasted peanuts pressed into a bar. 8g plant protein. No added sugar, no palm oil.',
  labels: 'vegan, no added sugar, palm oil free', ingredients_text: 'Dates (48%), wholegrain oats (27%), roasted peanuts (22%), sea salt, natural vanilla extract.',
  sugars_100g: '29', fiber_100g: '7.5', proteins_100g: '20', salt_100g: '0.3', energy_kcal_100g: '395', allergens: 'peanuts, oats', nutriscore: 'b',
};
const ROLES = ['challenger', 'incumbent', 'own_label'];
const ROLE_WORDS: Record<string, string> = { challenger: 'a new or small brand', incumbent: 'a big, known brand', own_label: "the supermarket's own brand" };
const NUTRIENTS: [Key, string][] = [['sugars_100g', 'sugars g'], ['fiber_100g', 'fibre g'], ['proteins_100g', 'protein g'], ['salt_100g', 'salt g'], ['energy_kcal_100g', 'energy kcal']];
const FOCUS_ORDER: (keyof Errs)[] = ['name', 'brand', 'price_gbp', ...NUTRIENTS.map(([k]) => k), 'category'];
const MAX_FILE_MB = 8, MAX_SIDE_PX = 320, JPEG_QUALITY = 0.82;

const unTag = (xs?: string[]) => (xs ?? []).map((x) => x.replace(/^en:/, '').replace(/-/g, ' ')).join(', ');
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const num = (s: string) => { const n = Number(s.trim()); return s.trim() && Number.isFinite(n) ? n : undefined; };

/** "Vegan, gluten free" -> ["en:vegan", "en:gluten-free"], the tag style the catalog uses */
function parseList(s: string): string[] {
  const tags = s.split(',').map((x) => x.trim().toLowerCase().replace(/^en:/, '').replace(/\s+/g, '-')).filter(Boolean);
  return [...new Set(tags)].map((t) => `en:${t}`);
}

async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('no drawable size');
    // jpeg has no alpha, so a transparent png would otherwise come out black
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally { URL.revokeObjectURL(url); }
}

function Field({ id, label, err, wide, children }: { id: string; label: ReactNode; err?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`addp-f ${wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {err && <span className="addp-err" id={`${id}-err`} role="alert">{err}</span>}
    </div>
  );
}

/** the card a shopper who notices the pack is handed: the same fields sim/prompts.py product_card sends */
function PackPreview({ f, image }: { f: Form; image: string }) {
  const badges = parseList(f.labels).slice(0, 5).map((t) => t.replace(/^en:/, '').replace(/-/g, ' '));
  const price = num(f.price_gbp);
  return (
    <div className="addp-preview">
      <span className="addp-cap">what a shopper sees</span>
      <div className="addp-pack" style={{ background: f.category ? catColor(f.category) : 'var(--line)' }}>
        {image ? <img src={image} alt="" /> : (
          <div className="addp-pack-label">
            <b>{(f.brand || 'your brand').toLowerCase()}</b>
            <span>{(f.name || 'product name').toLowerCase()}</span>
          </div>
        )}
        <span className="addp-pack-role">{catLabel(f.role)}</span>
        <span className="addp-tag">{price ? `£${price.toFixed(2)}` : '£ ?'}</span>
      </div>
      <p className="addp-pack-name"><b>{f.brand || 'your brand'}</b> {f.name || 'product name'}</p>
      <p className="addp-pack-copy">{f.pack_copy || 'your front-of-pack text shows up here.'}</p>
      {badges.length > 0 && <div className="chips">{badges.map((b) => <span key={b} className="chip">{b}</span>)}</div>}
    </div>
  );
}

export function AddProductPanel({ cfg, planogram, products, useLLM, onUseLLM, busy, msg, onSubmit, onClose }: AddProductProps) {
  const [f, setF] = useState<Form>(EMPTY);
  const [image, setImage] = useState('');
  const [pick, setPick] = useState<{ slot: string; code: string } | null>(null);
  useEffect(() => { setPick((p) => (p && planogram[p.slot]?.products.includes(p.code) ? p : null)); }, [planogram]);
  const [errs, setErrs] = useState<Errs>({});
  const [over, setOver] = useState(false);
  const [isExample, setIsExample] = useState(false);
  const [ref, setRef] = useState('');
  const [imp, setImp] = useState<{ busy: boolean; err: string | null; draft: ImportDraft | null }>({ busy: false, err: null, draft: null });

  const categories = [...new Set(cfg.units.map((u) => u.category))];
  const backFilled = !!(f.ingredients_text || f.allergens || f.nutriscore || NUTRIENTS.some(([k]) => f[k]));
  // opens by itself when an import or the example fills it; after that only the user closes it
  const [backOpen, setBackOpen] = useState(false);
  useEffect(() => { if (backFilled) setBackOpen(true); }, [backFilled]);
  const units = cfg.units.filter((u) => u.category === f.category);
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const clear = (k: keyof Errs) => setErrs((e) => ({ ...e, [k]: undefined }));
  const set = (k: Key, v: string) => {
    setF((p) => ({ ...p, [k]: v })); clear(k);
    if (k === 'category') setPick(null);
  };
  const bind = (k: Key) => ({
    id: `addp-${k}`, value: f[k], 'aria-invalid': errs[k] ? true : undefined, 'aria-describedby': errs[k] ? `addp-${k}-err` : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value),
  });
  const pickOf = (k: Key) => ({
    id: `addp-${k}`, value: f[k], invalid: !!errs[k], describedBy: errs[k] ? `addp-${k}-err` : undefined,
    className: 'select-field', onChange: (v: string) => set(k, v),
  });

  const takeFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setErrs((e) => ({ ...e, image: `"${file.name}" is not an image. use a png, jpg or webp.` }));
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setErrs((e) => ({ ...e, image: `that file is ${(file.size / 1024 / 1024).toFixed(1)} MB. the limit is ${MAX_FILE_MB} MB.` }));
    try { setImage(await downscale(file)); clear('image'); }
    catch { setErrs((e) => ({ ...e, image: 'the browser could not read that image. try another file.' })); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void takeFile(e.dataTransfer.files[0]); };

  const runImport = async () => {
    if (!ref.trim() || imp.busy) return;
    setImp({ busy: true, err: null, draft: null });
    try {
      const d = await api.importProduct(ref.trim());
      setF({
        ...EMPTY, name: str(d.name), brand: str(d.brand), price_gbp: str(d.price_gbp), quantity: str(d.quantity), pack_copy: str(d.pack_copy).slice(0, 300),
        category: categories.includes(str(d.category)) ? str(d.category) : '', labels: unTag(d.labels), allergens: unTag(d.allergens),
        ingredients_text: str(d.ingredients_text).slice(0, 800), nutriscore: str(d.nutriscore),
        ...Object.fromEntries(NUTRIENTS.map(([k]) => [k, str(d[k])])),
      });
      setImage(str(d.image)); setPick(null); setErrs({}); setIsExample(false);
      setImp({ busy: false, err: null, draft: d });
    } catch (e) { setImp({ busy: false, err: (e as Error).message, draft: null }); }
  };

  const fillExample = () => {
    setF({ ...EXAMPLE, category: categories.includes(EXAMPLE.category) ? EXAMPLE.category : categories[0] ?? '' });
    setPick(null); setErrs({}); setIsExample(true);
    setImage(''); setImp({ busy: false, err: null, draft: null });
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const price = num(f.price_gbp);
    const e: Errs = {};
    if (!f.name.trim()) e.name = 'give the product a name.';
    if (!f.brand.trim()) e.brand = 'give the brand.';
    if (!f.category) e.category = 'choose a category.';
    if (price === undefined || price <= 0) e.price_gbp = 'enter a price above £0.';
    for (const [k, label] of NUTRIENTS) if ((num(f[k]) ?? 0) < 0) e[k] = `${label} cannot be negative.`;
    if (f.category && !pick) e.replaces = 'pick the product yours replaces.';
    setErrs(e);
    const first = FOCUS_ORDER.find((k) => e[k]);
    if (first) document.getElementById(`addp-${first}`)?.focus();
    if (Object.keys(e).length || !pick || price === undefined) return;
    const product: Product = {
      ...Object.fromEntries(NUTRIENTS.map(([k]) => [k, num(f[k])])),
      code: 'UP' + Date.now().toString(36).toUpperCase(),
      name: f.name.trim(), brand: f.brand.trim(), category: f.category, role: f.role, price_gbp: price,
      quantity: f.quantity.trim() || undefined, pack_copy: f.pack_copy.trim() || undefined,
      labels: parseList(f.labels), allergens: parseList(f.allergens),
      ingredients_text: f.ingredients_text.trim() || undefined, nutriscore: f.nutriscore || undefined,
      image: image || undefined, brand_supplied: true,
      off_url: imp.draft?.off_url, imported_from: imp.draft?.imported_from, field_sources: imp.draft?.field_sources,
      additives: imp.draft?.additives, nova: imp.draft?.nova,
    };
    onSubmit(product, pick.slot, pick.code);
  };

  return (
    <section className="card addp" aria-label="add your product">
      <button className="x" type="button" onClick={onClose} aria-label="close add your product">×</button>
      <header className="addp-hero">
      <h2 className="display">put your product on the shelf</h2>
      <p className="muted">it replaces one product. 150 shoppers walk the store, and you see who picked it and why the rest didn't.{' '}
        <button type="button" className="link-btn" onClick={fillExample}>try an example</button>
      </p>
      {isExample && <p className="addp-hint"><span className="chip chip-yellow">example</span></p>}
      <div className="addp-import">
        <label htmlFor="addp-ref">paste a tesco link or a barcode <span className="thin">or fill it in below</span></label>
        <div className="addp-import-row">
          <input id="addp-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="https://www.tesco.com/groceries/en-GB/products/…  or  5060088701478"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runImport(); } }} autoComplete="off" />
          <button type="button" className="btn btn-ink" onClick={() => void runImport()} disabled={imp.busy || !ref.trim()}>{imp.busy ? 'reading…' : 'fetch'}</button>
        </div>
        <div role="status">
          {imp.err && <p className="notice">{imp.err}</p>}
          {imp.draft && (
            <p className="addp-hint">
              filled {Object.keys(imp.draft.field_sources ?? {}).length} fields.{' '}
              {imp.draft.off_url ? <>nutrition and ingredients are from <a href={imp.draft.off_url} target="_blank" rel="noreferrer">open food facts</a>.</> : 'open food facts has no entry for this barcode, so add the back of pack yourself.'} check them, then pick a shelf.
            </p>
          )}
        </div>
      </div>
      </header>
      <form className="addp-body" onSubmit={submit} noValidate>
        <div className="addp-form">
        <h3>the pack <span className="thin">what shoppers see</span></h3>
        <div className="addp-grid">
          <Field id="addp-name" label="name *" err={errs.name}><input {...bind('name')} maxLength={80} required autoComplete="off" /></Field>
          <Field id="addp-brand" label="brand *" err={errs.brand}><input {...bind('brand')} maxLength={60} required autoComplete="off" /></Field>
          <Field id="addp-price_gbp" label="price £ *" err={errs.price_gbp}><input {...bind('price_gbp')} type="number" min="0" step="0.01" inputMode="decimal" required /></Field>
          <Field id="addp-quantity" label={<>pack size <span className="thin">not shown to shoppers</span></>}><input {...bind('quantity')} maxLength={40} placeholder="40 g" /></Field>
          <Field id="addp-pack_copy" wide label={<>front of pack <span className="thin">{f.pack_copy.length}/300</span></>}>
            <textarea {...bind('pack_copy')} maxLength={300} rows={3} />
          </Field>
          <Field id="addp-labels" wide label={<>labels <span className="thin">comma-separated, first 5 show</span></>}>
            <input {...bind('labels')} placeholder="vegan, organic, gluten-free" />
          </Field>
          <Field id="addp-image" wide label="pack image" err={errs.image}>
            <div className="addp-img">
              <div className={`addp-drop ${over ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                {image ? <img src={image} alt="your pack, as it will be drawn on the 3d shelf" /> : <span className="muted">drop an image here</span>}
              </div>
              <div>
                <input id="addp-image" type="file" accept="image/*" aria-describedby={errs.image ? 'addp-image-err' : 'addp-image-note'}
                  onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ''; }} />
                {image && <button type="button" className="link-btn" onClick={() => setImage('')}>remove image</button>}
                <p className="addp-hint" id="addp-image-note">drawn on the 3d pack only. shoppers decide from the text. max {MAX_FILE_MB} MB.</p>
              </div>
            </div>
          </Field>
        </div>

        <details className="addp-fold" open={backOpen} onToggle={(e) => setBackOpen(e.currentTarget.open)}>
        <summary title="read by shoppers who turn it over, and by every ai agent">
          <h3>back of pack</h3><span className="thin">{backFilled ? 'filled in' : 'optional'}</span>
        </summary>
        <div className="addp-grid">
          <Field id="addp-ingredients_text" wide label={<>ingredients <span className="thin" title="shoppers read the first 400 characters, ai agents the first 300">{f.ingredients_text.length}/800</span></>}>
            <textarea {...bind('ingredients_text')} maxLength={800} rows={3} />
          </Field>
          <div className="addp-f wide">
            <span className="addp-lbl">per 100g <span className="thin">optional. blank means unknown</span></span>
            <div className="addp-nutri">
              {NUTRIENTS.map(([k, label]) => (
                <Field key={k} id={`addp-${k}`} label={label} err={errs[k]}><input {...bind(k)} type="number" min="0" step="any" inputMode="decimal" /></Field>
              ))}
            </div>
          </div>
          <Field id="addp-allergens" label={<>allergens <span className="thin">comma-separated</span></>}><input {...bind('allergens')} placeholder="milk, peanuts" /></Field>
          <Field id="addp-nutriscore" label={<>nutri-score <span className="thin">ai agents only</span></>}>
            <Select {...pickOf('nutriscore')} ariaLabel="nutri-score" options={[{ value: '', label: 'not given' }, ...['a', 'b', 'c', 'd', 'e'].map((s) => ({ value: s, label: s }))]} />
          </Field>
        </div>
        </details>

        <h3>where it goes</h3>
        <p className="addp-hint">the shelves are full. pick the product yours replaces.</p>
        <div className="addp-grid">
          <Field id="addp-category" label="category *" err={errs.category}>
            <Select {...pickOf('category')} ariaLabel="category" placeholder="choose…" options={categories.map((c) => ({ value: c, label: catLabel(c) }))} />
          </Field>
          <Field id="addp-role" label="what it is"><Select {...pickOf('role')} ariaLabel="what it is" options={ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r] ?? r }))} /></Field>
        </div>
        {units.map((u) => (
          <div key={u.id} className="addp-shelf" role="group" aria-label={`shelf ${u.id}, ${catLabel(u.category)}`}>
            <div className="addp-shelf-h"><span className="dot" style={{ background: catColor(u.category) }} />{u.id} <span className="muted">aisle {u.aisle} {u.side === 'L' ? 'left' : 'right'}</span></div>
            {rows.map((r) => {
              const slot = `${u.id}-r${r}`, set = planogram[slot];
              return (
                <div key={slot} className="addp-row">
                  <span className="addp-row-h">{cfg.row_names[String(r)] ?? `row ${r}`}</span>
                  <div className="addp-prods">
                    {(set?.products ?? []).map((c) => {
                      const on = pick?.slot === slot && pick.code === c;
                      return (
                        <button key={c} type="button" className={`addp-prod ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { setPick({ slot, code: c }); clear('replaces'); }}>
                          <span className="sw" style={{ background: products[c]?.color || catColor(products[c]?.category ?? u.category) }} />
                          <span className="nm"><b>{products[c]?.brand ?? c}</b> {products[c]?.name}</span>
                          <span className="muted">{catLabel(products[c]?.role ?? 'not in catalogue')}</span>
                        </button>
                      );
                    })}
                    {!set?.products.length && <span className="muted small">empty</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {pick && <p className="addp-hint">replaces <b>{products[pick.code]?.brand ?? pick.code} {products[pick.code]?.name}</b> in {pick.slot}.</p>}
        {errs.replaces && <span className="addp-err" role="alert">{errs.replaces}</span>}
        </div>

        <aside className="addp-side">
          <PackPreview f={f} image={image} />
          <div className="addp-foot">
            <button className="btn btn-brand" type="submit" disabled={busy}>{busy ? 'shoppers are walking…' : 'send the shoppers'}</button>
            <label className="toggle llm" title="off = free. on = real llm calls via openrouter (costs money, cached)"><input type="checkbox" checked={useLLM} onChange={(e) => onUseLLM(e.target.checked)} /> real ai shoppers (costs)</label>
            <p className="addp-hint">{useLLM ? 'on: each shopper is a real ai model. costs money.' : 'off: free.'}</p>
            <div role="status">{msg && <p className={`notice ${busy ? 'ok' : ''}`}>{msg}</p>}</div>
          </div>
        </aside>
      </form>
    </section>
  );
}
