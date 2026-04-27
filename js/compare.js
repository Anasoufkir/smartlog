/**
 * LogScope - Vue comparative (split view)
 */
window.LogScope = window.LogScope || {};

var CMP_SERVICE  = 'http://localhost:3000/read-log';
var CMP_PAGE_SIZE = 50;

function makeSide() {
  return {
    entries: [], filtered: [],
    activeLevels: new Set(LogScope.LEVELS),
    levelCounts: { CRITICAL:0, ERROR:0, WARNING:0, INFO:0, DEBUG:0 },
    page: 1, tzOffset: 0, fileName: ''
  };
}

LogScope.cmpState = { left: makeSide(), right: makeSide() };

/* ── helpers ─────────────────────────────────────────── */
function cmpEl(side, field) {
  return document.getElementById('cmp-' + field + '-' + side);
}

function cmpVal(side, field) {
  var el = cmpEl(side, field);
  return el ? el.value : '';
}

function fmtTs(d) {
  var p = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function sharedPayload(path) {
  var host = document.getElementById('cmp-shared-host') ? document.getElementById('cmp-shared-host').value.trim() : '';
  var port = document.getElementById('cmp-shared-port') ? document.getElementById('cmp-shared-port').value.trim() || '22' : '22';
  var user = document.getElementById('cmp-shared-user') ? document.getElementById('cmp-shared-user').value.trim() : '';
  var key  = document.getElementById('cmp-shared-key')  ? document.getElementById('cmp-shared-key').value.trim()  : '';
  var sudo = document.getElementById('cmp-shared-sudo') ? document.getElementById('cmp-shared-sudo').checked : false;
  var payload = { path: path, sudo: sudo };
  if (host) { payload.host = host; payload.port = port; payload.user = user; payload.keyPath = key; }
  return payload;
}

/* ── chargement d'un côté ────────────────────────────── */
LogScope.loadCmpSide = function(side, text, fileName) {
  LogScope.showLoader('Analyse ' + fileName + '...');
  LogScope.parseLogFileAsync(text, null, function(p) {
    LogScope.showLoader('Analyse... ' + p + '%');
  }).then(function(result) {
    if (!result.entries.length) {
      LogScope.hideLoader();
      alert('Aucune ligne de log valide détectée.');
      return;
    }
    var st = LogScope.cmpState[side];
    st.entries     = result.entries;
    st.levelCounts = result.levelCounts;
    st.activeLevels = new Set(LogScope.LEVELS);
    st.fileName    = fileName;
    st.page        = 1;

    // Plage de dates par défaut
    var tzMs  = st.tzOffset * 3600000;
    var first = new Date(result.entries[0].timestamp.getTime() + tzMs);
    var last  = new Date(result.entries[result.entries.length - 1].timestamp.getTime() + tzMs);
    var dsEl  = cmpEl(side, 'date-start');
    var deEl  = cmpEl(side, 'date-end');
    if (dsEl) dsEl.value = LogScope.toLocalDatetimeString(first);
    if (deEl) deEl.value = LogScope.toLocalDatetimeString(last);

    LogScope.hideLoader();
    LogScope.cmpRenderLevels(side);
    LogScope.cmpRenderTitle(side);
    LogScope.cmpApplyFilters(side);
  }).catch(function(err) {
    LogScope.hideLoader();
    alert('Erreur : ' + err.message);
  });
};

/* ── titre ───────────────────────────────────────────── */
LogScope.cmpRenderTitle = function(side) {
  var st = LogScope.cmpState[side];
  var el = cmpEl(side, 'title');
  if (el) el.textContent = st.fileName || (side === 'left' ? 'Panneau gauche' : 'Panneau droit');
  var c = cmpEl(side, 'count');
  if (c) c.textContent = st.entries.length ? st.entries.length.toLocaleString('fr') + ' entrées' : '';
};

/* ── boutons de niveau ───────────────────────────────── */
LogScope.cmpRenderLevels = function(side) {
  var st  = LogScope.cmpState[side];
  var box = cmpEl(side, 'levels');
  if (!box) return;
  box.innerHTML = '';

  LogScope.LEVELS.forEach(function(level) {
    var btn = document.createElement('button');
    btn.className = 'cmp-lvl-btn' + (st.activeLevels.has(level) ? ' active' : '');

    var badge = document.createElement('span');
    badge.className = 'level-badge level-' + level;
    badge.textContent = level;

    var cnt = document.createElement('span');
    cnt.className = 'cmp-lc';
    cnt.textContent = (st.levelCounts[level] || 0).toLocaleString('fr');

    btn.appendChild(badge);
    btn.appendChild(cnt);

    // Closure sur `level` et `side` — pas de dataset
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      if (st.activeLevels.has(level)) {
        st.activeLevels.delete(level);
        btn.classList.remove('active');
      } else {
        st.activeLevels.add(level);
        btn.classList.add('active');
      }
      LogScope.cmpApplyFilters(side);
    });

    box.appendChild(btn);
  });
};

