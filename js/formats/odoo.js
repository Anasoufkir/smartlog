/**
 * LogScope - Odoo log parser
 *
 * Parses Odoo's standard log format:
 *   YYYY-MM-DD HH:MM:SS,mmm PID LEVEL DBNAME logger: message
 *
 * Continuation lines (tracebacks, multi-line messages) are attached to the
 * previous entry.
 */

window.LogScope = window.LogScope || {};

LogScope.parseOdooLinesAsync = function (lines, onProgress) {
  return new Promise((resolve) => {
    const entries = [];
    const workers = {};
    const loggers = new Set();
    const dbs = new Set();
    const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

    let last = null;
    const total = lines.length;
    const step = 4000;
    let i = 0;

    function processChunk() {
      const end = Math.min(i + step, total);
      for (; i < end; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const m = LogScope.ODOO_REGEX.exec(line);
        if (m) {
          const ts = m[1], pid = m[2], level = m[3], db = m[4];
          const logger = m[5].trim();
          const message = m[6];

          const date = LogScope.parseTimestamp(ts);
          const entry = {
            idx: entries.length,
            timestamp: date,
            ts, pid, level, db, logger, message, raw: line,
            format: 'odoo'
          };
          entries.push(entry);
          loggers.add(logger);
          if (db && db !== '?') dbs.add(db);
          levelCounts[level] = (levelCounts[level] || 0) + 1;

          if (!workers[pid]) {
            workers[pid] = {
              pid, first: date, last: date,
              firstIdx: entry.idx, lastIdx: entry.idx,
              levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
              db, started: false, exited: false, logger
            };
          }
          workers[pid].last = date;
          workers[pid].lastIdx = entry.idx;
          workers[pid].levels[level] = (workers[pid].levels[level] || 0) + 1;

          if (/worker.*(alive|starting|started|spawned|ready)/i.test(message) ||
              /server.*(starting|ready)/i.test(message)) {
            workers[pid].started = true;
          }
          if (/worker.*(exit|exiting|exited|shutting down|stopped|terminated)/i.test(message) ||
              /killed|sigterm|sigkill/i.test(message)) {
            workers[pid].exited = true;
          }

          last = entry;
        } else if (last) {
          last.message += '\n' + line;
          last.raw += '\n' + line;
        }
      }

      if (onProgress) {
        onProgress(Math.min(100, Math.floor((i / total) * 100)));
      }
      if (i < total) {
        setTimeout(processChunk, 0);
      } else {
        resolve({ entries, workers, loggers, dbs, levelCounts });
      }
    }

    processChunk();
  });
};

LogScope.parseOdoo = function (text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const workers = {};
  const loggers = new Set();
  const dbs = new Set();
  const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

  let last = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const m = LogScope.ODOO_REGEX.exec(line);
    if (m) {
      const ts = m[1], pid = m[2], level = m[3], db = m[4];
      const logger = m[5].trim();
      const message = m[6];

      const date = LogScope.parseTimestamp(ts);
      const entry = {
        idx: entries.length,
        timestamp: date,
        ts, pid, level, db, logger, message, raw: line,
        format: 'odoo'
      };
      entries.push(entry);
      loggers.add(logger);
      if (db && db !== '?') dbs.add(db);
      levelCounts[level] = (levelCounts[level] || 0) + 1;

      if (!workers[pid]) {
        workers[pid] = {
          pid, first: date, last: date,
          firstIdx: entry.idx, lastIdx: entry.idx,
          levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
          db, started: false, exited: false, logger
        };
      }
      workers[pid].last = date;
      workers[pid].lastIdx = entry.idx;
      workers[pid].levels[level] = (workers[pid].levels[level] || 0) + 1;

      if (/worker.*(alive|starting|started|spawned|ready)/i.test(message) ||
          /server.*(starting|ready)/i.test(message)) {
        workers[pid].started = true;
      }
      if (/worker.*(exit|exiting|exited|shutting down|stopped|terminated)/i.test(message) ||
          /killed|sigterm|sigkill/i.test(message)) {
        workers[pid].exited = true;
      }

      last = entry;
    } else if (last) {
      last.message += '\n' + line;
      last.raw += '\n' + line;
    }
  }

  return { entries, workers, loggers, dbs, levelCounts };
};
