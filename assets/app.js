(function () {
'use strict';
/* ==========================================================================
   L’âge de pic des joueurs NBA — logique de la page
   ========================================================================== */
const NS = 'http://www.w3.org/2000/svg';
const root = document.getElementById('nb');
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const sv = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
const COL = dash.colors;
COL.forEach((c, i) => root.style.setProperty('--nb-c' + (i + 1), c));
const ACC = 'var(--nb-c1)';
const MUTED = 'var(--cds-chart-muted)';
let leftM = 0;   // marge gauche du graphique de la courbe d’âge, réutilisée par le graphique des variations (axes alignés)

/* ---------- formats français ---------- */
function fr(x, d, plus) {
  if (!Number.isFinite(x)) return '—';
  d = d === undefined ? 1 : d;
  const s0 = Math.abs(x).toFixed(d);
  const zero = Number(s0) === 0;
  const parts = s0.split('.');
  const ent = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = parts[1] ? ent + ',' + parts[1] : ent;
  if (x < 0 && !zero) return '−' + s;
  if (plus && x > 0 && !zero) return '+' + s;
  return s;
}
const frInt = (x) => fr(x, 0);
const yr = (x) => (Number.isFinite(x) ? String(Math.round(x)) : '—');   // une année ne prend pas de séparateur de milliers
const tickDec = (ticks) => {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
};

/* ---------- paramètres (filtres) ---------- */
const PDEF = { metric: 'bpm', pos: 'all', era: 'all', thr: '500', tol: '20', dim: 'pos', minlen: '7', player: 'jamesle01' };
function getP() {
  const p = dash.params() || {};
  const o = {};
  for (const k in PDEF) o[k] = p[k] !== undefined && p[k] !== null && p[k] !== '' ? String(p[k]) : PDEF[k];
  return o;
}

/* ---------- couche de données ---------- */
const DEFS = {
  courbes: { text: ['metric', 'pos', 'era'], key: ['metric', 'pos', 'era', 'thr', 'age'] },
  pics: { text: ['metric', 'pos', 'era'], key: ['metric', 'pos', 'era', 'thr'] },
  fenetres: { text: ['metric', 'pos', 'era'], key: ['metric', 'pos', 'era', 'thr', 'tol'] },
  indicateurs: { text: ['metric', 'label', 'famille', 'unite', 'definition', 'axe'], key: ['metric'] },
  options: { text: ['filtre', 'valeur', 'libelle'], key: ['filtre', 'valeur'] },
  methode: { text: ['cle', 'libelle'], key: ['cle'] },
  anciennete: { text: ['metric', 'era', 'axe'], key: ['metric', 'era', 'axe'] },
  robustesse: { text: ['metric', 'variant'], key: ['metric', 'variant'] },
  ligue_age: { text: ['era'], key: ['era', 'age'] },
  joueurs_resume: { text: ['player_id', 'name', 'pos'], key: ['player_id'] },
  joueurs: { text: ['player_id'], key: ['player_id', 'season'] },
  indiv_resume: { text: ['metric', 'pos', 'cohort'], key: ['metric', 'pos', 'cohort', 'minlen'] },
  indiv_hist: { text: ['metric', 'pos', 'cohort'], key: ['metric', 'pos', 'cohort', 'minlen', 'age'] },
  reperes: { text: ['profil'], key: ['profil'] },
};
const cache = {};
let combos = new Map();     // courbes : "metric|pos|era|thr" -> lignes triées par âge
let byPlayer = new Map();   // joueurs : player_id -> saisons triées
let histBy = new Map();     // indiv_hist : clé de groupe -> lignes triées par âge
const toNum = (x) => (x === '' || x === null || x === undefined ? NaN : Number(x));

function buildDataset(id, rows) {
  const def = DEFS[id];
  const textSet = new Set(def.text);
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], o = {};
    for (const k in r) o[k] = textSet.has(k) ? String(r[k] === null || r[k] === undefined ? '' : r[k]) : toNum(r[k]);
    out[i] = o;
  }
  const map = new Map();
  for (const o of out) map.set(def.key.map((k) => o[k]).join('|'), o);
  return { src: rows, rows: out, map };
}
function load() {
  let ok = true, failed = false;
  for (const id in DEFS) {
    const d = dash.data(id);
    if (d.status === 'ok') {
      const c = cache[id];
      if (!c || c.src !== d.data) {
        cache[id] = buildDataset(id, d.data);
        if (id === 'courbes') {
          combos = new Map();
          for (const r of cache[id].rows) {
            const k = r.metric + '|' + r.pos + '|' + r.era + '|' + r.thr;
            if (!combos.has(k)) combos.set(k, []);
            combos.get(k).push(r);
          }
          combos.forEach((a) => a.sort((u, v) => u.age - v.age));
        } else if (id === 'joueurs') {
          byPlayer = new Map();
          for (const r of cache[id].rows) {
            if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
            byPlayer.get(r.player_id).push(r);
          }
          byPlayer.forEach((a) => a.sort((u, v) => u.season - v.season));
        } else if (id === 'indiv_hist') {
          histBy = new Map();
          for (const r of cache[id].rows) {
            const k = r.metric + '|' + r.pos + '|' + r.cohort + '|' + r.minlen;
            if (!histBy.has(k)) histBy.set(k, []);
            histBy.get(k).push(r);
          }
          histBy.forEach((a) => a.sort((u, v) => u.age - v.age));
        }
      }
    } else {
      ok = false;
      if (d.status !== 'loading') failed = true;
    }
  }
  return { ok, failed };
}
const get = (id, ...vals) => (cache[id] ? cache[id].map.get(vals.join('|')) : undefined);
const rowsOf = (id) => (cache[id] ? cache[id].rows : []);
const optList = (filtre) => rowsOf('options').filter((r) => r.filtre === filtre).sort((a, b) => a.ordre - b.ordre);
const optLabel = (filtre, valeur) => { const r = get('options', filtre, valeur); return r ? r.libelle : String(valeur); };
const curveRows = (P, over) => { const q = Object.assign({}, P, over || {}); return combos.get(q.metric + '|' + q.pos + '|' + q.era + '|' + Number(q.thr)) || []; };
const picsRow = (P, over) => { const q = Object.assign({}, P, over || {}); return get('pics', q.metric, q.pos, q.era, Number(q.thr)); };
const methodVal = (k) => { const r = get('methode', k); return r ? r.valeur : NaN; };
const isEdge = (pk) => !!pk && (pk.edge === 1 || pk.edge_share >= 0.5);

/* ---------- marques (chaque chiffre affiché cite sa ligne de données) ---------- */
function resolveTpl(s, P) {
  return s.replace(/\$([a-z]+)/g, (m, k) => P[k]).replace(/@([a-z_0-9]+)/g, (m, k) => { const r = get('methode', k); return r ? String(r.valeur) : ''; });
}
function parseWhere(s) {
  const w = {};
  s.split('&').forEach((kv) => { const i = kv.indexOf('='); w[kv.slice(0, i)] = kv.slice(i + 1); });
  return w;
}
function whereStr(w) { return Object.keys(w).map((k) => k + '=' + w[k]).join('&'); }
function applyMark(e, src, field, w, dec, plus, P) {
  const def = DEFS[src];
  const row = get(src, ...def.key.map((k) => w[k]));
  let txt = '—', ok = false;
  if (row && row[field] !== undefined) {
    const v = row[field];
    if (typeof v === 'string') { if (v !== '') { txt = v; ok = true; } }
    else if (Number.isFinite(v)) {
      let d = dec;
      if (dec === 'dd') { const ind = get('indicateurs', P.metric); d = ind ? ind.dd : 2; }
      txt = d === 'y' ? yr(v) : fr(v, Number(d), plus);
      ok = true;
    }
  }
  e.textContent = txt;
  e.classList.remove('dash-skeleton');
  if (ok) { e.dataset.source = src; e.dataset.field = field; e.dataset.where = whereStr(w); }
  else { delete e.dataset.source; delete e.dataset.field; delete e.dataset.where; }
  return ok;
}
function fillMarks(scope, P) {
  $$('[data-m]', scope).forEach((e) => {
    const parts = e.dataset.m.split('|');
    const src = parts[0], field = parts[1];
    const w = parseWhere(resolveTpl(parts[2], P));
    const dec = parts[3] === undefined ? '1' : parts[3];
    applyMark(e, src, field, w, dec === 'dd' || dec === 't' || dec === 'y' ? dec : Number(dec), parts[4] === 'plus', P);
  });
}
// marque créée dans le code (phrases dynamiques)
function mk(src, field, w, dec, plus, P) {
  const e = el('span', 'nb-n');
  applyMark(e, src, field, w, dec, plus, P);
  return e;
}
function sentence(host, parts) {
  clear(host);
  parts.forEach((p) => host.appendChild(typeof p === 'string' ? document.createTextNode(p) : p));
  host.classList.remove('dash-skeleton');
}
const keyW = (P, over) => { const q = Object.assign({}, P, over || {}); return { metric: q.metric, pos: q.pos, era: q.era, thr: q.thr }; };

/* ---------- info-bulle ---------- */
const tip = $('#tip');
function tipShow(cx, cy, build) {
  clear(tip);
  build(tip);
  tip.hidden = false;
  const rb = root.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = cx - rb.left + 14, y = cy - rb.top - th - 12;
  if (x + tw > rb.width - 4) x = cx - rb.left - tw - 14;
  if (x < 4) x = 4;
  if (y < 4) y = cy - rb.top + 18;
  tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
}
function tipHide() { tip.hidden = true; }
const tH = (t, text) => t.appendChild(el('div', 'tt-h', text));
const tS = (t, text) => t.appendChild(el('div', 'tt-s', text));
function tR(t, color, k, v) {
  const r = el('div', 'tt-r');
  if (color) { const i = el('i'); i.style.background = color; r.appendChild(i); }
  if (k) r.appendChild(el('span', 'tt-k', k));
  r.appendChild(el('span', 'tt-v', v));
  t.appendChild(r);
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest || !e.target.closest('.nb-chart, .nb-mosaic, .nb-mini')) tipHide(); });

/* ---------- aides SVG ---------- */
const measureCache = new Map();
function textW(svg, str, cls) {
  const key = (cls || '') + '|' + str;
  if (measureCache.has(key)) return measureCache.get(key);
  const t = sv('text', { x: -9999, y: -9999, class: cls || '' }, svg);
  t.textContent = str;
  let w = 0;
  try { w = t.getComputedTextLength(); } catch (e) { w = 0; }
  svg.removeChild(t);
  if (!w) w = str.length * 6.1;
  if (w > 0) measureCache.set(key, w);
  return w;
}
function fitText(svg, str, maxW, cls) {
  if (textW(svg, str, cls) <= maxW) return str;
  let s = str;
  while (s.length > 2 && textW(svg, s + '…', cls) > maxW) s = s.slice(0, -1);
  return s.trim() + '…';
}
function mkSvg(host, h, label) {
  host.classList.remove('dash-skeleton');
  $$('.nb-err', host).forEach((e) => e.remove());
  const w = Math.max(240, Math.floor(host.clientWidth));
  let svg = null;
  for (const c of host.children) if (c.tagName && c.tagName.toLowerCase() === 'svg' && c.classList.contains('nb-svg')) svg = c;
  if (!svg) { svg = sv('svg', { class: 'nb-svg', role: 'img' }); host.appendChild(svg); }
  clear(svg);
  svg.setAttribute('width', '100%');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('aria-label', label || '');
  host.style.minHeight = h + 'px';
  return { svg, w, h };
}
function showMsg(host, text, info) {
  host.classList.remove('dash-skeleton');
  $$('svg.nb-svg', host).forEach((s) => s.remove());
  $$('.nb-err', host).forEach((e) => e.remove());
  const d = el('div', 'nb-err' + (info ? ' nb-info' : ''), text);
  host.appendChild(d);
  host.style.minHeight = '160px';
}
function barPath(x, y0, y1, w, r) {
  // barre verticale : base carrée en y0, extrémité arrondie (rayon r) en y1
  const up = y1 < y0;
  const rr = Math.min(r, w / 2, Math.abs(y1 - y0));
  if (Math.abs(y1 - y0) < 0.5) return 'M' + x + ',' + y0 + 'h' + w + 'v-1h-' + w + 'z';
  if (up) return 'M' + x + ',' + y0 + 'V' + (y1 + rr) + 'Q' + x + ',' + y1 + ' ' + (x + rr) + ',' + y1 + 'H' + (x + w - rr) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + rr) + 'V' + y0 + 'Z';
  return 'M' + x + ',' + y0 + 'V' + (y1 - rr) + 'Q' + x + ',' + y1 + ' ' + (x + rr) + ',' + y1 + 'H' + (x + w - rr) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - rr) + 'V' + y0 + 'Z';
}
function legend(host, items) {
  clear(host);
  items.forEach((it) => {
    const s = el('span', 'nb-lg');
    const i = el('i', 'k-' + it.kind);
    if (it.kind === 'dash') i.style.borderColor = it.color; else i.style.background = it.color;
    s.appendChild(i);
    s.appendChild(document.createTextNode(it.text));
    host.appendChild(s);
  });
}

