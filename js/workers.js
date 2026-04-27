/**
 * LogScope - Worker / PID rendering
 *
 * Builds the worker cards shown in the "Workers" and "PIDs" tabs.
 * The Workers tab reflects the *current filtered view* (durations shrink as
 * filters narrow the data), while the PIDs tab always reflects the complete file.
 */

window.LogScope = window.LogScope || {};

/**
 * Build a small HTML snippet of level bars for a worker.
 * @param {Object} levels
 * @returns {string}
 */
function buildLevelBars(levels) {
  const parts = [];
  if (levels.CRITICAL) parts.push(`<div class="wbar c" style="flex:${levels.CRITICAL}" title="CRITICAL: ${levels.CRITICAL}"></div>`);
  if (levels.ERROR) parts.push(`<div class="wbar e" style="flex:${levels.ERROR}" title="ERROR: ${levels.ERROR}"></div>`);
  if (levels.WARNING) parts.push(`<div class="wbar w" style="flex:${levels.WARNING}" title="WARNING: ${levels.WARNING}"></div>`);
  if (levels.INFO) parts.push(`<div class="wbar i" style="flex:${levels.INFO}" title="INFO: ${levels.INFO}"></div>`);
  if (levels.DEBUG) parts.push(`<div class="wbar d" style="flex:${levels.DEBUG}" title="DEBUG: ${levels.DEBUG}"></div>`);
  return parts.join('');
}

/**
 * Build one worker card HTML.
 * @param {Object} w
 * @returns {string}
 */
function buildWorkerCard(w) {
  const duration = w.last - w.first;
  const total = Object.values(w.levels).reduce((a, b) => a + b, 0);
  const bars = buildLevelBars(w.levels);
  const dbLine = w.db && w.db !== '?' ? `<br/><span class="label">DB:</span> <span class="val">${LogScope.escapeHtml(w.db)}</span>` : '';

  return `
    <div class="worker-card" data-pid="${w.pid}">
      <div class="wstatus ${w.exited ? 'exited' : 'alive'}">${w.exited ? 'Terminé' : 'Actif'}</div>
      <div class="wpid">PID ${w.pid}</div>
      <div class="wduration">${LogScope.formatDuration(duration)}</div>
      <div class="wmeta">
        <span class="label">Début:</span> <span class="val">${LogScope.formatDate(w.first)}</span><br/>
        <span class="label">Fin:</span> <span class="val">${LogScope.formatDate(w.last)}</span><br/>
        <span class="label">Entrées:</span> <span class="val">${total.toLocaleString('fr')}</span>
        ${dbLine}
      </div>
      <div class="wbars">${bars}</div>
    </div>
  `;
}

/**
 * Attach click-to-filter behavior to worker cards inside a container.
 * @param {HTMLElement} container
 */
function attachWorkerCardHandlers(container) {
  container.querySelectorAll('.worker-card').forEach((card) => {
    card.addEventListener('click', function () {
      LogScope.filterByPid(this.dataset.pid);
    });
  });
}

/**
 * Render the "Workers" tab (filtered view).
 */
LogScope.renderWorkers = function () {
  const grid = document.getElementById('workersGrid');
  // Rebuild workers from filtered entries so durations reflect the active filters.
  const subset = {};
  for (const e of LogScope.state.filtered) {
    if (!subset[e.pid]) {
      subset[e.pid] = {
        pid: e.pid,
        first: e.timestamp,
        last: e.timestamp,
        levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
        db: e.db,
        started: (LogScope.state.workers[e.pid] && LogScope.state.workers[e.pid].started) || false,
        exited: (LogScope.state.workers[e.pid] && LogScope.state.workers[e.pid].exited) || false
      };
    }
    subset[e.pid].last = e.timestamp;
    subset[e.pid].levels[e.level]++;
  }

  const list = Object.values(subset).sort((a, b) => (b.last - b.first) - (a.last - a.first));

  if (list.length === 0) {
    grid.innerHTML = '<div class="empty-state">Aucun worker dans les résultats filtrés.</div>';
    return;
  }
  grid.innerHTML = list.map(buildWorkerCard).join('');
  attachWorkerCardHandlers(grid);
};

/**
 * Render the "PIDs" tab (complete view, unaffected by filters).
 */
LogScope.renderPidsGrid = function () {
  const grid = document.getElementById('pidsGrid');
  const list = Object.values(LogScope.state.workers).sort((a, b) => b.lastIdx - a.lastIdx);

  if (list.length === 0) {
    grid.innerHTML = '<div class="empty-state">Aucun PID.</div>';
    return;
  }
  grid.innerHTML = list.map(buildWorkerCard).join('');
  attachWorkerCardHandlers(grid);
};
