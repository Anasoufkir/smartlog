/**
 * LogScope - Rendering logic
 *
 * Builds the HTML for stats cards, log rows, filter selects, and tab counts.
 */

window.LogScope = window.LogScope || {};

/**
 * Render the top stats row (totals + per-level counts).
 */
LogScope.renderStats = function () {
  const state = LogScope.state;
  const grid = document.getElementById('statsGrid');
  const total = state.entries.length;
  const first = state.entries[0] ? state.entries[0].timestamp : null;
  const last = state.entries[state.entries.length - 1]
    ? state.entries[state.entries.length - 1].timestamp
    : null;
  const dur = first && last ? LogScope.formatDuration(last - first) : '—';
  const pidCount = Object.keys(state.workers).length;
  const c = state.levelCounts;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="label">Total entrées</div>
      <div class="value">${total.toLocaleString('fr')}</div>
      <div class="sub">Plage : ${dur}</div>
    </div>
    <div class="stat-card">
      <div class="label">PIDs uniques</div>
      <div class="value">${pidCount}</div>
      <div class="sub">${state.dbs.size} base(s) • ${state.loggers.size} logger(s)</div>
    </div>
    <div class="stat-card crit">
      <div class="label">Critical</div>
      <div class="value">${(c.CRITICAL || 0).toLocaleString('fr')}</div>
    </div>
    <div class="stat-card err">
      <div class="label">Error</div>
      <div class="value">${(c.ERROR || 0).toLocaleString('fr')}</div>
    </div>
    <div class="stat-card warn">
      <div class="label">Warning</div>
      <div class="value">${(c.WARNING || 0).toLocaleString('fr')}</div>
    </div>
    <div class="stat-card info">
      <div class="label">Info</div>
      <div class="value">${(c.INFO || 0).toLocaleString('fr')}</div>
    </div>
    <div class="stat-card dbg">
      <div class="label">Debug</div>
      <div class="value">${(c.DEBUG || 0).toLocaleString('fr')}</div>
    </div>
  `;
};

/**
 * Build the level checkboxes (used in the left filter panel).
 */
LogScope.renderLevelFilters = function () {
  const container = document.getElementById('levelCheckboxes');
  container.innerHTML = LogScope.LEVELS.map((l) => `
    <label class="check">
      <input type="checkbox" value="${l}" checked data-level="${l}" />
      <span class="level-badge level-${l}">${l}</span>
      <span class="level-count">${(LogScope.state.levelCounts[l] || 0).toLocaleString('fr')}</span>
    </label>
  `).join('');

  container.querySelectorAll('input[data-level]').forEach((cb) => {
    cb.addEventListener('change', function () {
      LogScope.toggleLevel(this.dataset.level, this.checked);
    });
  });
};

/**
 * Populate the DB and Logger dropdowns from the parsed data.
 */
LogScope.populateSelects = function () {
  const dbSelect = document.getElementById('dbSelect');
  const dbs = [...LogScope.state.dbs].sort();
  dbSelect.innerHTML = '<option value="">— Toutes —</option>' +
    dbs.map((d) => `<option value="${LogScope.escapeHtml(d)}">${LogScope.escapeHtml(d)}</option>`).join('');

  const loggerSelect = document.getElementById('loggerSelect');
  const loggers = [...LogScope.state.loggers].sort();
  loggerSelect.innerHTML = '<option value="">— Tous —</option>' +
    loggers.map((l) => `<option value="${LogScope.escapeHtml(l)}">${LogScope.escapeHtml(l)}</option>`).join('');

  const sourceSelect = document.getElementById('sourceSelect');
  const sources = LogScope.state.sources.map((s) => s.name).sort();
  sourceSelect.innerHTML = '<option value="">— Toutes —</option>' +
    sources.map((name) => `<option value="${LogScope.escapeHtml(name)}">${LogScope.escapeHtml(name)}</option>`).join('');
};

/**
 * Render the log table for the current page of filtered entries.
 */
LogScope.renderLogRows = function () {
  const state = LogScope.state;
  document.getElementById('totalCount').textContent = state.entries.length.toLocaleString('fr');
  document.getElementById('resultsCount').textContent = state.filtered.length.toLocaleString('fr');

  const container = document.getElementById('logRows');
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize;
  const end = Math.min(start + state.pageSize, total);
  const pageEntries = state.filtered.slice(start, end);

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">Aucun résultat ne correspond aux filtres.</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const q = document.getElementById('searchInput').value;
  container.innerHTML = pageEntries.map((e) => {
    const truncMsg = e.message.length > 400 ? e.message.slice(0, 400) + '…' : e.message;
    return `
      <div class="log-row" data-idx="${e.idx}">
        <div class="ts">${e.ts}</div>
        <div class="pid" data-pid="${e.pid}">${e.pid}</div>
        <div><span class="level-badge level-${e.level}">${e.level}</span></div>
        <div class="logger" title="${LogScope.escapeHtml(e.logger)}">${LogScope.escapeHtml(e.logger)}</div>
        <div class="msg">${LogScope.highlight(truncMsg, q)}</div>
        <div class="source">${e.source || '—'}</div>
      </div>
    `;
  }).join('');

  // Attach handlers (keeps markup clean and avoids inline onclick attrs)
  container.querySelectorAll('.log-row').forEach((row) => {
    row.addEventListener('click', function (ev) {
      if (ev.target.classList.contains('pid')) return;
      LogScope.showEntryDetail(parseInt(this.dataset.idx, 10));
    });
  });
  container.querySelectorAll('.pid').forEach((el) => {
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      LogScope.filterByPid(this.dataset.pid);
    });
  });

  LogScope.renderPagination(start, end, total, totalPages);
};

/**
 * Render the pagination bar.
 */
LogScope.renderPagination = function (start, end, total, totalPages) {
  const state = LogScope.state;
  const pag = document.getElementById('pagination');
  pag.innerHTML = `
    <div>Affichage ${start + 1}–${end} sur ${total.toLocaleString('fr')}</div>
    <div class="controls">
      <button class="pg-btn" data-page="1" ${state.page === 1 ? 'disabled' : ''}>« Début</button>
      <button class="pg-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>← Préc.</button>
      <span style="padding:0 8px;">Page ${state.page} / ${totalPages}</span>
      <button class="pg-btn" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''}>Suiv. →</button>
      <button class="pg-btn" data-page="${totalPages}" ${state.page === totalPages ? 'disabled' : ''}>Fin »</button>
    </div>
  `;
  pag.querySelectorAll('.pg-btn').forEach((btn) => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      LogScope.gotoPage(parseInt(this.dataset.page, 10));
    });
  });
};

/**
 * Navigate to a specific page of results.
 * @param {number} p
 */
LogScope.gotoPage = function (p) {
  LogScope.state.page = p;
  LogScope.renderLogRows();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/**
 * Update the numeric badges on each tab.
 */
LogScope.updateTabCounts = function () {
  const state = LogScope.state;
  document.getElementById('tabLogsCount').textContent = state.filtered.length.toLocaleString('fr');
  const workersInFiltered = new Set(state.filtered.map((e) => e.pid));
  document.getElementById('tabWorkersCount').textContent = workersInFiltered.size;
  document.getElementById('tabPidsCount').textContent = Object.keys(state.workers).length;
};