/* ---------- réticule (ligne verticale + info-bulle) pour les graphiques en courbes ---------- */
function crosshair(svg, w, cfg) {
  // cfg : n, px(i), y0, y1, x0, x1, tipFn(i, tipEl), dots(i) -> [{y, color}], label
  const g = sv('g', null, svg);
  const line = sv('line', { class: 'cross', y1: cfg.y0, y2: cfg.y1 }, g);
  line.style.display = 'none';
  const dg = sv('g', null, g);
  const hit = sv('rect', { class: 'hit', x: cfg.x0, y: cfg.y0, width: Math.max(1, cfg.x1 - cfg.x0), height: Math.max(1, cfg.y1 - cfg.y0), tabindex: 0, role: 'group', 'aria-label': cfg.label || 'Lecture des valeurs : flèches gauche et droite' }, g);
  let cur = -1;
  const show = (i, cx, cy) => {
    cur = i;
    const x = cfg.px(i);
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.style.display = '';
    clear(dg);
    (cfg.dots ? cfg.dots(i) : []).forEach((d) => {
      const c = sv('circle', { cx: x, cy: d.y, r: 5 }, dg);
      c.style.fill = d.color; c.style.stroke = 'var(--color-panel)'; c.style.strokeWidth = '2';
    });
    tipShow(cx, cy, (t) => cfg.tipFn(i, t));
  };
  const hide = () => { cur = -1; line.style.display = 'none'; clear(dg); tipHide(); };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const sx = (clientX - r.left) * (w / r.width);
    let best = 0, bd = Infinity;
    for (let i = 0; i < cfg.n; i++) { const d = Math.abs(cfg.px(i) - sx); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  hit.addEventListener('pointermove', (e) => show(nearest(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerdown', (e) => show(nearest(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = Math.max(0, Math.min(cfg.n - 1, (cur < 0 ? Math.floor(cfg.n / 2) : cur) + (e.key === 'ArrowRight' ? 1 : -1)));
    const r = svg.getBoundingClientRect();
    show(i, r.left + cfg.px(i) * (r.width / w), r.top + (cfg.y0 + (cfg.y1 - cfg.y0) / 2) * (r.width / w));
  });
  return g;
}

/* ==========================================================================
   Axes communs
   ========================================================================== */
function xTicksFor(a0, a1, w) {
  const step = w < 520 ? 5 : 2;
  const out = [];
  for (let a = Math.ceil(a0 / step) * step; a <= a1; a += step) out.push(a);
  return out;
}
function drawGridY(svg, y, ticks, td, m, w) {
  const g = sv('g', { class: 'grid' }, svg);
  ticks.forEach((t) => {
    sv('line', { x1: m.l, x2: w - m.r, y1: y(t), y2: y(t) }, g);
    const tx = sv('text', { x: m.l - 8, y: y(t) + 3.5, 'text-anchor': 'end' }, svg);
    tx.textContent = fr(t, td);
  });
}
function drawAxisX(svg, x, ticks, m, w, H, title) {
  const ay = H - m.b;
  const g = sv('g', { class: 'axis' }, svg);
  sv('line', { x1: m.l, x2: w - m.r, y1: ay, y2: ay }, g);
  ticks.forEach((t) => {
    sv('line', { x1: x(t), x2: x(t), y1: ay, y2: ay + 4 }, g);
    const tx = sv('text', { x: x(t), y: ay + 17, 'text-anchor': 'middle' }, svg);
    tx.textContent = String(t);
  });
  if (title) { const tt = sv('text', { x: (m.l + w - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, svg); tt.textContent = title; }
}

/* ==========================================================================
   1. Courbe d’âge : progression, prime, déclin
   ========================================================================== */
function deltaDomain(rows) {
  const v = [];
  rows.forEach((r) => { [r.d_lo, r.d_hi, r.d_raw, r.d_s].forEach((u) => { if (Number.isFinite(u)) v.push(u); }); });
  const lo = Math.min(0, d3.min(v)), hi = Math.max(0, d3.max(v));
  const pad = (hi - lo) * 0.06 || 0.1;
  return [lo - pad, hi + pad];
}
function drawCurve(P, ind) {
  const host = $('#ch-curve');
  const rows = curveRows(P);
  if (!rows.length) { showMsg(host, 'Pas assez de paires de saisons pour cette combinaison de filtres : élargissez le poste, l’époque ou le seuil de minutes.', true); return; }
  const pk = picsRow(P);
  const win = get('fenetres', P.metric, P.pos, P.era, Number(P.thr), Number(P.tol));
  const edge = isEdge(pk);
  const dd = ind.dd, unit = ind.unite;
  const H = host.clientWidth < 520 ? 320 : 380;
  const { svg, w } = mkSvg(host, H, 'Courbe d’âge de l’indicateur ' + ind.label + ' : écart au pic selon l’âge' + (edge || !pk ? '' : ', pic vers ' + fr(pk.peak, 1) + ' ans'));
  const a0 = rows[0].age, a1 = rows[rows.length - 1].age;
  const yLo = d3.min(rows, (r) => Math.min(r.g, r.g_lo));
  const span = Math.abs(yLo) || 1;
  const yDom = [yLo - 0.03 * span, 0.07 * span];
  const yTicks = d3.ticks(yDom[0], yDom[1], 5).filter((t) => t <= yDom[1] + 1e-9);
  const td = tickDec(yTicks);
  const dDom = deltaDomain(rows);
  const dTicks = d3.ticks(dDom[0], dDom[1], 5);
  const labW = Math.max(d3.max(yTicks, (t) => textW(svg, fr(t, td))), d3.max(dTicks, (t) => textW(svg, fr(t, tickDec(dTicks)))));
  const m = { t: 28, r: 14, b: 48, l: Math.ceil(labW) + 14 };
  leftM = m.l;
  const x = d3.scaleLinear([a0 - 0.5, a1 + 0.5], [m.l, w - m.r]);
  const y = d3.scaleLinear(yDom, [H - m.b, m.t]);
  const ay = H - m.b;

  // fenêtre de prime
  if (win && !edge) {
    const wx0 = x(Math.max(a0 - 0.5, win.lo)), wx1 = x(Math.min(a1 + 0.5, win.hi));
    const r = sv('rect', { x: wx0, y: m.t, width: Math.max(0, wx1 - wx0), height: ay - m.t }, svg);
    r.style.fill = ACC; r.style.opacity = '0.09';
  }
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(a0, a1, w), m, w, H, 'Âge au premier février de la saison');
  sv('line', { class: 'zero', x1: m.l, x2: w - m.r, y1: y(0), y2: y(0) }, svg);

  // intervalle
  const area = d3.area().x((r) => x(r.age)).y0((r) => y(r.g_lo)).y1((r) => y(r.g_hi));
  const band = sv('path', { d: area(rows) }, svg);
  band.style.fill = ACC; band.style.opacity = '0.16';
  // courbe
  const line = d3.line().x((r) => x(r.age)).y((r) => y(r.g));
  const path = sv('path', { d: line(rows), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  path.style.stroke = ACC; path.style.strokeWidth = '2';

  // pic et intervalle du pic
  const occupied = {};
  const place = (cx, text, cls, yy, anchor) => {
    const tw = textW(svg, text, cls) + 10;
    const x0 = cx - tw / 2, x1 = cx + tw / 2;
    if (x0 < m.l - 4 || x1 > w - m.r + 4) return false;
    const occ = occupied[yy] || (occupied[yy] = []);   // une liste par rangée : seules les étiquettes d’une même ligne peuvent se heurter
    if (occ.some((o) => !(x1 < o[0] || x0 > o[1]))) return false;
    occ.push([x0, x1]);
    const t = sv('text', { x: cx, y: yy, 'text-anchor': anchor || 'middle', class: cls }, svg);
    t.textContent = text;
    return true;
  };
  if (pk && !edge) {
    const ci = sv('line', { x1: x(pk.peak_lo), x2: x(pk.peak_hi), y1: y(0), y2: y(0), 'stroke-linecap': 'round' }, svg);
    ci.style.stroke = ACC; ci.style.strokeWidth = '9'; ci.style.opacity = '0.32';
    const ref = sv('line', { class: 'ref', x1: x(pk.peak), x2: x(pk.peak), y1: m.t - 4, y2: y(0) }, svg);
    ref.style.opacity = '0.6';
    const dot = sv('circle', { cx: x(pk.peak), cy: y(0), r: 5 }, svg);
    dot.style.fill = ACC; dot.style.stroke = 'var(--color-panel)'; dot.style.strokeWidth = '2';
    place(x(pk.peak), 'Pic : ' + fr(pk.peak, 1) + ' ans', 't-strong', m.t - 12);
  }
  if (win && !edge) {
    const lo = Math.max(a0 - 0.5, win.lo), hi = Math.min(a1 + 0.5, win.hi);
    place(x((lo + hi) / 2), 'Prime', 't-strong', ay - 10);
    place(x(((a0 - 0.5) + lo) / 2), 'Progression', '', m.t - 12);
    place(x((hi + (a1 + 0.5)) / 2), 'Déclin', '', m.t - 12);
  }

  // réticule + info-bulle
  crosshair(svg, w, {
    n: rows.length, px: (i) => x(rows[i].age), y0: m.t - 6, y1: ay, x0: m.l, x1: w - m.r,
    label: 'Lecture de la courbe d’âge : flèches gauche et droite',
    dots: (i) => [{ y: y(rows[i].g), color: ACC }],
    tipFn: (i, t) => {
      const r = rows[i];
      tH(t, fr(r.age, 0) + ' ans');
      tR(t, ACC, 'Écart au pic', fr(r.g, dd, true) + ' ' + unit);
      tR(t, null, 'Intervalle', fr(r.g_lo, dd, true) + ' à ' + fr(r.g_hi, dd, true));
      if (Number.isFinite(r.d_s)) tR(t, null, 'Variation vers ' + fr(r.age + 1, 0) + ' ans', fr(r.d_s, dd, true));
      if (Number.isFinite(r.n_pairs)) tS(t, frInt(r.n_pairs) + ' paires de saisons · ' + frInt(r.n_players) + ' joueurs');
    },
  });
}

/* ==========================================================================
   2. Variation d’une année sur l’autre
   ========================================================================== */
function drawDelta(P, ind) {
  const host = $('#ch-delta');
  const all = curveRows(P);
  const rows = all.filter((r) => Number.isFinite(r.d_s));
  if (!rows.length) { showMsg(host, 'Pas assez de paires de saisons pour cette combinaison de filtres.', true); return; }
  const pk = picsRow(P);
  const edge = isEdge(pk);
  const dd = ind.dd, unit = ind.unite;
  const H = host.clientWidth < 520 ? 280 : 320;
  const { svg, w } = mkSvg(host, H, 'Variation moyenne du niveau d’une saison à la suivante, par âge, pour l’indicateur ' + ind.label);
  const a0 = all[0].age, a1 = all[all.length - 1].age;
  const yDom = deltaDomain(rows);
  const yTicks = d3.ticks(yDom[0], yDom[1], 5);
  const td = tickDec(yTicks);
  const m = { t: 20, r: 14, b: 48, l: leftM || (Math.ceil(d3.max(yTicks, (t) => textW(svg, fr(t, td)))) + 14) };
  const x = d3.scaleLinear([a0 - 0.5, a1 + 0.5], [m.l, w - m.r]);
  const y = d3.scaleLinear(yDom, [H - m.b, m.t]);
  const ay = H - m.b;
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(a0, a1, w), m, w, H, 'Âge de départ (variation entre cet âge et le suivant)');
  sv('line', { class: 'zero', x1: m.l, x2: w - m.r, y1: y(0), y2: y(0) }, svg);
  const bw = Math.max(3, Math.min(24, (x(a0 + 1) - x(a0)) * 0.62));
  rows.forEach((r) => {
    const cx = x(r.age + 0.5);
    const p = sv('path', { d: barPath(cx - bw / 2, y(0), y(r.d_s), bw, 4) }, svg);
    p.style.fill = r.d_s >= 0 ? COL[0] : COL[1];
    p.style.opacity = '0.9';
    const wh = sv('line', { x1: cx, x2: cx, y1: y(r.d_lo), y2: y(r.d_hi) }, svg);
    wh.style.stroke = 'var(--color-fg)'; wh.style.strokeWidth = '1.25'; wh.style.opacity = '0.55';
  });
  rows.forEach((r) => {
    if (!Number.isFinite(r.d_raw)) return;
    const c = sv('circle', { cx: x(r.age + 0.5), cy: y(r.d_raw), r: 3 }, svg);
    c.style.fill = MUTED; c.style.stroke = 'var(--color-panel)'; c.style.strokeWidth = '1.5';
  });
  if (pk && !edge) {
    const ref = sv('line', { class: 'ref', x1: x(pk.peak), x2: x(pk.peak), y1: m.t, y2: ay }, svg);
    ref.style.opacity = '0.6';
    const lb = 'Pic : ' + fr(pk.peak, 1) + ' ans';
    const tw = textW(svg, lb, 't-strong');
    const tx = sv('text', { x: x(pk.peak) + (x(pk.peak) + tw + 10 < w - m.r ? 6 : -6), y: m.t + 10, 'text-anchor': x(pk.peak) + tw + 10 < w - m.r ? 'start' : 'end', class: 't-strong' }, svg);
    tx.textContent = lb;
  }
  crosshair(svg, w, {
    n: rows.length, px: (i) => x(rows[i].age + 0.5), y0: m.t, y1: ay, x0: m.l, x1: w - m.r,
    label: 'Lecture des variations annuelles : flèches gauche et droite',
    dots: (i) => [{ y: y(rows[i].d_s), color: rows[i].d_s >= 0 ? COL[0] : COL[1] }],
    tipFn: (i, t) => {
      const r = rows[i];
      tH(t, 'De ' + fr(r.age, 0) + ' à ' + fr(r.age + 1, 0) + ' ans');
      tR(t, r.d_s >= 0 ? COL[0] : COL[1], 'Variation lissée', fr(r.d_s, dd, true) + ' ' + unit);
      tR(t, null, 'Intervalle', fr(r.d_lo, dd, true) + ' à ' + fr(r.d_hi, dd, true));
      if (Number.isFinite(r.d_raw)) tR(t, MUTED, 'Moyenne brute', fr(r.d_raw, dd, true));
      tS(t, frInt(r.n_pairs) + ' paires de saisons · ' + frInt(r.n_players) + ' joueurs');
    },
  });
}

/* ==========================================================================
   Graphique à points avec segments (âge du pic par groupe)
   rows : { key, label, v, lo, hi, color, hollow, sel, header, tip(t), note }
   ========================================================================== */
function dotPlot(host, rows, cfg) {
  cfg = cfg || {};
  const headH = 26;
  const real = rows.filter((r) => !r.header);
  if (!real.length) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres.', true); return; }
  const wHost = Math.max(240, Math.floor(host.clientWidth));
  const hasRefLabel = !!(cfg.ref && Number.isFinite(cfg.ref.v) && cfg.ref.label);
  const mT = hasRefLabel ? 24 : 8, mB = 44;
  // hauteur provisoire : on mesure d’abord les libellés pour choisir la disposition
  const { svg, w } = mkSvg(host, 120, cfg.aria || 'Âge du pic par groupe');
  let labFull = 0;
  rows.forEach((r) => { if (!r.header) labFull = Math.max(labFull, textW(svg, r.label, r.sel ? 't-sel' : '')); });
  // sur écran étroit, un libellé long passe au-dessus de sa ligne pour laisser toute la largeur au tracé
  const stacked = wHost < 520 && labFull > wHost * 0.3;
  const rowH = (cfg.rowH || 28) + (stacked ? 14 : 0);
  let H = mT + mB;
  rows.forEach((r) => { H += r.header ? headH : rowH; });
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + H);
  host.style.minHeight = H + 'px';
  const maxLab = Math.min(cfg.maxLabel || 190, wHost * 0.42);
  const labW = stacked ? w - 12 : Math.min(labFull, maxLab);
  const mL = stacked ? 16 : Math.ceil(labW) + 14, mR = cfg.mR || 46;
  let lo = d3.min(real, (r) => Math.min(Number.isFinite(r.lo) ? r.lo : r.v, r.v));
  let hi = d3.max(real, (r) => Math.max(Number.isFinite(r.hi) ? r.hi : r.v, r.v));
  if (cfg.domain) { lo = Math.min(lo, cfg.domain[0]); hi = Math.max(hi, cfg.domain[1]); }
  lo = Math.floor(lo - 0.6); hi = Math.ceil(hi + 0.6);
  const x = d3.scaleLinear([lo, hi], [mL, w - mR]);
  // graduations : on en retire tant que deux étiquettes voisines se touchent
  let cnt = w < 480 ? 5 : 8;
  let ticks = d3.ticks(lo, hi, cnt);
  while (cnt > 2 && ticks.length > 2) {
    const td0 = tickDec(ticks);
    const lw = d3.max(ticks, (t) => textW(svg, fr(t, td0)));
    if (x(ticks[1]) - x(ticks[0]) >= lw + 14) break;
    cnt -= 1;
    ticks = d3.ticks(lo, hi, cnt);
  }
  const td = tickDec(ticks);
  let yy = mT;
  const gridG = sv('g', { class: 'grid' }, svg);
  const bodyBottom = H - mB;
  ticks.forEach((t) => {
    sv('line', { x1: x(t), x2: x(t), y1: mT, y2: bodyBottom }, gridG);
    const tx = sv('text', { x: x(t), y: bodyBottom + 17, 'text-anchor': 'middle' }, svg);
    tx.textContent = fr(t, td);
  });
  sv('line', { x1: mL, x2: w - mR, y1: bodyBottom, y2: bodyBottom, class: 'zero' }, svg);
  if (cfg.xTitle) { const tt = sv('text', { x: (mL + w - mR) / 2, y: H - 6, 'text-anchor': 'middle' }, svg); tt.textContent = cfg.xTitle; }
  if (cfg.ref && Number.isFinite(cfg.ref.v)) {
    const rl = sv('line', { class: 'ref', x1: x(cfg.ref.v), x2: x(cfg.ref.v), y1: hasRefLabel ? mT - 8 : mT, y2: bodyBottom }, svg);
    rl.style.opacity = '0.7';
    if (hasRefLabel) {
      const rt = sv('text', { x: x(cfg.ref.v), y: mT - 12, 'text-anchor': 'middle' }, svg);
      rt.textContent = cfg.ref.label;
    }
  }
  const layout = [];
  rows.forEach((r) => {
    const h = r.header ? headH : rowH;
    layout.push({ r, y0: yy, h });
    yy += h;
  });
  layout.forEach(({ r, y0, h }) => {
    if (r.header) {
      const t = sv('text', { x: 0, y: y0 + h / 2 + 8, class: 't-head' }, svg);
      t.textContent = r.label;
      return;
    }
    const cy = stacked ? y0 + h - 13 : y0 + h / 2;
    if (r.sel) { const bg = sv('rect', { class: 'row-sel', x: 0, y: y0, width: w, height: h, rx: 6 }, svg); bg.setAttribute('aria-hidden', 'true'); }
    const lab = sv('text', { x: stacked ? 4 : 0, y: stacked ? y0 + 13 : cy + 4, class: r.sel ? 't-sel' : '' }, svg);
    lab.textContent = fitText(svg, r.label, labW, r.sel ? 't-sel' : '');
    const col = r.color || ACC;
    if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) {
      const wh = sv('line', { x1: x(r.lo), x2: x(r.hi), y1: cy, y2: cy, 'stroke-linecap': 'round' }, svg);
      wh.style.stroke = col; wh.style.strokeWidth = '2'; wh.style.opacity = r.hollow ? '0.35' : '0.7';
    }
    const d = sv('circle', { cx: x(r.v), cy, r: 5.5 }, svg);
    if (r.hollow) { d.style.fill = 'var(--color-panel)'; d.style.stroke = col; d.style.strokeWidth = '2'; }
    else { d.style.fill = col; d.style.stroke = 'var(--color-panel)'; d.style.strokeWidth = '2'; }
    const endX = Math.max(x(r.v), Number.isFinite(r.hi) ? x(r.hi) : -1e9);
    const vt = r.hollow ? (r.note || 'bord') : fr(r.v, 1);
    const vw = textW(svg, vt);
    const inside = endX + 10 + vw > w + 2;
    const lt = sv('text', { x: inside ? Math.min(x(r.v), Number.isFinite(r.lo) ? x(r.lo) : x(r.v)) - 10 : endX + 10, y: cy + 4, 'text-anchor': inside ? 'end' : 'start', class: 'halo' }, svg);
    lt.textContent = vt;
    const hit = sv('rect', { class: 'row-hit', x: 0, y: y0, width: w, height: h, tabindex: 0, role: cfg.onClick ? 'button' : 'img', 'aria-label': r.label + ' : ' + (r.hollow ? 'pas de pic net' : fr(r.v, 1) + ' ans') }, svg);
    const hv = (ev) => {
      const t0 = hit.getBoundingClientRect();
      tipShow(ev && ev.clientX !== undefined ? ev.clientX : t0.left + 40, ev && ev.clientY !== undefined ? ev.clientY : t0.top, (t) => r.tip(t));
    };
    hit.addEventListener('pointermove', hv);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') tipHide(); });
    hit.addEventListener('focus', () => hv(null));
    hit.addEventListener('blur', tipHide);
    if (cfg.onClick) {
      hit.addEventListener('click', () => cfg.onClick(r.key));
      hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.onClick(r.key); } });
    }
  });
}

