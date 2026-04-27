/**
 * LogScope - Filter logic
 *
 * Applies all currently selected filters to the parsed entries and
 * triggers a re-render of the UI.
 */

window.LogScope = window.LogScope || {};

/**
 * Read the current filter controls from the DOM and rebuild `state.filtered`.
 */
// Build a search matcher: supports /regex/flags or plain text
function buildSearchMatcher(raw) {
  if (!raw) return null;
  const m = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2] || 'i');
      return (e) => re.test(e.message) || re.test(e.logger);
    } catch { /* bad regex — fall through to plain text */ }
  }
  const lower = raw.toLowerCase();
  return (e) => e.message.toLowerCase().includes(lower) || e.logger.toLowerCase().includes(lower);
}

LogScope.applyFilters = function () {
  const state = LogScope.state;
  const searchRaw = document.getElementById('searchInput').value;
  const dateStart = document.getElementById('dateStart').value;
  const dateEnd = document.getElementById('dateEnd').value;
  const pid = document.getElementById('pidInput').value.trim();
  const source = document.getElementById('sourceSelect') ? document.getElementById('sourceSelect').value : '';
  const db = document.getElementById('dbSelect').value;
  const logger = document.getElementById('loggerSelect').value;

  const startMs = dateStart ? new Date(dateStart).getTime() : null;
  const endMs = dateEnd ? new Date(dateEnd).getTime() : null;
  const searchMatcher = buildSearchMatcher(searchRaw);

  state.filtered = state.entries.filter((e) => {
    if (!state.activeLevels.has(e.level)) return false;
    if (startMs !== null && e.timestamp.getTime() < startMs) return false;
    if (endMs !== null && e.timestamp.getTime() > endMs) return false;
    if (pid && !e.pid.includes(pid)) return false;
    if (source && e.source !== source) return false;
    if (db && e.db !== db) return false;
    if (logger && e.logger !== logger) return false;
    if (searchMatcher && !searchMatcher(e)) return false;
    return true;
  });

  state.page = 1;
  LogScope.renderLogRows();
  LogScope.renderWorkers();
  LogScope.renderPidsGrid();
  LogScope.drawTimeline();
  LogScope.drawGantt();
  LogScope.updateTabCounts();
};

/**
 * Toggle a log level on or off in the filter and re-apply.
 * @param {string} level
 * @param {boolean} checked
 */
LogScope.toggleLevel = function (level, checked) {
  if (checked) LogScope.state.activeLevels.add(level);
  else LogScope.state.activeLevels.delete(level);
  LogScope.applyFilters();
};

/**
 * Reset all filters to their initial values.
 */
LogScope.resetFilters = function () {
  document.getElementById('searchInput').value = '';
  document.getElementById('pidInput').value = '';
  if (document.getElementById('sourceSelect')) document.getElementById('sourceSelect').value = '';
  document.getElementById('dbSelect').value = '';
  document.getElementById('loggerSelect').value = '';
  LogScope.setDefaultDateRange();
  LogScope.state.activeLevels = new Set(LogScope.LEVELS);
  document.querySelectorAll('#levelCheckboxes input').forEach((cb) => {
    cb.checked = true;
  });
  LogScope.applyFilters();
};

/**
 * Quickly set the PID filter and re-apply. Called from clickable PID cells.
 * @param {string} pid
 */
LogScope.filterByPid = function (pid) {
  document.getElementById('pidInput').value = pid;
  LogScope.applyFilters();
};

/**
 * Populate the start/end date inputs using the file's first and last entries.
 */
LogScope.setDefaultDateRange = function () {
  const state = LogScope.state;
  const first = state.entries[0] ? state.entries[0].timestamp : null;
  const last = state.entries[state.entries.length - 1]
    ? state.entries[state.entries.length - 1].timestamp
    : null;
  if (first) document.getElementById('dateStart').value = LogScope.toLocalDatetimeString(first);
  if (last) document.getElementById('dateEnd').value = LogScope.toLocalDatetimeString(last);
};
