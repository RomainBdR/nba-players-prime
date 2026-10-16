/* Section d’accueil : remplit les chiffres de la présentation, dessine la courbe d’âge annotée (BPM, tous postes,
   toutes époques, 500 minutes ou plus) à partir des CSV de data/, et relie les boutons aux onglets du tableau de bord.
   Aucun chiffre n’est écrit à la main : chaque valeur affichée cite sa ligne de données (data-source, data-field, data-where). */
(function () {
  'use strict';

  var KEY = { metric: 'bpm', pos: 'all', era: 'all', thr: '500' };
  var TOL = 20; // tolérance de la prime, en centièmes d’écart-type
  var NEEDED = ['courbes', 'pics', 'fenetres', 'methode'];

  var host = document.getElementById('intro-plot');
  var root = document.getElementById('accueil');
  if (!root) return;

  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* sans effet */ }

  /* ---------- mise en forme ---------- */
  var nfCache = {};
  function nf(d) { return nfCache[d] || (nfCache[d] = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })); }
  function fr(v, d, plus) {
    var s = nf(d).format(v);
    if (s.charAt(0) === '-') s = '−' + s.slice(1);
    return plus && v > 0 ? '+' + s : s;
  }

  /* ---------- accès aux données ---------- */
  function same(a, b) {
    if (String(a) === String(b)) return true;
    var x = parseFloat(a), y = parseFloat(b);
    return isFinite(x) && isFinite(y) && x === y;
  }
  function rowsOf(id) {
    var d = window.dash && window.dash.data(id);
    return d && d.status === 'ok' ? d.data : null;
  }
  function findRow(id, w) {
    var r = rowsOf(id);
    if (!r) return null;
    for (var i = 0; i < r.length; i++) {
      var ok = true;
      for (var k in w) { if (!same(r[i][k], w[k])) { ok = false; break; } }
      if (ok) return r[i];
    }
    return null;
  }
  function parseWhere(s) {
    var w = {};
    s.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) w[kv.slice(0, i)] = kv.slice(i + 1); });
    return w;
  }
  function methodVal(k) { var r = findRow('methode', { cle: k }); return r ? parseFloat(r.valeur) : NaN; }

  /* ---------- chiffres du texte ---------- */
  function fillNumbers() {
    var nodes = root.querySelectorAll('[data-i]');
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      var parts = e.getAttribute('data-i').split('|');
      var src = parts[0], field = parts[1], w = parseWhere(parts[2]), dec = parts[3];
      var row = findRow(src, w);
      var v = row ? parseFloat(row[field]) : NaN;
      var txt = '—';
      if (isFinite(v)) txt = dec === 'y' ? String(Math.round(v)) : fr(v, Number(dec || 0));
      e.textContent = txt;
      e.classList.remove('dash-skeleton');
      if (isFinite(v)) {
        e.setAttribute('data-source', src);
        e.setAttribute('data-field', field);
        e.setAttribute('data-where', parts[2]);
      }
    }
    var tol = root.querySelectorAll('[data-tol]');
    for (var j = 0; j < tol.length; j++) { tol[j].textContent = fr(TOL / 100, 1); tol[j].classList.remove('dash-skeleton'); }
  }

  /* ---------- modèle de la courbe ---------- */
  function buildModel() {
    var cur = (rowsOf('courbes') || []).filter(function (r) {
      return r.metric === KEY.metric && r.pos === KEY.pos && r.era === KEY.era && same(r.thr, KEY.thr);
    }).map(function (r) {
      return { age: parseFloat(r.age), g: parseFloat(r.g), lo: parseFloat(r.g_lo), hi: parseFloat(r.g_hi), n: parseFloat(r.n_pairs) };
    }).filter(function (p) { return isFinite(p.n) && p.n > 0 && isFinite(p.g) && isFinite(p.lo) && isFinite(p.hi); })
      .sort(function (a, b) { return a.age - b.age; });
    var pk = findRow('pics', KEY);
    var win = findRow('fenetres', { metric: KEY.metric, pos: KEY.pos, era: KEY.era, thr: KEY.thr, tol: TOL });
    if (cur.length < 6 || !pk || !win) return null;
    var peak = parseFloat(pk.peak), plo = parseFloat(pk.peak_lo), phi = parseFloat(pk.peak_hi);
    var lo = parseFloat(win.lo), hi = parseFloat(win.hi);
    if (![peak, plo, phi, lo, hi].every(isFinite)) return null;
    return { cur: cur, peak: peak, plo: plo, phi: phi, lo: lo, hi: hi, refs: [methodVal('ref_age_1'), methodVal('ref_age_2')].filter(isFinite) };
  }

  /* ---------- dessin ---------- */
  var tipEl = null;
  function draw(m, animate) {
    var d3 = window.d3;
    host.textContent = '';
    host.classList.remove('dash-skeleton');
    var w = Math.max(280, Math.floor(host.clientWidth));
    var compact = w < 520;
    var h = compact ? Math.round(Math.max(250, w * 0.78)) : Math.round(Math.min(380, w * 0.62));
    var mg = { t: 34, r: 14, b: 34, l: 34 };
    var iw = w - mg.l - mg.r, ih = h - mg.t - mg.b;

    var x = d3.scaleLinear().domain([m.cur[0].age, m.cur[m.cur.length - 1].age]).range([0, iw]);
    var yMin = d3.min(m.cur, function (p) { return p.lo; }) - 0.35;
    var y = d3.scaleLinear().domain([yMin, 0.5]).range([ih, 0]);
    var cx = function (v) { return Math.max(0, Math.min(iw, x(v))); };

    var svg = d3.select(host).append('svg').attr('width', w).attr('height', h).attr('viewBox', '0 0 ' + w + ' ' + h).attr('aria-hidden', 'true');
    svg.append('text').attr('class', 'ip-t ip-t-cap').attr('x', 2).attr('y', 11).text('Écart au pic, en points pour 100 possessions');
    var g = svg.append('g').attr('transform', 'translate(' + mg.l + ',' + mg.t + ')');

    // repères de lecture : niveau du pic (0) et paliers
    [-2, -4].forEach(function (t) {
      if (t > yMin) g.append('line').attr('class', 'ip-grid').attr('x1', 0).attr('x2', iw).attr('y1', y(t)).attr('y2', y(t));
    });
    [0, -2, -4].forEach(function (t) {
      if (t > yMin) g.append('text').attr('class', 'ip-t').attr('x', -8).attr('y', y(t) + 4).attr('text-anchor', 'end').text(t === 0 ? '0' : fr(t, 0));
    });
    g.append('line').attr('class', 'ip-zero').attr('x1', 0).attr('x2', iw).attr('y1', y(0)).attr('y2', y(0));
    g.append('line').attr('class', 'ip-axis').attr('x1', 0).attr('x2', iw).attr('y1', ih).attr('y2', ih);
    [20, 25, 30, 35].forEach(function (t) {
      if (t < m.cur[0].age || t > m.cur[m.cur.length - 1].age) return;
      g.append('line').attr('class', 'ip-axis').attr('x1', x(t)).attr('x2', x(t)).attr('y1', ih).attr('y2', ih + 4);
      g.append('text').attr('class', 'ip-t').attr('x', x(t)).attr('y', ih + 19).attr('text-anchor', 'middle').text(t === 20 ? '20 ans' : String(t));
    });

    // fenêtre de prime
    var win = g.append('g').attr('class', 'ip-fade');
    win.append('rect').attr('class', 'ip-win').attr('x', cx(m.lo)).attr('width', Math.max(0, cx(m.hi) - cx(m.lo))).attr('y', 0).attr('height', ih);
    var wmid = (cx(m.lo) + cx(m.hi)) / 2;
    win.append('text').attr('class', 'ip-t ip-t-phase ip-t-ink').attr('x', wmid).attr('y', ih - 26).attr('text-anchor', 'middle').text('prime');
    win.append('text').attr('class', 'ip-t').attr('x', wmid).attr('y', ih - 9).attr('text-anchor', 'middle').text(fr(m.lo, 1) + ' à ' + fr(m.hi, 1) + ' ans');

    // phases
    var ph = g.append('g').attr('class', 'ip-fade');
    var phSize = compact ? '13px' : null;
    ph.append('text').attr('class', 'ip-t ip-t-phase').style('font-size', phSize).attr('x', 2).attr('y', y(-0.55)).text('progression');
    ph.append('text').attr('class', 'ip-t ip-t-phase').style('font-size', phSize).attr('x', iw - 2).attr('y', y(-0.55)).attr('text-anchor', 'end').text('déclin');

    // intervalle de confiance puis courbe
    var area = d3.area().x(function (p) { return x(p.age); }).y0(function (p) { return y(p.lo); }).y1(function (p) { return y(p.hi); }).curve(d3.curveMonotoneX);
    var line = d3.line().x(function (p) { return x(p.age); }).y(function (p) { return y(p.g); }).curve(d3.curveMonotoneX);
    g.append('path').attr('class', 'ip-ci ip-fade').attr('d', area(m.cur));
    var path = g.append('path').attr('class', 'ip-line').attr('d', line(m.cur));

    // écarts aux âges de repère
    var refs = g.append('g').attr('class', 'ip-fade');
    m.refs.forEach(function (age) {
      var p = m.cur.filter(function (q) { return q.age === age; })[0];
      if (!p) return;
      refs.append('circle').attr('class', 'ip-ref').attr('cx', x(p.age)).attr('cy', y(p.g)).attr('r', 4);
      refs.append('text').attr('class', 'ip-t ip-t-ink').attr('x', x(p.age) - 9).attr('y', y(p.g) + 18).attr('text-anchor', 'end')
        .text(fr(p.g, 1, true) + ' à ' + age + ' ans');
    });

    // pic et son intervalle
    var pk = g.append('g').attr('class', 'ip-fade');
    pk.append('line').attr('class', 'ip-peak-ci').attr('x1', x(m.plo)).attr('x2', x(m.phi)).attr('y1', y(0)).attr('y2', y(0));
    pk.append('circle').attr('class', 'ip-peak').attr('cx', x(m.peak)).attr('cy', y(0)).attr('r', 5.5);
    pk.append('text').attr('class', 'ip-t ip-t-strong').attr('x', x(m.peak)).attr('y', y(0) - 14).attr('text-anchor', 'middle').text('pic vers ' + fr(m.peak, 1) + ' ans');

    // survol et toucher
    var hov = g.append('g').attr('pointer-events', 'none').style('display', 'none');
    hov.append('line').attr('class', 'ip-hov-line').attr('y1', 0).attr('y2', ih);
    hov.append('circle').attr('class', 'ip-hov-dot').attr('r', 4.5);
    tipEl = document.createElement('div');
    tipEl.className = 'ip-tip';
    tipEl.hidden = true;
    host.appendChild(tipEl);
    var bis = d3.bisector(function (p) { return p.age; }).center;
    function show(ev) {
      var r = svg.node().getBoundingClientRect();
      var px = (ev.clientX - r.left) * (w / r.width) - mg.l;
      var p = m.cur[bis(m.cur, x.invert(Math.max(0, Math.min(iw, px))))];
      if (!p) return;
      hov.style('display', null);
      hov.select('line').attr('x1', x(p.age)).attr('x2', x(p.age));
      hov.select('circle').attr('cx', x(p.age)).attr('cy', y(p.g));
      var gap = Math.abs(p.g) < 0.005 ? 'niveau du pic' : fr(p.g, Math.abs(p.g) < 1 ? 2 : 1, true) + ' point' + (Math.abs(p.g) >= 2 ? 's' : '') + ' par rapport au pic';
      tipEl.textContent = '';
      var b = document.createElement('b'); b.textContent = 'À ' + p.age + ' ans'; tipEl.appendChild(b);
      var s1 = document.createElement('span'); s1.textContent = gap; tipEl.appendChild(s1);
      var s2 = document.createElement('span'); s2.textContent = fr(p.n, 0) + ' paires de saisons'; tipEl.appendChild(s2);
      tipEl.hidden = false;
      var tx = mg.l + x(p.age) + 14, tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      if (tx + tw > w) tx = mg.l + x(p.age) - tw - 14;
      var ty = Math.max(4, mg.t + y(p.g) - th - 12);
      tipEl.style.left = Math.max(0, tx) + 'px';
      tipEl.style.top = ty + 'px';
    }
    function hide() { hov.style('display', 'none'); tipEl.hidden = true; }
    g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', show).on('pointerdown', show).on('pointerleave', hide).on('pointercancel', hide);

    // texte alternatif de la courbe
    var p30 = m.cur.filter(function (q) { return q.age === m.refs[0]; })[0];
    var p34 = m.cur.filter(function (q) { return q.age === m.refs[1]; })[0];
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', 'Courbe d’âge moyenne du BPM : maximum vers ' + fr(m.peak, 1) + ' ans, niveau proche du maximum entre ' + fr(m.lo, 1) + ' et ' + fr(m.hi, 1) + ' ans'
      + (p30 && p34 ? ', puis ' + fr(p30.g, 1) + (Math.abs(p30.g) >= 2 ? ' points' : ' point') + ' à ' + p30.age + ' ans et ' + fr(p34.g, 1) + (Math.abs(p34.g) >= 2 ? ' points' : ' point') + ' à ' + p34.age + ' ans par rapport au pic.' : '.'));

    // entrée en scène unique : la courbe se trace, le reste apparaît ensuite
    if (animate && !reduce && path.node().animate) {
      var L = path.node().getTotalLength();
      path.attr('stroke-dasharray', L + ' ' + L);
      path.node().animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 1300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' })
        .onfinish = function () { path.attr('stroke-dasharray', null); };
      svg.selectAll('.ip-fade').each(function () {
        this.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 800, easing: 'ease-out', fill: 'backwards' });
      });
    }
  }

  /* ---------- démarrage ---------- */
  var model = null, lastW = 0, drawn = false, timer = null;

  function ready() {
    var st = 'ok';
    NEEDED.forEach(function (id) {
      var d = window.dash.data(id);
      if (d.status === 'error') st = 'error';
      else if (d.status !== 'ok' && st !== 'error') st = 'wait';
    });
    return st;
  }
  function update() {
    if (drawn) return;
    var st = ready();
    if (st === 'wait') return;
    if (st === 'error') { var fig = root.querySelector('.intro-fig'); if (fig) fig.hidden = true; return; }
    fillNumbers();
    model = buildModel();
    if (!model) { var f2 = root.querySelector('.intro-fig'); if (f2) f2.hidden = true; drawn = true; return; }
    draw(model, true);
    lastW = host.clientWidth;
    drawn = true;
  }
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!drawn || !model) return;
      var w = host.clientWidth;
      if (Math.abs(w - lastW) > 2) { lastW = w; draw(model, false); }
    }, 120);
  }
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(host);
  else window.addEventListener('resize', onResize);

  /* ---------- boutons : ouvrent l’onglet voulu du tableau de bord ---------- */
  function go(tab, dim) {
    if (dim && window.dash) window.dash.setParams({ dim: dim });
    var b = document.getElementById('tabbtn-' + tab);
    if (b) b.click();
    var head = document.querySelector('.nb-head');
    if (head && head.scrollIntoView) head.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    if (b && b.focus) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  var btns = root.querySelectorAll('[data-go]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function (ev) {
      var t = ev.currentTarget;
      go(t.getAttribute('data-go'), t.getAttribute('data-dim'));
    });
  }

  if (window.dash && window.dash.onData) window.dash.onData(update);
})();