/* ==========================================================================
   3. Âge du pic selon l’indicateur + mosaïque des courbes
   ========================================================================== */
function metricRowsFor(P) {
  return rowsOf('indicateurs').slice().sort((a, b) => a.ordre - b.ordre);
}
function drawMetrics(P) {
  const host = $('#ch-metrics');
  const inds = metricRowsFor(P);
  const rows = [];
  let lastFam = null;
  let any = false;
  inds.forEach((ind) => {
    const pk = picsRow(P, { metric: ind.metric });
    if (!pk) return;
    any = true;
    if (ind.famille !== lastFam) { rows.push({ header: true, label: ind.famille }); lastFam = ind.famille; }
    const hollow = isEdge(pk);
    rows.push({
      key: ind.metric, label: ind.label, v: pk.peak, lo: pk.peak_lo, hi: pk.peak_hi, hollow, note: 'bord', sel: ind.metric === P.metric,
      tip: (t) => {
        tH(t, ind.label);
        if (hollow) { tR(t, ACC, 'Maximum', 'au bord (' + fr(pk.peak, 0) + ' ans)'); tS(t, 'Pas de pic intermédiaire net : le niveau est maximal à l’âge le plus bas observé.'); }
        else { tR(t, ACC, 'Pic', fr(pk.peak, 1) + ' ans'); tR(t, null, 'Intervalle', fr(pk.peak_lo, 1) + ' à ' + fr(pk.peak_hi, 1)); }
        tS(t, frInt(pk.n_pairs) + ' paires de saisons · ' + frInt(pk.n_players) + ' joueurs');
      },
    });
  });
  if (!any) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres : élargissez le poste, l’époque ou le seuil de minutes.', true); return; }
  dotPlot(host, rows, { xTitle: 'Âge du pic (ans)', onClick: (k) => dash.setParams({ metric: k }), aria: 'Âge du pic de chaque indicateur, avec intervalle', maxLabel: 200 });
}

