/* <shelf-insight product="<barcode>" api="..."> : dependency-free web component.
 *
 * Renders a product's 4-stage shelf funnel (passed → looked → picked up → kept), where shoppers leak
 * (walked away / put back), and the top put-back reason with a logged example. For a brand's product page
 * or a retailer intranet.
 *
 * api = a base URL serving integrations/api_server.py  -> GET  {api}/v1/brand/funnel/{product}
 *     | a .json fixture keyed {products: {code: funnel}} (integrations/widget/fixture.json)
 * Optional attributes: token="..." (Bearer), compact (hides the archetype table).
 * Every number shown is a count from logged agent decisions; the sources line says which runs.
 */
(() => {
  const CSS = `
  :host{--ink:#141014;--pink:#FF4079;--orange:#FE831B;--cream:#FFF7EF;--line:#EADBD2;--muted:#6B5E66;
    display:block;font:500 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);max-width:460px}
  .card{background:#fff;border:2px solid var(--ink);border-radius:20px;box-shadow:0 6px 0 var(--ink),0 14px 24px rgba(20,16,20,.12);padding:16px 18px 14px}
  .hd{display:flex;gap:12px;align-items:center;margin-bottom:12px}
  .hd img{width:48px;height:48px;object-fit:contain;border:2px solid var(--ink);border-radius:12px;background:var(--cream)}
  .t{font:800 18px/1.1 "Baloo 2",Inter,system-ui,sans-serif;margin:0}
  .s{color:var(--muted);font-size:12px}
  .tag{display:inline-block;border:2px solid var(--ink);border-radius:99px;padding:0 8px;font-size:11px;font-weight:700;margin-left:6px;background:var(--cream)}
  .warn{background:#FFF1C9}
  .row{display:grid;grid-template-columns:96px 1fr 64px;gap:8px;align-items:center;margin:6px 0}
  .lab{font-size:12px;font-weight:700}
  .lab small{display:block;font-weight:500;color:var(--muted)}
  .bar{position:relative;height:18px;border:2px solid var(--ink);border-radius:9px;background:var(--cream);overflow:hidden}
  .fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--pink),var(--orange))}
  .ci{position:absolute;top:0;bottom:0;border-left:2px solid var(--ink);border-right:2px solid var(--ink);opacity:.35}
  .n{text-align:right;font:800 15px/1 "Baloo 2",Inter,sans-serif}
  .n small{display:block;font:500 11px Inter,sans-serif;color:var(--muted)}
  .leaks{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
  .leak{border:2px solid var(--ink);border-radius:12px;padding:4px 8px;font-size:12px;box-shadow:0 3px 0 var(--ink)}
  .leak b{font:800 15px "Baloo 2",Inter,sans-serif;margin-right:4px}
  .why{border-top:2px dashed var(--line);margin-top:10px;padding-top:10px}
  .why q{display:block;font-style:italic;color:var(--muted);margin-top:4px;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  td,th{padding:2px 4px;text-align:left;border-bottom:1px solid var(--line)}
  th{font-weight:700}
  .src{margin-top:10px;font-size:11px;color:var(--muted);word-break:break-word}
  .err{color:#B00020}
  @media (prefers-color-scheme:dark){:host{--ink:#F5EDF1;--cream:#2A2228;--line:#3A3036;--muted:#B7A9B1}
    .card{background:#1B161A;box-shadow:0 6px 0 #000,0 14px 24px rgba(0,0,0,.4)} .warn{background:#4A3A12}}`;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  const MECH = { habit: "habit", loss_aversion: "felt like worse value", price_anchor: "price vs what's next to it",
    trust: "trust / distrust", gimmick_reactance: "felt like a gimmick", social_proof: "social proof", health_goal: "health goal",
    mission_fit: "not what they came for", novelty: "novelty", effort: "too much effort", indifference: "no pull" };

  class ShelfInsight extends HTMLElement {
    static get observedAttributes() { return ["product", "api", "token"]; }
    constructor() { super(); this.root = this.attachShadow({ mode: "open" }); }
    connectedCallback() { this.load(); }
    attributeChangedCallback() { if (this.isConnected) this.load(); }

    async load() {
      const code = this.getAttribute("product"), api = this.getAttribute("api") || "";
      if (!code || !api) return this.paint(`<div class="err">needs product="" and api=""</div>`);
      this.paint(`<div class="s">loading shelf insight for ${esc(code)}…</div>`);
      try {
        const fixture = /\.json(\?|$)/.test(api);
        const url = fixture ? api : `${api.replace(/\/$/, "")}/v1/brand/funnel/${encodeURIComponent(code)}`;
        const headers = this.getAttribute("token") ? { Authorization: `Bearer ${this.getAttribute("token")}` } : {};
        const r = await fetch(url, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const d = fixture ? (j.products || {})[code] : j;
        if (!d) throw new Error(`no data for ${code} in fixture`);
        this.render(d, fixture && j.fixture);
        this.dispatchEvent(new CustomEvent("shelf-insight:loaded", { detail: d, bubbles: true }));
      } catch (e) {
        this.paint(`<div class="err">couldn't load shelf insight: ${esc(e.message)}</div>`);
      }
    }

    paint(html) { this.root.innerHTML = `<style>${CSS}</style><div class="card" part="card">${html}</div>`; }

    render(d, isFixture) {
      const p = d.product || {}, f = d.funnel || [], lk = d.leaks || {};
      const rows = f.map((s) => {
        const r = s.rate_of_shown ?? 0, [lo, hi] = s.ci95 || [0, 0];
        return `<div class="row" title="${esc(s.stage)}: ${s.count} of ${f[0]?.count}; 95% CI ${pct(lo)}–${pct(hi)} (Wilson)">
          <div class="lab">${esc(s.label)}<small>${esc(s.ecom)}</small></div>
          <div class="bar" role="img" aria-label="${esc(s.label)} ${pct(r)}"><div class="fill" style="width:${r * 100}%"></div>
            <div class="ci" style="left:${lo * 100}%;width:${Math.max(0, hi - lo) * 100}%"></div></div>
          <div class="n">${pct(r)}<small>${s.count}</small></div></div>`;
      }).join("");
      const top = (d.top_put_back_reasons || [])[0];
      const ex = top && (top.examples || [])[0];
      const why = top
        ? `<div class="why"><div class="lab">top put-back reason: ${esc(MECH[top.mechanism] || top.mechanism)} <span class="tag">${top.count}×</span></div>
           ${ex ? `<q>${esc(String(ex.reason).replace(/^\[\w+\]\s*/, ""))}</q><div class="s">${esc(ex.persona_id)} · ${esc(ex.agent_id)} · ${esc(ex.run_id || "")}</div>` : ""}</div>`
        : `<div class="why s">no put-backs logged yet.</div>`;
      const arch = this.hasAttribute("compact") ? "" : (() => {
        const a = Object.entries(d.by_archetype || {}).filter(([, v]) => v.shown).sort((x, y) => (y[1].pick_rate || 0) - (x[1].pick_rate || 0));
        if (!a.length) return "";
        return `<table><tr><th>shopper type</th><th>passed</th><th>kept</th><th>95% ci</th></tr>${a.map(([k, v]) =>
          `<tr><td>${esc(k.replace(/_/g, " "))}</td><td>${v.shown}</td><td>${v.picked}</td><td>${pct(v.ci95?.[0])}–${pct(v.ci95?.[1])}</td></tr>`).join("")}</table>`;
      })();
      const runs = ((d.sources || {}).runs || []).map((r) => `${r.run_id} (${r.engine}, ${r.agents} shoppers)`).join("; ");
      this.paint(`
        <div class="hd">${p.image ? `<img src="${esc(p.image)}" alt="">` : ""}
          <div><p class="t">${esc((p.name || p.code || "").toLowerCase())}</p>
          <div class="s">${esc((p.brand || "").toLowerCase())} · ${esc(p.role || "")}
          ${d.small_sample ? `<span class="tag warn" title="fewer than 30 shoppers passed: read the CI, not the headline">small sample</span>` : ""}
          ${isFixture ? `<span class="tag" title="static snapshot, not live">fixture</span>` : ""}</div></div></div>
        ${rows}
        <div class="leaks">
          <span class="leak"><b>${lk.never_noticed ?? "–"}</b>never noticed</span>
          <span class="leak"><b>${lk.looked_and_walked_away ?? "–"}</b>looked, walked away</span>
          <span class="leak"><b>${lk.picked_up_and_put_back ?? "–"}</b>picked up, put back</span></div>
        ${why}${arch}
        <div class="src">synthetic shoppers, counted from logged decisions: ${esc(runs || "no runs")}. ${esc((d.sources || {}).method || "")}
          ${p.off_url ? ` · <a href="${esc(p.off_url)}" target="_blank" rel="noopener">product data (open food facts)</a>` : ""}</div>`);
    }
  }
  if (!customElements.get("shelf-insight")) customElements.define("shelf-insight", ShelfInsight);
})();
