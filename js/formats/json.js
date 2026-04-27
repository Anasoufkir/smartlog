/**
 * LogScope - JSON log parser
 * Handles: Docker, Kubernetes, Winston, Bunyan, Pino, and generic JSON logs.
 */

window.LogScope = window.LogScope || {};

(function () {
  const NUM_LEVEL = { 10: 'DEBUG', 20: 'DEBUG', 30: 'INFO', 40: 'WARNING', 50: 'ERROR', 60: 'CRITICAL' };
  const STR_LEVEL = {
    trace: 'DEBUG', debug: 'DEBUG', verbose: 'DEBUG',
    info: 'INFO', notice: 'INFO', log: 'INFO',
    warn: 'WARNING', warning: 'WARNING',
    error: 'ERROR', err: 'ERROR',
    fatal: 'CRITICAL', critical: 'CRITICAL', panic: 'CRITICAL', crit: 'CRITICAL'
  };

  function normalizeLevel(raw) {
    if (raw == null) return 'INFO';
    if (typeof raw === 'number') {
      if (raw < 20) return 'DEBUG';
      if (raw < 30) return 'DEBUG';
      if (raw < 40) return 'INFO';
      if (raw < 50) return 'WARNING';
      if (raw < 60) return 'ERROR';
      return 'CRITICAL';
    }
    return STR_LEVEL[String(raw).toLowerCase()] || 'INFO';
  }

  function extractTimestamp(obj) {
    const fields = ['timestamp', 'time', '@timestamp', 'ts', 'date', 'datetime', 't', 'Time', 'Timestamp', '@t'];
    for (const f of fields) {
      const v = obj[f];
      if (v == null) continue;
      if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
      const d = new Date(v);
      if (!isNaN(d)) return d;
    }
    return null;
  }

  function extractStr(obj, fields, fallback = '') {
    for (const f of fields) {
      if (obj[f] != null) return String(obj[f]);
    }
    return fallback;
  }

  function parseLine(line, idx) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') return null;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { return null; }
    if (typeof obj !== 'object' || Array.isArray(obj)) return null;

    const date = extractTimestamp(obj);
    if (!date || isNaN(date)) return null;

    const rawLevel = obj.level !== undefined ? obj.level
      : (obj.severity !== undefined ? obj.severity
        : (obj.SEVERITY || obj.loglevel || obj.log_level || obj.lvl || null));
    const level = normalizeLevel(rawLevel);

    const message = extractStr(obj,
      ['message', 'msg', 'log', 'text', 'body', 'content', 'Message', 'Msg', '@m', 'event']);
    const pid = extractStr(obj, ['pid', 'PID', 'process_id', 'processId', 'proc_id'], '?');
    const logger = extractStr(obj, ['logger', 'name', 'service', 'module', 'component', 'category', 'Name', 'Logger']);
    const db = extractStr(obj, ['db', 'database', 'dbname', 'db_name', 'schema']);
    const tsRaw = obj.timestamp || obj.time || obj['@timestamp'] || obj.ts || obj['@t'] || '';

    return {
      idx,
      timestamp: date,
      ts: typeof tsRaw === 'string' ? tsRaw : date.toISOString(),
      pid, level, db, logger, message,
      raw: trimmed,
      format: 'json',
      extra: obj
    };
  }

  LogScope.parseJsonLinesAsync = function (lines, onProgress) {
    return new Promise((resolve) => {
      const entries = [];
      const workers = {};
      const loggers = new Set();
      const dbs = new Set();
      const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

      const total = lines.length;
      const step = 4000;
      let i = 0;

      function chunk() {
        const end = Math.min(i + step, total);
        for (; i < end; i++) {
          const entry = parseLine(lines[i], entries.length);
          if (!entry) continue;

          entries.push(entry);
          if (entry.logger) loggers.add(entry.logger);
          if (entry.db && entry.db !== '?') dbs.add(entry.db);
          levelCounts[entry.level] = (levelCounts[entry.level] || 0) + 1;

          const { pid, level, db, logger, timestamp } = entry;
          if (!workers[pid]) {
            workers[pid] = {
              pid, first: timestamp, last: timestamp,
              firstIdx: entry.idx, lastIdx: entry.idx,
              levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
              db, started: false, exited: false, logger
            };
          }
          workers[pid].last = timestamp;
          workers[pid].lastIdx = entry.idx;
          workers[pid].levels[level] = (workers[pid].levels[level] || 0) + 1;
        }
        if (i < total) {
          if (onProgress) onProgress(Math.round(i / total * 100));
          setTimeout(chunk, 0);
        } else {
          if (onProgress) onProgress(100);
          resolve({ entries, workers, loggers, dbs, levelCounts });
        }
      }

      chunk();
    });
  };

  // Sync version (kept for backward compat)
  LogScope.parseJson = function (text) {
    const lines = text.split(/\r?\n/);
    const entries = [];
    const workers = {};
    const loggers = new Set();
    const dbs = new Set();
    const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

    for (let i = 0; i < lines.length; i++) {
      const entry = parseLine(lines[i], entries.length);
      if (!entry) continue;
      entries.push(entry);
      if (entry.logger) loggers.add(entry.logger);
      if (entry.db && entry.db !== '?') dbs.add(entry.db);
      levelCounts[entry.level] = (levelCounts[entry.level] || 0) + 1;
      const { pid, level, db, logger, timestamp } = entry;
      if (!workers[pid]) {
        workers[pid] = {
          pid, first: timestamp, last: timestamp,
          firstIdx: entry.idx, lastIdx: entry.idx,
          levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
          db, started: false, exited: false, logger
        };
      }
      workers[pid].last = timestamp;
      workers[pid].lastIdx = entry.idx;
      workers[pid].levels[level]++;
    }

    return { entries, workers, loggers, dbs, levelCounts };
  };

  // Expose parseLine for live tail ingestion
  LogScope.parseJsonLine = function (line, idx) { return parseLine(line, idx); };
})();