function drawMosaic(P) {
  const host = $('#ch-mosaic');
  const inds = metricRowsFor(P);
  host.classList.remove('dash-skeleton');
  clear(host);
  host.style.minHeight = '0';
  // échelle commune : écart au pic / écart-type de l’indicateur
  const items = [];
  let yMin = 0, aMin = Infinity, aMax = -Infinity;
  inds.forEach((ind) => {
    const rows = curveRows(P, { metric: ind.metric });
    if (!rows.length) { items.push({ ind, rows: null }); return; }
    const sd = ind.sd;
    rows.forEach((r) => { yMin = Math.min(yMin, r.g / sd); aMin = Math.min(aMin, r.age); aMax = Math.max(aMax, r.age); });
    items.push({ ind, rows, sd });
  });
  if (!items.some((it) => it.rows)) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres.', true); return; }
  yMin = Math.floor(yMin * 2) / 2;
  items.forEach((it) => {
    const { ind } = it;
    const b = el('button', 'nb-mini');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ind.metric === P.metric));
    const pk = picsRow(P, { metric: ind.metric });
    b.appendChild(el('div', 'nb-mini-t', ind.label));
    b.appendChild(el('div', 'nb-mini-v', it.rows && pk ? (isEdge(pk) ? 'pas de pic net' : 'pic : ' + fr(pk.peak, 1) + ' ans') : 'données insuffisantes'));
    host.appendChild(b);
    b.addEventListener('click', () => dash.setParams({ metric: ind.metric }));
    if (!it.rows) return;
    const cw = Math.max(120, b.clientWidth - 22), ch = 64;
    const svg = sv('svg', { width: '100%', viewBox: '0 0 ' + cw + ' ' + ch, role: 'img', 'aria-label': 'Courbe d’âge : ' + ind.label }, b);
    const x = d3.scaleLinear([aMin, aMax], [3, cw - 3]);
    const y = d3.scaleLinear([yMin, 0.12], [ch - 3, 3]);
    sv('line', { class: 'zero', x1: 3, x2: cw - 3, y1: y(0), y2: y(0), style: 'stroke:var(--cds-chart-axis);stroke-width:1' }, svg);
    const ln = d3.line().x((r) => x(r.age)).y((r) => y(r.g / it.sd));
    const p = sv('path', { d: ln(it.rows), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    p.style.stroke = ind.metric === P.metric ? ACC : 'var(--cds-chart-reference)'; p.style.strokeWidth = '2';
    if (pk && !isEdge(pk)) {
      const d = sv('circle', { cx: x(pk.peak), cy: y(0), r: 4 }, svg);
      d.style.fill = ind.metric === P.metric ? ACC : 'var(--color-fg-muted)'; d.style.stroke = 'var(--color-panel)'; d.style.strokeWidth = '2';
    }
  });
}

/* ==========================================================================
   Tableaux (jumeaux textuels des graphiques)
   ========================================================================== */
function fillTable(tbl, rows, keyCols, cols) {
  const tb = tbl.tBodies[0];
  clear(tb);
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = keyCols.map((k) => encodeURIComponent(String(r[k]))).join(',');
    cols.forEach((c) => { const td = document.createElement('td'); td.textContent = c(r); tr.appendChild(td); });
    tb.appendChild(tr);
  });
}

/* ==========================================================================
   4. Comparaisons : poste, époque, minutes
   ========================================================================== */
function groupSpec(P) {
  const dim = P.dim;
  const opts = optList(dim).filter((o) => !(dim !== 'thr' && o.valeur === 'all'));
  return opts.map((o, i) => ({ value: o.valeur, label: o.libelle, color: COL[i % COL.length], over: { [dim]: o.valeur } }));
}
function drawGroups(P, ind) {
  const host = $('#ch-groups');
  const groups = groupSpec(P);
  const rows = [];
  const data = [];
  groups.forEach((g) => {
    const pk = picsRow(P, g.over);
    if (!pk) { rows.push({ key: g.value, label: g.label + ' (échantillon insuffisant)', v: NaN, lo: NaN, hi: NaN, color: g.color, missing: true }); return; }
    data.push({ g, pk });
    const hollow = isEdge(pk);
    rows.push({
      key: g.value, label: g.label, v: pk.peak, lo: pk.peak_lo, hi: pk.peak_hi, color: g.color, hollow, note: 'bord', sel: String(P[P.dim]) === String(g.value),
      tip: (t) => {
        tH(t, g.label);
        if (hollow) tR(t, g.color, 'Maximum', 'au bord (' + fr(pk.peak, 0) + ' ans)');
        else { tR(t, g.color, 'Pic', fr(pk.peak, 1) + ' ans'); tR(t, null, 'Intervalle', fr(pk.peak_lo, 1) + ' à ' + fr(pk.peak_hi, 1)); }
        tS(t, frInt(pk.n_pairs) + ' paires de saisons · ' + frInt(pk.n_players) + ' joueurs');
      },
    });
  });
  const shown = rows.filter((r) => !r.missing);
  const miss = rows.filter((r) => r.missing).map((r) => r.label.replace(' (échantillon insuffisant)', ''));
  const mn = $('#miss-groups');
  mn.hidden = !miss.length;
  mn.textContent = miss.length ? 'Non représenté faute d’échantillon suffisant avec ces filtres : ' + miss.join(', ') + '.' : '';
  if (!shown.length) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres.', true); return; }
  let ref = null;
  if (P.dim !== 'thr') {
    const pr = picsRow(P, { [P.dim]: 'all' });
    if (pr && !isEdge(pr)) ref = { v: pr.peak, label: 'Ensemble' };
  }
  dotPlot(host, shown, { xTitle: 'Âge du pic (ans)', ref, onClick: (k) => dash.setParams({ [P.dim]: k }), aria: 'Âge du pic selon le groupe' });
  // jumeau tableau
  const tb = $('#tb-groups');
  const tr = data.map((d) => Object.assign({ _label: d.g.label }, d.pk));
  fillTable(tb, tr, ['metric', 'pos', 'era', 'thr'], [(r) => r._label, (r) => fr(r.peak, 1), (r) => fr(r.peak_lo, 1), (r) => fr(r.peak_hi, 1), (r) => frInt(r.n_pairs), (r) => frInt(r.n_players)]);
}

