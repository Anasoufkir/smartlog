/**
 * LogScope - Application state
 */

window.LogScope = window.LogScope || {};

LogScope.state = {
  entries: [],       // All parsed log entries
  filtered: [],      // Current filtered view
  workers: {},       // pid -> { first, last, levels, db, started, exited, ... }
  loggers: new Set(),
  dbs: new Set(),
  levelCounts: {},
  page: 1,
  pageSize: LogScope.PAGE_SIZE,
  activeLevels: new Set(LogScope.LEVELS),
  sortOrder: 'desc',  // 'asc' | 'desc' — applied to timestamp column
  fileName: '',
  sources: [],       // List of sources: { name, entries, workers, loggers, dbs, levelCounts }
  currentSource: null // Index of current source or null for all
};

/**
 * Reset state to initial values.
 */
LogScope.resetState = function () {
  LogScope.state.entries = [];
  LogScope.state.filtered = [];
  LogScope.state.workers = {};
  LogScope.state.loggers = new Set();
  LogScope.state.dbs = new Set();
  LogScope.state.levelCounts = {};
  LogScope.state.page = 1;
  LogScope.state.sources = [];
  LogScope.state.currentSource = null;
  LogScope.state.activeLevels = new Set(LogScope.LEVELS);
  LogScope.state.sortOrder = 'desc';
  LogScope.state.fileName = '';
};