/* ── filtre ──────────────────────────────────────────── */
LogScope.cmpApplyFilters = function(side) {
  var st   = LogScope.cmpState[side];
  var tzMs = st.tzOffset * 3600000;

  var q  = cmpVal(side, 'search').toLowerCase();

  var dsEl = cmpEl(side, 'date-start');
  var deEl = cmpEl(side, 'date-end');
  var t0   = (dsEl && dsEl.value) ? new Date(dsEl.value).getTime() : null;
  var t1   = (deEl && deEl.value) ? new Date(deEl.value).getTime() : null;

  st.filtered = st.entries.filter(function(e) {
    if (!st.activeLevels.has(e.level)) return false;

    if (t0 !== null || t1 !== null) {
      var ts = e.timestamp.getTime() + tzMs;
      if (t0 !== null && ts < t0) return false;
      if (t1 !== null && ts > t1) return false;
    }

    if (q) {
      var inMsg    = e.message.toLowerCase().indexOf(q) !== -1;
      var inLogger = (e.logger || '').toLowerCase().indexOf(q) !== -1;
      if (!inMsg && !inLogger) return false;
    }

    return true;
  });

  st.page = 1;
  LogScope.cmpRenderRows(side);
};

/* ── rendu des lignes ────────────────────────────────── */
LogScope.cmpRenderRows = function(side) {
  var st   = LogScope.cmpState[side];
  var rows = cmpEl(side, 'rows');
  var pag  = cmpEl(side, 'pag');
  var res  = cmpEl(side, 'result');
  if (!rows) return;

  var total = st.filtered.length;
  var pages = Math.max(1, Math.ceil(total / CMP_PAGE_SIZE));
  if (st.page > pages) st.page = pages;
  var s = (st.page - 1) * CMP_PAGE_SIZE;
  var e = Math.min(s + CMP_PAGE_SIZE, total);
  var tzMs = st.tzOffset * 3600000;
  var q    = cmpVal(side, 'search');

  if (res) res.textContent = total.toLocaleString('fr') + ' résultat(s)';

  if (!total) {
    rows.innerHTML = '<div class="cmp-empty">' +
      (st.entries.length ? 'Aucun résultat pour les filtres sélectionnés.' : 'Chargez un fichier pour commencer.') +
      '</div>';
    if (pag) pag.innerHTML = '';
    return;
  }

  var html = '';
  var page = st.filtered.slice(s, e);
  for (var i = 0; i < page.length; i++) {
    var en = page[i];
    var ts = fmtTs(tzMs ? new Date(en.timestamp.getTime() + tzMs) : en.timestamp);
    var msg = en.message.length > 160 ? en.message.slice(0, 160) + '…' : en.message;
    html += '<div class="cmp-row cmp-row-' + en.level + '" data-idx="' + en.idx + '" data-side="' + side + '">' +
      '<span class="cmp-ts">' + ts + '</span>' +
      '<span class="level-badge level-' + en.level + '">' + en.level + '</span>' +
      '<span class="cmp-pid">' + en.pid + '</span>' +
      '<span class="cmp-msg">' + LogScope.highlight(msg, q) + '</span>' +
      '</div>';
  }
  rows.innerHTML = html;

  rows.querySelectorAll('.cmp-row').forEach(function(r) {
    r.addEventListener('click', function() {
      var idx   = parseInt(this.getAttribute('data-idx'), 10);
      var rside = this.getAttribute('data-side');
      var entry = LogScope.cmpState[rside].entries[idx];
      if (!entry) return;
      document.getElementById('modalTitle').innerHTML =
        '<span class="level-badge level-' + entry.level + '">' + entry.level + '</span> PID ' +
        LogScope.escapeHtml(String(entry.pid));
      document.getElementById('modalMeta').textContent =
        entry.ts + ' • ' + (entry.logger || '') +
        (entry.db && entry.db !== '?' ? ' • DB: ' + entry.db : '');
      document.getElementById('modalContent').textContent = entry.raw;
      document.getElementById('modalOverlay').classList.add('active');
    });
  });

  // Pagination
  if (pag) {
    pag.innerHTML =
      '<button class="pg-btn" data-side="' + side + '" data-page="' + (st.page - 1) + '"' +
      (st.page === 1 ? ' disabled' : '') + '>← Préc.</button>' +
      '<span>Page ' + st.page + '/' + pages + ' — ' + (s+1) + '–' + e + '/' + total.toLocaleString('fr') + '</span>' +
      '<button class="pg-btn" data-side="' + side + '" data-page="' + (st.page + 1) + '"' +
      (st.page === pages ? ' disabled' : '') + '>Suiv. →</button>';

    pag.querySelectorAll('.pg-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        if (this.disabled) return;
        var ps = this.getAttribute('data-side');
        var pp = parseInt(this.getAttribute('data-page'), 10);
        LogScope.cmpState[ps].page = pp;
        LogScope.cmpRenderRows(ps);
      });
    });
  }
};