function drawGroupCurves(P, ind) {
  const host = $('#ch-groupcurves');
  const groups = groupSpec(P).map((g) => Object.assign({}, g, { rows: curveRows(P, g.over), pk: picsRow(P, g.over) })).filter((g) => g.rows.length);
  const dd = ind.dd, unit = ind.unite;
  if (!groups.length) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres.', true); return; }
  legend($('#lg-groups'), groups.map((g) => ({ kind: 'line', color: g.color, text: g.label })));
  clear($('#cap-groups'));
  const absents = groupSpec(P).filter((g) => !groups.some((k) => k.value === g.value)).map((g) => g.label);
  $('#cap-groups').appendChild(document.createTextNode('Écart au pic, en ' + unit + ' (zéro = maximum du groupe)'
    + (absents.length ? '. Non représenté faute d’échantillon suffisant avec ces filtres : ' + absents.join(', ') + '.' : '')));
  const H = host.clientWidth < 520 ? 320 : 380;
  const { svg, w } = mkSvg(host, H, 'Courbes d’âge de chaque groupe, rapportées à leur propre maximum');
  const ages = d3.range(d3.min(groups, (g) => g.rows[0].age), d3.max(groups, (g) => g.rows[g.rows.length - 1].age) + 1);
  const a0 = ages[0], a1 = ages[ages.length - 1];
  const yLo = d3.min(groups, (g) => d3.min(g.rows, (r) => r.g));
  const span = Math.abs(yLo) || 1;
  const yDom = [yLo - 0.03 * span, 0.07 * span];
  const yTicks = d3.ticks(yDom[0], yDom[1], 5).filter((t) => t <= yDom[1] + 1e-9);
  const td = tickDec(yTicks);
  const m = { t: 18, r: 14, b: 48, l: Math.ceil(d3.max(yTicks, (t) => textW(svg, fr(t, td)))) + 14 };
  const x = d3.scaleLinear([a0 - 0.5, a1 + 0.5], [m.l, w - m.r]);
  const y = d3.scaleLinear(yDom, [H - m.b, m.t]);
  const ay = H - m.b;
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(a0, a1, w), m, w, H, 'Âge au premier février de la saison');
  sv('line', { class: 'zero', x1: m.l, x2: w - m.r, y1: y(0), y2: y(0) }, svg);
  groups.forEach((g) => {
    const ln = d3.line().x((r) => x(r.age)).y((r) => y(r.g));
    const p = sv('path', { d: ln(g.rows), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    p.style.stroke = g.color; p.style.strokeWidth = '2';
  });
  groups.forEach((g) => {
    if (g.pk && !isEdge(g.pk)) {
      const d = sv('circle', { cx: x(g.pk.peak), cy: y(0), r: 5 }, svg);
      d.style.fill = g.color; d.style.stroke = 'var(--color-panel)'; d.style.strokeWidth = '2';
    }
  });
  const byAge = new Map();
  ages.forEach((a) => byAge.set(a, groups.map((g) => ({ g, r: g.rows.find((r) => r.age === a) }))));
  crosshair(svg, w, {
    n: ages.length, px: (i) => x(ages[i]), y0: m.t, y1: ay, x0: m.l, x1: w - m.r,
    label: 'Lecture des courbes par groupe : flèches gauche et droite',
    dots: (i) => byAge.get(ages[i]).filter((e) => e.r).map((e) => ({ y: y(e.r.g), color: e.g.color })),
    tipFn: (i, t) => {
      tH(t, fr(ages[i], 0) + ' ans');
      byAge.get(ages[i]).forEach((e) => { if (e.r) tR(t, e.g.color, e.g.label, fr(e.r.g, dd, true)); });
    },
  });
  // jumeau tableau
  const tbl = $('#tb-groupcurves');
  const trs = [];
  groups.forEach((g) => g.rows.forEach((r) => trs.push(Object.assign({ _label: g.label }, r))));
  fillTable(tbl, trs, ['metric', 'pos', 'era', 'thr', 'age'], [(r) => r._label, (r) => fr(r.age, 0), (r) => fr(r.g, dd, true), (r) => fr(r.g_lo, dd, true), (r) => fr(r.g_hi, dd, true)]);
}

const ANC_METRICS = ['bpm', 'ws48', 'per', 'vorp82', 'ws82'];
function drawAnciennete(P) {
  const eras = optList('era').filter((o) => o.valeur !== 'all');
  const metric = ANC_METRICS.indexOf(P.metric) >= 0 ? P.metric : 'bpm';
  const ind = get('indicateurs', metric);
  const mkRows = (axe) => {
    const rows = [];
    eras.forEach((o, i) => {
      const r = get('anciennete', metric, o.valeur, axe);
      if (!r) return;
      rows.push({
        key: o.valeur, label: o.libelle, v: r.peak, lo: r.lo, hi: r.hi, color: COL[0],
        tip: (t) => {
          tH(t, o.libelle);
          tR(t, COL[0], axe === 'age' ? 'Âge au pic' : 'Saison de carrière au pic', fr(r.peak, 1));
          tR(t, null, 'Intervalle', fr(r.lo, 1) + ' à ' + fr(r.hi, 1));
          tS(t, 'Âge moyen des recrues : ' + fr(r.rookie_age, 1) + ' ans');
        },
      });
    });
    return rows;
  };
  const ha = $('#ch-anc-age'), he = $('#ch-anc-exp');
  const ra = mkRows('age'), re = mkRows('exp');
  const refA = get('anciennete', metric, 'all', 'age'), refE = get('anciennete', metric, 'all', 'exp');
  if (!ra.length) { showMsg(ha, 'Données indisponibles.', true); showMsg(he, 'Données indisponibles.', true); return; }
  dotPlot(ha, ra, { xTitle: 'Âge au pic (ans)', ref: refA ? { v: refA.peak, label: 'Ensemble' } : null, mR: 40, maxLabel: 120, rowH: 26, aria: 'Âge au pic par époque' });
  dotPlot(he, re, { xTitle: 'Saison de carrière au pic', ref: refE ? { v: refE.peak, label: 'Ensemble' } : null, mR: 40, maxLabel: 120, rowH: 26, aria: 'Saison de carrière au pic par époque' });
  // texte de lecture avec marques : la conclusion dépend de l’écart relatif entre les deux axes
  const first = eras[0], last = eras[eras.length - 1];
  const W = (era, axe) => ({ metric, era, axe });
  const spread = (axe) => { const a = eras.map((o) => get('anciennete', metric, o.valeur, axe)).filter(Boolean); return a.length ? d3.max(a, (r) => r.peak) - d3.min(a, (r) => r.peak) : NaN; };
  const sA = spread('age'), sE = spread('exp');
  let verdict;
  if (sA < 0.6 * sE) verdict = 'L’âge au pic varie donc moins d’une période à l’autre que la saison de carrière, ce qui tend à indiquer que la trajectoire suit l’âge davantage que l’ancienneté.';
  else if (sE < 0.6 * sA) verdict = 'La saison de carrière au pic varie donc moins d’une période à l’autre que l’âge, ce qui tend à indiquer que la trajectoire suit l’ancienneté davantage que l’âge.';
  else verdict = 'Les deux mesures varient de façon comparable d’une période à l’autre : ces données ne permettent pas de trancher entre l’âge et l’ancienneté.';
  const note = $('#note-anc');
  note.textContent = 'Pic estimé par époque, selon l’âge du joueur puis selon son nombre de saisons passées en NBA (indicateur : ' + ind.label + (metric !== P.metric ? ', seul indicateur de cette analyse proche de celui sélectionné' : '') + ').';
  sentence($('#read-anc'), [
    'L’âge moyen des recrues passe de ', mk('anciennete', 'rookie_age', W(first.valeur, 'age'), 1, false, P), '\u00a0ans (', first.libelle, ') à ', mk('anciennete', 'rookie_age', W(last.valeur, 'age'), 1, false, P), '\u00a0ans (', last.libelle,
    '). Dans le même temps, l’âge au pic évolue de ', mk('anciennete', 'peak', W(first.valeur, 'age'), 1, false, P), ' à ', mk('anciennete', 'peak', W(last.valeur, 'age'), 1, false, P),
    '\u00a0ans, tandis que la saison de carrière au pic passe de ', mk('anciennete', 'peak', W(first.valeur, 'exp'), 1, false, P), ' à ', mk('anciennete', 'peak', W(last.valeur, 'exp'), 1, false, P), '. ', verdict,
  ]);
  const rows = [];
  eras.forEach((o) => ['age', 'exp'].forEach((axe) => { const r = get('anciennete', metric, o.valeur, axe); if (r) rows.push(Object.assign({ _era: o.libelle, _axe: axe === 'age' ? 'Âge' : 'Saison de carrière' }, r)); }));
  fillTable($('#tb-anc'), rows, ['metric', 'era', 'axe'], [(r) => r._era, (r) => r._axe, (r) => fr(r.peak, 1), (r) => fr(r.lo, 1), (r) => fr(r.hi, 1), (r) => fr(r.rookie_age, 1)]);
}

/* ==========================================================================
   Graphique en barres (histogrammes, effectifs, minutes)
   bars : { x, y, tip(t) }
   ========================================================================== */
function barChart(host, bars, cfg) {
  const H = cfg.h || (host.clientWidth < 520 ? 260 : 300);
  const { svg, w } = mkSvg(host, H, cfg.aria || '');
  const yMax = cfg.yMax !== undefined ? cfg.yMax : d3.max(bars, (b) => b.y) * 1.1;
  const yTicks = d3.ticks(0, yMax, 5);
  const td = tickDec(yTicks);
  const labW = d3.max(yTicks, (t) => textW(svg, fr(t, td)));
  const m = { t: 22, r: 14, b: 46, l: Math.ceil(labW) + 14 };
  const xs = bars.map((b) => b.x);
  const x0 = d3.min(xs), x1 = d3.max(xs);
  const x = d3.scaleLinear([x0 - 0.5, x1 + 0.5], [m.l, w - m.r]);
  const y = d3.scaleLinear([0, yMax], [H - m.b, m.t]);
  const ay = H - m.b;
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(x0, x1, w).filter((t) => t >= x0 && t <= x1), m, w, H, cfg.xTitle);
  if (cfg.band) {
    const bx0 = x(cfg.band.lo), bx1 = x(cfg.band.hi);
    const r = sv('rect', { x: bx0, y: m.t, width: Math.max(0, bx1 - bx0), height: ay - m.t }, svg);
    r.style.fill = ACC; r.style.opacity = '0.1';
  }
  const bw = Math.max(3, Math.min(24, (x(x0 + 1) - x(x0)) * 0.7));
  bars.forEach((b) => {
    const p = sv('path', { d: barPath(x(b.x) - bw / 2, ay, y(b.y), bw, 4) }, svg);
    p.style.fill = ACC; p.style.opacity = '0.88';
    const hit = sv('rect', { class: 'row-hit', x: x(b.x) - Math.max(bw, (x(x0 + 1) - x(x0))) / 2, y: m.t, width: Math.max(bw, (x(x0 + 1) - x(x0))), height: ay - m.t, tabindex: 0, role: 'img', 'aria-label': b.aria || '' }, svg);
    const hv = (ev) => {
      const t0 = hit.getBoundingClientRect();
      tipShow(ev && ev.clientX !== undefined ? ev.clientX : t0.left + t0.width / 2, ev && ev.clientY !== undefined ? ev.clientY : t0.top + 20, (t) => b.tip(t));
    };
    hit.addEventListener('pointermove', hv);
    hit.addEventListener('pointerdown', hv);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') tipHide(); });
    hit.addEventListener('focus', () => hv(null));
    hit.addEventListener('blur', tipHide);
  });
  if (cfg.median !== undefined && Number.isFinite(cfg.median)) {
    const ml = sv('line', { x1: x(cfg.median), x2: x(cfg.median), y1: m.t - 4, y2: ay, style: 'stroke:var(--color-fg);stroke-width:1.5;pointer-events:none' }, svg);
    ml.style.opacity = '0.75';
    const lb = 'Médiane : ' + fr(cfg.median, 1) + ' ans';
    const tw = textW(svg, lb, 't-strong');
    const right = x(cfg.median) + tw + 10 < w - m.r;
    const t = sv('text', { x: x(cfg.median) + (right ? 6 : -6), y: m.t - 8, 'text-anchor': right ? 'start' : 'end', class: 't-strong' }, svg);
    t.textContent = lb;
  }
}

/* ==========================================================================
   5. Joueurs : pics individuels
   ========================================================================== */
function drawHist(P, ind) {
  const host = $('#ch-hist');
  const hrows = histBy.get(P.metric + '|' + P.pos + '|' + P.era + '|' + P.minlen);
  const res = get('indiv_resume', P.metric, P.pos, P.era, Number(P.minlen));
  const tb = $('#tb-hist');
  if (!hrows || !res) {
    showMsg(host, P.era === '2020-2026' ? 'Les carrières de cette période ne sont pas encore terminées : l’analyse individuelle du pic porte sur des carrières achevées.' : 'Moins de quinze carrières terminées pour cette combinaison de filtres : élargissez le poste, l’époque ou la durée de carrière.', true);
    clear(tb.tBodies[0]);
    return;
  }
  const bars = hrows.map((r) => ({
    x: r.age, y: r.share * 100,
    aria: fr(r.age, 0) + ' ans : ' + fr(r.share * 100, 1) + ' % des joueurs',
    tip: (t) => { tH(t, 'Pic individuel à ' + fr(r.age, 0) + ' ans'); tR(t, ACC, 'Part des joueurs', fr(r.share * 100, 1) + ' %'); tS(t, frInt(r.n) + ' joueurs sur ' + frInt(res.n)); },
  }));
  barChart(host, bars, { xTitle: 'Âge du pic individuel', median: res.median, band: { lo: res.q25 - 0.5, hi: res.q75 + 0.5 }, aria: 'Répartition des âges du pic individuel', h: host.clientWidth < 520 ? 270 : 310 });
  fillTable(tb, hrows, ['metric', 'pos', 'cohort', 'minlen', 'age'], [(r) => fr(r.age, 0), (r) => frInt(r.n), (r) => fr(r.share * 100, 1) + ' %']);
}
function drawMinlen(P) {
  const host = $('#ch-minlen');
  const opts = optList('minlen');
  const rows = [];
  const trs = [];
  opts.forEach((o) => {
    const r = get('indiv_resume', P.metric, P.pos, P.era, Number(o.valeur));
    if (!r) return;
    trs.push(r);
    rows.push({
      key: o.valeur, label: o.libelle, v: r.mean, lo: r.q25, hi: r.q75, color: ACC, sel: String(P.minlen) === String(o.valeur),
      tip: (t) => { tH(t, o.libelle); tR(t, ACC, 'Moyenne', fr(r.mean, 1) + ' ans'); tR(t, null, 'Médiane', fr(r.median, 1) + ' ans'); tR(t, null, 'Moitié centrale', fr(r.q25, 1) + ' à ' + fr(r.q75, 1)); tS(t, frInt(r.n) + ' joueurs'); },
    });
  });
  if (!rows.length) { showMsg(host, 'Pas assez de carrières terminées pour cette combinaison de filtres.', true); clear($('#tb-minlen').tBodies[0]); return; }
  dotPlot(host, rows, { xTitle: 'Âge du pic individuel (ans)', onClick: (k) => dash.setParams({ minlen: k }), maxLabel: 130, rowH: 30, aria: 'Pic individuel moyen selon la durée minimale de carrière' });
  fillTable($('#tb-minlen'), trs, ['metric', 'pos', 'cohort', 'minlen'], [(r) => fr(r.minlen, 0), (r) => fr(r.mean, 1), (r) => fr(r.median, 1), (r) => fr(r.q25, 1), (r) => fr(r.q75, 1), (r) => frInt(r.n)]);
}

