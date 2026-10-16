/* Couche de données minimale qui remplace l’environnement « dash » du tableau de bord Claude :
   chargement des CSV du dossier data/, paramètres de filtre conservés dans l’adresse (?metric=…&pos=…), ancre = onglet. */
(function () {
  'use strict';
  var DATASETS = ['courbes', 'pics', 'fenetres', 'indicateurs', 'options', 'methode', 'anciennete', 'robustesse', 'ligue_age',
    'joueurs_resume', 'joueurs', 'indiv_resume', 'indiv_hist', 'reperes'];
  var DEFAULTS = { metric: 'bpm', pos: 'all', era: 'all', thr: '500', tol: '20', dim: 'pos', minlen: '7', player: 'jamesle01' };

  var store = {};
  DATASETS.forEach(function (id) { store[id] = { status: 'loading', data: [], columns: [], message: '' }; });
  var listeners = [];
  var pending = false;

  function fire() {
    pending = false;
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { if (window.console) console.error(e); } });
  }
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(fire);
  }

  var params = {};
  function readUrl() {
    var p = {};
    for (var k in DEFAULTS) p[k] = DEFAULTS[k];
    try {
      var q = new URLSearchParams(location.search);
      for (var key in DEFAULTS) { var v = q.get(key); if (v !== null && v !== '') p[key] = v; }
    } catch (e) { /* URL sans paramètres */ }
    return p;
  }
  function writeUrl() {
    try {
      var q = new URLSearchParams();
      for (var k in DEFAULTS) if (String(params[k]) !== String(DEFAULTS[k])) q.set(k, params[k]);
      var s = q.toString();
      history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
    } catch (e) { /* ignoré */ }
  }
  params = readUrl();

  window.dash = {
    colors: ['var(--cds-chart-1)', 'var(--cds-chart-2)', 'var(--cds-chart-3)', 'var(--cds-chart-4)', 'var(--cds-chart-5)', 'var(--cds-chart-6)', 'var(--cds-chart-7)', 'var(--cds-chart-8)'],
    data: function (id) {
      var s = store[id];
      if (!s) return { status: 'missing', data: [], columns: [], rows: [], message: '', refreshing: false, meta: [] };
      return { status: s.status, data: s.data, columns: s.columns, rows: s.data, message: s.message, refreshing: false, meta: [] };
    },
    onData: function (fn) { listeners.push(fn); try { fn(); } catch (e) { if (window.console) console.error(e); } },
    params: function () { var o = {}; for (var k in params) o[k] = params[k]; return o; },
    setParams: function (o) { for (var k in o) params[k] = o[k]; writeUrl(); fire(); },
    resetParams: function () { params = {}; for (var k in DEFAULTS) params[k] = DEFAULTS[k]; writeUrl(); fire(); },
    setLink: function (name) { try { history.replaceState(null, '', location.pathname + location.search + (name ? '#' + name : '')); } catch (e) { /* ignoré */ } },
    calc: function () {}, loader: function () {}, refresh: function () {}
  };

  DATASETS.forEach(function (id) {
    fetch('data/' + id + '.csv')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        var rows = d3.csvParse(text);
        store[id] = { status: 'ok', data: rows, columns: rows.columns, message: '' };
        schedule();
      })
      .catch(function (e) {
        store[id] = { status: 'error', data: [], columns: [], message: String(e && e.message || e) };
        schedule();
      });
  });

  var timer = null;
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(fire, 120); });
})();