/* ── initialisation ──────────────────────────────────── */
LogScope.initCompare = function() {
  ['left', 'right'].forEach(function(side) {

    // Fichier local (picker)
    var browseBtn = cmpEl(side, 'browse');
    var fileInput = cmpEl(side, 'file');
    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function(ev) {
        if (!ev.target.files.length) return;
        var file = ev.target.files[0];
        var reader = new FileReader();
        reader.onload = function(e2) {
          LogScope.loadCmpSide(side, e2.target.result, file.name);
        };
        reader.readAsText(file);
        ev.target.value = '';
      });
    }

    // Chargement SSH
    var loadBtn = cmpEl(side, 'load');
    if (loadBtn) {
      loadBtn.addEventListener('click', function() {
        var path = cmpEl(side, 'path') ? cmpEl(side, 'path').value.trim() : '';
        if (!path) { alert('Veuillez saisir un chemin de fichier.'); return; }
        LogScope.showLoader('Lecture du fichier...');
        fetch(CMP_SERVICE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sharedPayload(path))
        }).then(function(resp) {
          if (!resp.ok) throw new Error('Erreur ' + resp.status + ' ' + resp.statusText);
          return resp.text();
        }).then(function(text) {
          LogScope.hideLoader();
          LogScope.loadCmpSide(side, text, path);
        }).catch(function(err) {
          LogScope.hideLoader();
          alert(err.message);
        });
      });
    }

    // Fuseau horaire
    var tzEl = cmpEl(side, 'tz');
    if (tzEl) {
      tzEl.addEventListener('change', function() {
        var st = LogScope.cmpState[side];
        st.tzOffset = parseFloat(tzEl.value) || 0;
        if (st.entries.length) {
          var tzMs  = st.tzOffset * 3600000;
          var dsEl  = cmpEl(side, 'date-start');
          var deEl  = cmpEl(side, 'date-end');
          if (dsEl) dsEl.value = LogScope.toLocalDatetimeString(new Date(st.entries[0].timestamp.getTime() + tzMs));
          if (deEl) deEl.value = LogScope.toLocalDatetimeString(new Date(st.entries[st.entries.length - 1].timestamp.getTime() + tzMs));
        }
        LogScope.cmpApplyFilters(side);
      });
    }

    // Recherche — réagit à chaque frappe
    var srchEl = cmpEl(side, 'search');
    if (srchEl) {
      srchEl.addEventListener('input', LogScope.debounce(function() {
        LogScope.cmpApplyFilters(side);
      }, 200));
    }

    // Dates — `input` ET `change` pour compatibilité navigateurs
    ['date-start', 'date-end'].forEach(function(f) {
      var el = cmpEl(side, f);
      if (el) {
        el.addEventListener('change', function() { LogScope.cmpApplyFilters(side); });
        el.addEventListener('input',  function() { LogScope.cmpApplyFilters(side); });
      }
    });

    // État initial
    LogScope.cmpRenderTitle(side);
    LogScope.cmpRenderRows(side);
  });
};