/* ---------- explorateur de joueur ---------- */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let sugSig = '';
function setupPlayerSearch(P) {
  const players = rowsOf('joueurs_resume');
  const chips = $('#pl-chips');
  const sig = players.length + ':' + P.player;
  if (sugSig !== sig.split(':')[0]) {
    sugSig = sig.split(':')[0];
    clear(chips);
    players.slice().sort((a, b) => a.rank_vorp - b.rank_vorp).slice(0, 10).forEach((p) => {
      const b = el('button', 'nb-chip', p.name);
      b.type = 'button';
      b.dataset.pid = p.player_id;
      b.addEventListener('click', () => { $('#pl-q').value = ''; $('#pl-sugg').hidden = true; dash.setParams({ player: p.player_id }); });
      chips.appendChild(b);
    });
  }
  $$('.nb-chip', chips).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pid === P.player)));
}
function bindPlayerInput() {
  const q = $('#pl-q'), sug = $('#pl-sugg');
  const run = () => {
    const s = norm(q.value.trim());
    clear(sug);
    if (s.length < 2) { sug.hidden = true; return; }
    const hits = rowsOf('joueurs_resume').filter((p) => norm(p.name).indexOf(s) >= 0).sort((a, b) => a.rank_vorp - b.rank_vorp).slice(0, 8);
    if (!hits.length) { const d = el('div', 'nb-err nb-info', 'Aucun joueur trouvé : l’explorateur ne couvre que les joueurs ayant débuté après la première saison analysée et disputé plusieurs saisons complètes.'); d.style.minHeight = '60px'; sug.appendChild(d); sug.hidden = false; return; }
    hits.forEach((p) => {
      const b = el('button');
      b.type = 'button';
      b.appendChild(el('span', null, p.name));
      b.appendChild(el('small', null, yr(p.first_season) + '–' + yr(p.last_season)));
      b.addEventListener('click', () => { q.value = ''; sug.hidden = true; dash.setParams({ player: p.player_id }); });
      sug.appendChild(b);
    });
    sug.hidden = false;
  };
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sug.hidden = true; } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest || !e.target.closest('.nb-search')) sug.hidden = true; });
}
function drawPlayer(P, ind) {
  const host = $('#ch-player');
  const jr = get('joueurs_resume', P.player);
  const seasons = (byPlayer.get(P.player) || []).filter((r) => Number.isFinite(r[P.metric]));
  const line = $('#pl-line');
  const tbl = $('#tb-player');
  const thVal = $('.nb-th-val', tbl);
  thVal.dataset.field = P.metric;
  thVal.textContent = 'Valeur (' + ind.label + ')';
  if (!jr || !seasons.length) {
    showMsg(host, jr ? 'Cet indicateur n’est pas disponible pour les saisons de ce joueur.' : 'Joueur introuvable dans la table.', true);
    sentence(line, []);
    clear(tbl.tBodies[0]);
    clear($('#lg-player')); clear($('#cap-player'));
    return;
  }
  const dd = ind.dd, unit = ind.unite;
  const centered = /^Écart/.test(ind.axe);
  const curve = curveRows(P);
  const gOf = new Map(curve.map((r) => [r.age, r.g]));
  // niveau propre au joueur : moyenne pondérée de (valeur − courbe)
  let num = 0, den = 0;
  seasons.forEach((r) => { if (gOf.has(r.age)) { num += r.mp82 * (r[P.metric] - gOf.get(r.age)); den += r.mp82; } });
  const c = den > 0 ? num / den : NaN;
  const ages = seasons.map((r) => r.age);
  const amin = d3.min(ages), amax = d3.max(ages);
  const typ = Number.isFinite(c) ? curve.filter((r) => r.age >= amin - 1 && r.age <= amax + 2).map((r) => ({ age: r.age, v: c + r.g })) : [];
  // fenêtre du meilleur pic individuel
  const pkAge = jr['pk_' + P.metric + '_age'], pkSeason = jr['pk_' + P.metric + '_season'];
  const winRows = Number.isFinite(pkSeason) ? seasons.filter((r) => r.season >= pkSeason - 1 && r.season <= pkSeason + 1) : [];
  // texte
  const posLbl = jr.pos ? ' (' + optLabel('pos', jr.pos).toLowerCase() + ')' : '';
  const W = { player_id: P.player };
  const parts = [mk('joueurs_resume', 'name', W, 't', false, P), posLbl + ', saisons ', mk('joueurs_resume', 'first_season', W, 'y', false, P), ' à ', mk('joueurs_resume', 'last_season', W, 'y', false, P), ' : '];
  if (Number.isFinite(pkAge)) {
    parts.push('meilleure période de trois saisons centrée sur ', mk('joueurs_resume', 'pk_' + P.metric + '_age', W, 1, false, P), '\u00a0ans (saison ', mk('joueurs_resume', 'pk_' + P.metric + '_season', W, 'y', false, P), ')');
    if (!jr.retired) parts.push(' ; la carrière se poursuit, ce pic reste donc provisoire');
    parts.push('.');
  } else parts.push('pas assez de saisons consécutives pour définir un pic sur cet indicateur.');
  sentence(line, parts);
  legend($('#lg-player'), [
    { kind: 'dot', color: ACC, text: 'Niveau du joueur, saison par saison' },
    { kind: 'dash', color: 'var(--cds-chart-reference)', text: 'Courbe moyenne recalée sur son niveau' },
    { kind: 'band', color: ACC, text: 'Meilleure période de trois saisons' },
  ]);
  clear($('#cap-player'));
  $('#cap-player').appendChild(document.createTextNode((centered ? 'Écart à la moyenne de la ligue, en ' : 'Valeur en ') + unit));
  // échelle
  const H = host.clientWidth < 520 ? 320 : 380;
  const { svg, w } = mkSvg(host, H, 'Trajectoire du joueur pour l’indicateur ' + ind.label);
  const vals = seasons.map((r) => r[P.metric]).concat(typ.map((r) => r.v));
  if (centered) vals.push(0);
  let lo = d3.min(vals), hi = d3.max(vals);
  const pad = (hi - lo) * 0.08 || 0.5;
  const yDom = [lo - pad, hi + pad];
  const yTicks = d3.ticks(yDom[0], yDom[1], 5);
  const td = tickDec(yTicks);
  const m = { t: 20, r: 14, b: 48, l: Math.ceil(d3.max(yTicks, (t) => textW(svg, fr(t, td)))) + 14 };
  const a0 = Math.min(amin, typ.length ? typ[0].age : amin), a1 = Math.max(amax, typ.length ? typ[typ.length - 1].age : amax);
  const x = d3.scaleLinear([a0 - 0.7, a1 + 0.7], [m.l, w - m.r]);
  const y = d3.scaleLinear(yDom, [H - m.b, m.t]);
  const ay = H - m.b;
  if (winRows.length) {
    const wx0 = x(d3.min(winRows, (r) => r.age) - 0.5), wx1 = x(d3.max(winRows, (r) => r.age) + 0.5);
    const r = sv('rect', { x: wx0, y: m.t, width: wx1 - wx0, height: ay - m.t }, svg);
    r.style.fill = ACC; r.style.opacity = '0.12';
  }
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(a0, a1, w).filter((t) => t >= a0 - 0.7 && t <= a1 + 0.7), m, w, H, 'Âge au premier février de la saison');
  if (centered && yDom[0] < 0 && yDom[1] > 0) sv('line', { class: 'zero', x1: m.l, x2: w - m.r, y1: y(0), y2: y(0) }, svg);
  if (typ.length) {
    const ln = d3.line().x((r) => x(r.age)).y((r) => y(r.v));
    const p = sv('path', { d: ln(typ), fill: 'none', 'stroke-dasharray': '5 4' }, svg);
    p.style.stroke = 'var(--cds-chart-reference)'; p.style.strokeWidth = '2';
  }
  // trait du joueur (rompu entre saisons non consécutives)
  const segs = [];
  let cur = [];
  seasons.forEach((r, i) => { if (i > 0 && r.season - seasons[i - 1].season !== 1) { segs.push(cur); cur = []; } cur.push(r); });
  if (cur.length) segs.push(cur);
  segs.forEach((sg) => {
    if (sg.length < 2) return;
    const ln = d3.line().x((r) => x(r.age)).y((r) => y(r[P.metric]));
    const p = sv('path', { d: ln(sg), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    p.style.stroke = ACC; p.style.strokeWidth = '2'; p.style.opacity = '0.75';
  });
  seasons.forEach((r) => {
    const d = sv('circle', { cx: x(r.age), cy: y(r[P.metric]), r: 4.5 }, svg);
    d.style.fill = ACC; d.style.stroke = 'var(--color-panel)'; d.style.strokeWidth = '2';
  });
  const tmap = new Map(typ.map((r) => [r.age, r.v]));
  crosshair(svg, w, {
    n: seasons.length, px: (i) => x(seasons[i].age), y0: m.t, y1: ay, x0: m.l, x1: w - m.r,
    label: 'Lecture des saisons du joueur : flèches gauche et droite',
    dots: (i) => [{ y: y(seasons[i][P.metric]), color: ACC }],
    tipFn: (i, t) => {
      const r = seasons[i];
      tH(t, 'Saison ' + yr(r.season) + ' · ' + fr(r.age, 0) + ' ans');
      tR(t, ACC, ind.label, fr(r[P.metric], dd, centered) + ' ' + unit);
      if (tmap.has(r.age)) tR(t, 'var(--cds-chart-reference)', 'Courbe moyenne recalée', fr(tmap.get(r.age), dd, centered));
      tS(t, frInt(r.mp82) + ' minutes sur une saison complète');
    },
  });
  fillTable(tbl, seasons, ['player_id', 'season'], [(r) => yr(r.season), (r) => fr(r.age, 0), (r) => frInt(r.mp82), (r) => fr(r[P.metric], dd, centered)]);
}

/* ==========================================================================
   6. Méthode
   ========================================================================== */
function drawNaive(P, ind) {
  const host = $('#ch-naive');
  const rows = curveRows(P);
  if (!rows.length) { showMsg(host, 'Pas assez de données pour cette combinaison de filtres.', true); showMsg($('#ch-survie'), 'Pas assez de données pour cette combinaison de filtres.', true); clear($('#tb-naive').tBodies[0]); return; }
  const dd = ind.dd, unit = ind.unite;
  const GREY = 'var(--cds-chart-reference)';
  legend($('#lg-naive'), [
    { kind: 'line', color: ACC, text: 'Variations d’un même joueur (méthode retenue)' },
    { kind: 'line', color: GREY, text: 'Moyenne brute des joueurs présents à chaque âge' },
  ]);
  clear($('#cap-naive'));
  $('#cap-naive').appendChild(document.createTextNode('Écart au maximum de chaque courbe, en ' + unit));
  const H = host.clientWidth < 520 ? 300 : 340;
  const { svg, w } = mkSvg(host, H, 'Comparaison entre la courbe par variations et la moyenne brute par âge');
  const a0 = rows[0].age, a1 = rows[rows.length - 1].age;
  const vals = [];
  rows.forEach((r) => { vals.push(r.g); if (Number.isFinite(r.naive_g)) vals.push(r.naive_g); });
  const yLo = d3.min(vals), span = Math.abs(yLo) || 1;
  const yDom = [yLo - 0.03 * span, 0.07 * span];
  const yTicks = d3.ticks(yDom[0], yDom[1], 5).filter((t) => t <= yDom[1] + 1e-9);
  const td = tickDec(yTicks);
  const m = { t: 16, r: 14, b: 48, l: Math.ceil(d3.max(yTicks, (t) => textW(svg, fr(t, td)))) + 14 };
  const x = d3.scaleLinear([a0 - 0.5, a1 + 0.5], [m.l, w - m.r]);
  const y = d3.scaleLinear(yDom, [H - m.b, m.t]);
  const ay = H - m.b;
  drawGridY(svg, y, yTicks, td, m, w);
  drawAxisX(svg, x, xTicksFor(a0, a1, w), m, w, H, 'Âge au premier février de la saison');
  sv('line', { class: 'zero', x1: m.l, x2: w - m.r, y1: y(0), y2: y(0) }, svg);
  const nrows = rows.filter((r) => Number.isFinite(r.naive_g));
  const l2 = sv('path', { d: d3.line().x((r) => x(r.age)).y((r) => y(r.naive_g))(nrows), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  l2.style.stroke = GREY; l2.style.strokeWidth = '2';
  const l1 = sv('path', { d: d3.line().x((r) => x(r.age)).y((r) => y(r.g))(rows), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  l1.style.stroke = ACC; l1.style.strokeWidth = '2';
  const nTop = nrows.reduce((b, r) => (b === null || r.naive_g > b.naive_g ? r : b), null);
  const gTop = rows.reduce((b, r) => (b === null || r.g > b.g ? r : b), null);
  [[nTop, GREY, 'naive_g'], [gTop, ACC, 'g']].forEach(([r, col, f]) => {
    if (!r) return;
    const d = sv('circle', { cx: x(r.age), cy: y(r[f]), r: 5 }, svg);
    d.style.fill = col; d.style.stroke = 'var(--color-panel)'; d.style.strokeWidth = '2';
  });
  crosshair(svg, w, {
    n: rows.length, px: (i) => x(rows[i].age), y0: m.t, y1: ay, x0: m.l, x1: w - m.r,
    label: 'Comparaison des deux courbes : flèches gauche et droite',
    dots: (i) => [{ y: y(rows[i].g), color: ACC }].concat(Number.isFinite(rows[i].naive_g) ? [{ y: y(rows[i].naive_g), color: GREY }] : []),
    tipFn: (i, t) => {
      const r = rows[i];
      tH(t, fr(r.age, 0) + ' ans');
      tR(t, ACC, 'Variations d’un même joueur', fr(r.g, dd, true));
      if (Number.isFinite(r.naive_g)) tR(t, GREY, 'Moyenne brute', fr(r.naive_g, dd, true));
      if (Number.isFinite(r.naive_n)) tS(t, frInt(r.naive_n) + ' joueurs-saisons observés');
    },
  });
  // effectifs
  const hs = $('#ch-survie');
  const bars = rows.filter((r) => Number.isFinite(r.naive_n)).map((r) => ({
    x: r.age, y: r.naive_n, aria: fr(r.age, 0) + ' ans : ' + frInt(r.naive_n) + ' joueurs-saisons',
    tip: (t) => { tH(t, fr(r.age, 0) + ' ans'); tR(t, ACC, 'Joueurs-saisons', frInt(r.naive_n)); },
  }));
  barChart(hs, bars, { xTitle: 'Âge au premier février de la saison', h: hs.clientWidth < 520 ? 200 : 220, aria: 'Nombre de joueurs-saisons observés à chaque âge' });
  fillTable($('#tb-naive'), rows, ['metric', 'pos', 'era', 'thr', 'age'], [(r) => fr(r.age, 0), (r) => fr(r.g, dd, true), (r) => fr(r.naive_g, dd, true), (r) => frInt(r.naive_n)]);
}
const VARIANTS = [
  ['base', 'Méthode retenue'],
  ['h3', 'Lissage plus étroit'],
  ['h6', 'Lissage plus large'],
  ['poids_egaux', 'Sans pondération par les minutes'],
  ['fe', 'Effets fixes par joueur (polynôme)'],
  ['depuis1952', 'Historique complet (avant la première saison analysée)'],
  ['naif', 'Moyenne brute par âge (à écarter)'],
];
function drawRobust(P, ind) {
  const host = $('#ch-rob');
  const rows = [];
  const trs = [];
  const base = get('robustesse', P.metric, 'base');
  VARIANTS.forEach(([k, lab]) => {
    const r = get('robustesse', P.metric, k);
    if (!r || !Number.isFinite(r.peak)) return;
    trs.push(Object.assign({ _lab: lab }, r));
    rows.push({
      key: k, label: lab, v: r.peak, lo: r.lo, hi: r.hi, color: k === 'naif' ? 'var(--cds-chart-reference)' : ACC, sel: k === 'base',
      tip: (t) => { tH(t, lab); tR(t, k === 'naif' ? 'var(--cds-chart-reference)' : ACC, 'Pic', fr(r.peak, 1) + ' ans'); if (Number.isFinite(r.lo)) tR(t, null, 'Intervalle', fr(r.lo, 1) + ' à ' + fr(r.hi, 1)); tS(t, frInt(r.n) + ' observations'); },
    });
  });
  if (!rows.length) { showMsg(host, 'Données indisponibles pour cet indicateur.', true); clear($('#tb-rob').tBodies[0]); return; }
  dotPlot(host, rows, { xTitle: 'Âge du pic (ans)', ref: base ? { v: base.peak, label: '' } : null, maxLabel: 230, rowH: 30, aria: 'Âge du pic selon la méthode d’estimation' });
  fillTable($('#tb-rob'), trs, ['metric', 'variant'], [(r) => r._lab, (r) => fr(r.peak, 1), (r) => fr(r.lo, 1), (r) => fr(r.hi, 1), (r) => frInt(r.n)]);
}
function drawMinutes(P) {
  const host = $('#ch-minutes');
  const rows = rowsOf('ligue_age').filter((r) => r.era === P.era).sort((a, b) => a.age - b.age).filter((r) => r.age >= 19 && r.age <= 40);
  if (!rows.length) { showMsg(host, 'Données indisponibles.', true); clear($('#tb-minutes').tBodies[0]); return; }
  const bars = rows.map((r) => ({
    x: r.age, y: r.minutes_share, aria: fr(r.age, 0) + ' ans : ' + fr(r.minutes_share, 1) + ' % des minutes',
    tip: (t) => { tH(t, fr(r.age, 0) + ' ans'); tR(t, ACC, 'Part des minutes', fr(r.minutes_share, 1) + ' %'); tS(t, frInt(r.n_seasons) + ' joueurs-saisons'); },
  }));
  barChart(host, bars, { xTitle: 'Âge au premier février de la saison', aria: 'Part des minutes jouées à chaque âge', h: host.clientWidth < 520 ? 240 : 270 });
  fillTable($('#tb-minutes'), rows, ['era', 'age'], [(r) => fr(r.age, 0), (r) => fr(r.minutes_share, 2), (r) => frInt(r.n_seasons)]);
}
function fillGlossary() {
  fillTable($('#tb-gloss'), rowsOf('indicateurs').slice().sort((a, b) => a.ordre - b.ordre), ['metric'], [(r) => r.label, (r) => r.famille, (r) => r.definition]);
}

/* ---------- repères sur les minutes (info-bulle du filtre) ---------- */
function fillReperes() {
  const rows = rowsOf('reperes').slice().sort((a, b) => a.ordre - b.ordre);
  fillTable($('#tb-reperes'), rows, ['profil'], [
    (r) => r.profil, (r) => fr(r.mpm_min, 0), (r) => fr(r.mpm_max, 0), (r) => frInt(r.min_low), (r) => frInt(r.min_high),
  ]);
}
function bindInfo() {
  const b = $('#thr-info'), pop = $('#thr-pop');
  const place = () => {
    const host = pop.parentElement, hr = host.getBoundingClientRect(), br = b.getBoundingClientRect();
    const fr_ = b.closest('.nb-field').getBoundingClientRect();
    pop.style.top = (fr_.bottom - hr.top + 6) + 'px';
    const w = pop.offsetWidth;
    pop.style.left = Math.max(0, Math.min(br.left - hr.left - 12, hr.width - w)) + 'px';
  };
  const close = () => { pop.hidden = true; b.setAttribute('aria-expanded', 'false'); };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pop.hidden) { close(); return; }
    tipHide();
    pop.hidden = false;
    b.setAttribute('aria-expanded', 'true');
    place();
  });
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); b.focus(); } });
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
}

/* ==========================================================================
   Orchestration : phrases de synthèse, filtres, onglets, rendu
   ========================================================================== */
const TABS = ['courbe', 'indicateurs', 'comparaisons', 'joueurs', 'methode'];
let activeTab = 'courbe';
let ctlSig = '';

// un graphique qui échoue ne doit pas arrêter les autres : on l’indique dans son cadre et on remonte l’erreur
function safe(hostSel, fn) {
  try { fn(); } catch (e) {
    const h = $(hostSel);
    if (h) showMsg(h, 'Ce graphique n’a pas pu être dessiné.');
    setTimeout(() => { throw e; }, 0);
  }
}
function caption(sel, text) { const c = $(sel); clear(c); c.appendChild(document.createTextNode(text)); }

/* ---------- valeurs de filtres valides ---------- */
function sanitize(P) {
  const q = Object.assign({}, P);
  ['pos', 'era', 'thr', 'tol', 'minlen'].forEach((k) => { if (!get('options', k, q[k])) q[k] = PDEF[k]; });
  if (!get('indicateurs', q.metric)) q.metric = PDEF.metric;
  if (['pos', 'era', 'thr'].indexOf(q.dim) < 0) q.dim = PDEF.dim;
  if (!get('joueurs_resume', q.player)) q.player = PDEF.player;
  return q;
}

/* ---------- contrôles ---------- */
function populateControls() {
  const sig = rowsOf('indicateurs').length + ':' + rowsOf('options').length;
  if (sig === ctlSig) return;
  ctlSig = sig;
  const sm = $('#f-metric');
  clear(sm);
  let fam = null, grp = null;
  rowsOf('indicateurs').slice().sort((a, b) => a.ordre - b.ordre).forEach((ind) => {
    if (ind.famille !== fam) { fam = ind.famille; grp = document.createElement('optgroup'); grp.label = fam; sm.appendChild(grp); }
    const o = document.createElement('option');
    o.value = ind.metric; o.textContent = ind.label;
    grp.appendChild(o);
  });
  [['pos', '#f-pos'], ['era', '#f-era'], ['thr', '#f-thr'], ['tol', '#f-tol']].forEach(([f, s]) => {
    const e = $(s);
    clear(e);
    optList(f).forEach((o) => { const op = document.createElement('option'); op.value = o.valeur; op.textContent = o.libelle; e.appendChild(op); });
  });
  const sg = $('#seg-minlen');
  clear(sg);
  optList('minlen').forEach((o) => {
    const b = el('button', null, o.libelle.replace(/ ou plus$/, ''));
    b.type = 'button';
    b.dataset.v = o.valeur;
    b.addEventListener('click', () => dash.setParams({ minlen: o.valeur }));
    sg.appendChild(b);
  });
}
function syncControls(P) {
  ['metric', 'pos', 'era', 'thr', 'tol'].forEach((k) => { const e = $('#f-' + k); if (e.value !== P[k]) e.value = P[k]; });
  $$('#seg-dim button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dim === P.dim)));
  $$('#seg-minlen button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === P.minlen)));
}
function bindControls() {
  ['metric', 'pos', 'era', 'thr', 'tol'].forEach((k) => $('#f-' + k).addEventListener('change', (e) => dash.setParams({ [k]: e.target.value })));
  $('#f-reset').addEventListener('click', () => { $('#pl-q').value = ''; $('#pl-sugg').hidden = true; dash.resetParams(); });
  $$('#seg-dim button').forEach((b) => b.addEventListener('click', () => dash.setParams({ dim: b.dataset.dim })));
  TABS.forEach((t) => $('#tabbtn-' + t).addEventListener('click', () => setTab(t)));
  $('.nb-tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(activeTab);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j]);
    $('#tabbtn-' + TABS[j]).focus();
  });
  $('.nb-tabs').addEventListener('scroll', updateTabFade, { passive: true });
  bindPlayerInput();
  bindInfo();
}

/* ---------- onglets ---------- */
function showTab(name) {
  if (TABS.indexOf(name) < 0) name = 'courbe';
  activeTab = name;
  TABS.forEach((t) => {
    const on = t === name;
    $('#' + t).hidden = !on;
    const b = $('#tabbtn-' + t);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // on ne fait défiler que la barre d’onglets, pas la page : sinon l’ouverture se décalerait vers le bas quand la barre n’est pas en haut de page
  const act = $('#tabbtn-' + name);
  const bar = $('.nb-tabs');
  if (bar && bar.scrollWidth > bar.clientWidth) {
    const br = bar.getBoundingClientRect(), ar = act.getBoundingClientRect();
    if (ar.left < br.left) bar.scrollLeft -= (br.left - ar.left) + 8;
    else if (ar.right > br.right) bar.scrollLeft += (ar.right - br.right) + 8;
  }
}
function updateTabFade() {
  const t = $('.nb-tabs');
  t.classList.toggle('nb-more', t.scrollWidth > t.clientWidth + 2 && t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
}
function setTab(name) {
  showTab(name);
  dash.setLink(activeTab);
  tipHide();
  render();
}

/* ---------- phrases de synthèse (chaque chiffre cite sa ligne de données) ---------- */
function buildLead(P, ind) {
  const host = $('#lead');
  const pk = picsRow(P);
  if (!pk || !Number.isFinite(pk.peak)) {
    sentence(host, ['Les filtres choisis laissent trop peu de paires de saisons consécutives pour estimer une courbe d’âge fiable : élargissez le poste, l’époque ou le seuil de minutes.']);
    return;
  }
  const W = keyW(P);
  const Wt = Object.assign({}, W, { tol: P.tol });
  const A1 = Object.assign({}, W, { age: methodVal('ref_age_1') });
  const A2 = Object.assign({}, W, { age: methodVal('ref_age_2') });
  const win = get('fenetres', P.metric, P.pos, P.era, Number(P.thr), Number(P.tol));
  const unit = ind.unite;
  const gapAt = (lead) => [
    lead + ' au pic atteint ', mk('courbes', 'g', A1, 'dd', true, P), '\u00a0', unit, ' à ', mk('methode', 'valeur', { cle: 'ref_age_1' }, 0, false, P),
    '\u00a0ans, puis ', mk('courbes', 'g', A2, 'dd', true, P), '\u00a0', unit, ' à ', mk('methode', 'valeur', { cle: 'ref_age_2' }, 0, false, P), '\u00a0ans.',
  ];
  if (isEdge(pk)) {
    sentence(host, [
      'Pour l’indicateur ', ind.label, ', la courbe moyenne ne présente pas de pic intermédiaire net : son maximum se situe au bord de la plage d’âges observée, vers ',
      mk('pics', 'peak', W, 0, false, P), '\u00a0ans, si bien que la notion d’âge du pic n’a pas de contenu précis pour cette mesure. ',
    ].concat(gapAt('L’écart')));
    return;
  }
  const parts = [
    'Pour l’indicateur ', ind.label, ', le niveau moyen d’un joueur culmine vers ', mk('pics', 'peak', W, 1, false, P), '\u00a0ans (intervalle à ',
    mk('methode', 'valeur', { cle: 'ci_level' }, 0, false, P), '\u00a0%\u00a0: de ', mk('pics', 'peak_lo', W, 1, false, P), ' à ', mk('pics', 'peak_hi', W, 1, false, P), '\u00a0ans). ',
  ];
  if (win && !win.lo_c && !win.hi_c) {
    parts.push('Il demeure à moins de ', mk('fenetres', 'tol', Wt, 0, false, P), '\u00a0% d’un écart-type de ce maximum entre ', mk('fenetres', 'lo', Wt, 1, false, P), ' et ',
      mk('fenetres', 'hi', Wt, 1, false, P), '\u00a0ans ; ');
    parts.push.apply(parts, gapAt('l’écart'));
  } else {
    parts.push.apply(parts, gapAt('L’écart'));
  }
  sentence(host, parts);
}

function metricPeakItems(P) {
  return metricRowsFor(P).map((ind) => ({ ind, pk: picsRow(P, { metric: ind.metric }) })).filter((e) => e.pk && Number.isFinite(e.pk.peak));
}
function buildLeadInd(P) {
  const host = $('#lead-ind');
  const items = metricPeakItems(P);
  if (!items.length) {
    sentence(host, ['Pas assez de données pour comparer les indicateurs avec ces filtres : élargissez le poste, l’époque ou le seuil de minutes.']);
    return;
  }
  const pkMark = (e) => mk('pics', 'peak', keyW(P, { metric: e.ind.metric }), 1, false, P);
  const byPeak = (a, b) => a.pk.peak - b.pk.peak;
  const ok = items.filter((e) => !isEdge(e.pk));
  const edge = items.filter((e) => isEdge(e.pk));
  const glob = ok.filter((e) => e.ind.famille === 'Impact global').sort(byPeak);
  const rest = ok.filter((e) => e.ind.famille !== 'Impact global').sort(byPeak);
  const parts = [];
  const listFr = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1]);
  if (glob.length >= 2) {
    const a = glob[0], b = glob[glob.length - 1];
    parts.push('Les indicateurs d’impact global situent le pic entre ', pkMark(a), '\u00a0ans pour ' + a.ind.label + ' et ', pkMark(b), '\u00a0ans pour ' + b.ind.label + '. ');
  }
  if (rest.length >= 2) {
    const a = rest[0], b = rest[rest.length - 1];
    parts.push('Parmi les autres mesures, le pic le plus précoce est celui de ' + a.ind.label + ', à ', pkMark(a), '\u00a0ans, et le plus tardif celui de ' + b.ind.label + ', à ', pkMark(b),
      '\u00a0ans ; cette dispersion tient en partie à ce que capte chaque indicateur (efficacité, rôle, rebond) et pas seulement au vieillissement. ');
  }
  if (edge.length) {
    parts.push(listFr(edge.map((e) => e.ind.label)) + (edge.length > 1 ? ' n’ont pas de pic intermédiaire net : leur maximum se situe' : ' n’a pas de pic intermédiaire net : son maximum se situe') + ' au bord de la plage d’âges observée.');
  }
  if (!parts.length) parts.push('Les écarts entre indicateurs sont lisibles dans le graphique ci-dessous.');
  sentence(host, parts);
}

/* ---------- rendu par onglet ---------- */
function renderCurveTab(P, ind) {
  const pk = picsRow(P);
  const edge = isEdge(pk);
  const win = get('fenetres', P.metric, P.pos, P.era, Number(P.thr), Number(P.tol));
  $('#hero-label').textContent = pk && edge ? 'Maximum au bord de la plage observée' : 'Âge du pic';
  $('#win-note').textContent = win && (win.lo_c === 1 || win.hi_c === 1) ? ' ; borne tronquée par la plage observée' : '';
  const items = [
    { kind: 'line', color: ACC, text: 'Niveau moyen attendu à chaque âge' },
    { kind: 'band', color: ACC, text: 'Intervalle d’incertitude (rééchantillonnage par joueur)' },
  ];
  if (pk && !edge) items.push({ kind: 'dot', color: ACC, text: 'Âge du pic et son intervalle' });
  legend($('#lg-curve'), items);
  caption('#cap-curve', 'Écart au pic, en ' + ind.unite + ' (zéro : niveau moyen maximal)');
  safe('#ch-curve', () => drawCurve(P, ind));
  legend($('#lg-delta'), [
    { kind: 'bar', color: COL[0], text: 'Gain moyen (lissé)' },
    { kind: 'bar', color: COL[1], text: 'Perte moyenne (lissée)' },
    { kind: 'line', color: 'var(--color-fg)', text: 'Intervalle d’incertitude' },
    { kind: 'dot', color: MUTED, text: 'Moyenne brute, avant lissage' },
  ]);
  caption('#cap-delta', 'Variation annuelle moyenne, en ' + ind.unite + ' par saison');
  safe('#ch-delta', () => drawDelta(P, ind));
  const dd = ind.dd;
  fillTable($('#tb-curve'), curveRows(P), ['metric', 'pos', 'era', 'thr', 'age'], [
    (r) => fr(r.age, 0), (r) => fr(r.g, dd, true), (r) => fr(r.g_lo, dd, true), (r) => fr(r.g_hi, dd, true),
    (r) => fr(r.d_s, dd, true), (r) => frInt(r.n_pairs), (r) => frInt(r.n_players),
  ]);
}
function renderMetricsTab(P) {
  buildLeadInd(P);
  safe('#ch-metrics', () => drawMetrics(P));
  safe('#ch-mosaic', () => drawMosaic(P));
  const rows = metricPeakItems(P).map((e) => Object.assign({ _label: e.ind.label }, e.pk));
  fillTable($('#tb-metrics'), rows, ['metric', 'pos', 'era', 'thr'], [
    (r) => r._label, (r) => fr(r.peak, 1), (r) => fr(r.peak_lo, 1), (r) => fr(r.peak_hi, 1), (r) => frInt(r.n_pairs),
    (r) => (isEdge(r) ? 'Maximum au bord de la plage : pas de pic net' : ''),
  ]);
}
function renderCompareTab(P, ind) {
  safe('#ch-groups', () => drawGroups(P, ind));
  safe('#ch-groupcurves', () => drawGroupCurves(P, ind));
  safe('#ch-anc-age', () => drawAnciennete(P));
}
function renderPlayersTab(P, ind) {
  setupPlayerSearch(P);
  safe('#ch-hist', () => drawHist(P, ind));
  safe('#ch-minlen', () => drawMinlen(P));
  safe('#ch-player', () => drawPlayer(P, ind));
}
function renderMethodTab(P, ind) {
  safe('#ch-naive', () => drawNaive(P, ind));
  safe('#ch-rob', () => drawRobust(P, ind));
  safe('#ch-minutes', () => drawMinutes(P));
  fillGlossary();
}

function showFailure() {
  const msg = 'Échec du chargement des données de cette page.';
  sentence($('#lead'), [msg]);
  $$('.nb-panel:not([hidden]) .nb-chart, .nb-panel:not([hidden]) .nb-mosaic').forEach((h) => showMsg(h, msg));
}

function render() {
  tipHide();
  updateTabFade();
  const st = load();
  if (st.failed) { showFailure(); return; }
  if (!st.ok) return;
  populateControls();
  fillReperes();
  const P = sanitize(getP());
  syncControls(P);
  const ind = get('indicateurs', P.metric);
  fillMarks($('#sample'), P);
  buildLead(P, ind);
  fillMarks($('#' + activeTab), P);
  if (activeTab === 'courbe') renderCurveTab(P, ind);
  else if (activeTab === 'indicateurs') renderMetricsTab(P);
  else if (activeTab === 'comparaisons') renderCompareTab(P, ind);
  else if (activeTab === 'joueurs') renderPlayersTab(P, ind);
  else renderMethodTab(P, ind);
}

/* ---------- démarrage ---------- */
(function init() {
  let h = '';
  try { h = (location.hash || '').replace(/^#/, ''); } catch (e) { h = ''; }
  showTab(TABS.indexOf(h) >= 0 ? h : 'courbe');
  bindControls();
  dash.onData(render);
  // les mesures de texte dépendent de la police : on redessine une fois qu’elle est chargée
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureCache.clear(); render(); }); } catch (e) { /* sans effet */ }
})();
})();
