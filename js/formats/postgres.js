/**
 * LogScope - PostgreSQL log parser
 *
 * Handles the default Ubuntu 22.04 `log_line_prefix = '%m [%p] %q%u@%d '`
 * and most common variants. Multi-line queries are attached to the previous
 * entry as continuations.
 *
 * PostgreSQL's native levels (PANIC/FATAL/ERROR/WARNING/NOTICE/INFO/LOG/DEBUG*)
 * are normalized to LogScope's five-level scale via PG_LEVEL_MAP, so all
 * downstream UI works unchanged.
 *
 * STATEMENT/DETAIL/HINT/CONTEXT entries are preserved as separate entries
 * (they have their own timestamp/PID in the log) but mapped to DEBUG so they
 * don't inflate the ERROR count.
 */

window.LogScope = window.LogScope || {};

/**
 * Parse a PostgreSQL timestamp which may or may not have fractional seconds
 * and a timezone label.
 *   "2024-01-15 10:30:45.123 UTC" -> Date
 *   "2024-01-15 10:30:45 UTC"     -> Date
 *   "2024-01-15 10:30:45.123"     -> Date
 */
function parsePgTimestamp(ts) {
  // Trim and strip any trailing timezone (alphabetic like UTC/CET or offset like +01:00)
  const cleaned = ts.trim().replace(/\s+[A-Za-z][A-Za-z0-9+:/-]*$/, '').trim();
  const isoish = cleaned.replace(' ', 'T');
  const d = new Date(isoish);
  if (!isNaN(d.getTime())) return d;
  return new Date(isoish + '.000');
}

/**
 * Extract user and database from the middle part of a PG log line.
 * Possible shapes:
 *   ""                       -> { user: '', db: '' }
 *   "user@db "               -> { user: 'user', db: 'db' }
 *   "user=foo,db=bar,... "   -> { user: 'foo', db: 'bar' }
 */
function extractUserDb(middle) {
  if (!middle || !middle.trim()) return { user: '', db: '' };
  const s = middle.trim();

  // Key=value form
  const userMatch = /user=([^,\s]+)/i.exec(s);
  const dbMatch = /db=([^,\s]+)/i.exec(s);
  if (userMatch || dbMatch) {
    return { user: userMatch ? userMatch[1] : '', db: dbMatch ? dbMatch[1] : '' };
  }

  // user@db form
  const atMatch = /^([^\s@]+)@(\S+)/.exec(s);
  if (atMatch) return { user: atMatch[1], db: atMatch[2] };

  return { user: '', db: '' };
}

LogScope.parsePostgresLinesAsync = function (lines, onProgress) {
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

        const m = LogScope.PG_REGEX.exec(line);
        if (m) {
          const ts = m[1];
          const pid = m[2];
          const middle = m[3] || '';
          const pgLevel = m[4];
          const message = m[5];

          const date = parsePgTimestamp(ts);
          const { user, db } = extractUserDb(middle);
          const normalizedLevel = LogScope.PG_LEVEL_MAP[pgLevel] ||
            LogScope.PG_LEVEL_MAP[pgLevel.replace(/\d+$/, '')] || 'INFO';
          const logger = user && db ? `${user}@${db}` : (db || 'postgres');

          const entry = {
            idx: entries.length,
            timestamp: date,
            ts,
            pid,
            level: normalizedLevel,
            rawLevel: pgLevel,
            db: db || '?',
            user,
            logger,
            message,
            raw: line,
            format: 'postgres'
          };
          entries.push(entry);
          loggers.add(logger);
          if (db) dbs.add(db);
          levelCounts[normalizedLevel] = (levelCounts[normalizedLevel] || 0) + 1;

          if (!workers[pid]) {
            workers[pid] = {
              pid, first: date, last: date,
              firstIdx: entry.idx, lastIdx: entry.idx,
              levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
              db: db || '?', started: false, exited: false, logger
            };
          }
          workers[pid].last = date;
          workers[pid].lastIdx = entry.idx;
          workers[pid].levels[normalizedLevel]++;

          if (/connection received|connection authorized|received startup/i.test(message)) {
            workers[pid].started = true;
          }
          if (/disconnection|connection closed|received fast shutdown|terminating connection/i.test(message) ||
              pgLevel === 'FATAL' || pgLevel === 'PANIC') {
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

LogScope.parsePostgres = function (text) {
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

    const m = LogScope.PG_REGEX.exec(line);
    if (m) {
      const ts = m[1];
      const pid = m[2];
      const middle = m[3] || '';
      const pgLevel = m[4];
      const message = m[5];

      const date = parsePgTimestamp(ts);
      const { user, db } = extractUserDb(middle);
      // Normalize DEBUG1..5 -> DEBUG for the lookup
      const normalizedLevel = LogScope.PG_LEVEL_MAP[pgLevel] ||
        LogScope.PG_LEVEL_MAP[pgLevel.replace(/\d+$/, '')] || 'INFO';
      // Logger = "postgres" + optional user@db suffix for readability
      const logger = user && db ? `${user}@${db}` : (db || 'postgres');

      const entry = {
        idx: entries.length,
        timestamp: date,
        ts,
        pid,
        level: normalizedLevel,
        rawLevel: pgLevel,      // preserve original PG level (FATAL, NOTICE, etc.)
        db: db || '?',
        user,
        logger,
        message,
        raw: line,
        format: 'postgres'
      };
      entries.push(entry);
      loggers.add(logger);
      if (db) dbs.add(db);
      levelCounts[normalizedLevel] = (levelCounts[normalizedLevel] || 0) + 1;

      if (!workers[pid]) {
        workers[pid] = {
          pid, first: date, last: date,
          firstIdx: entry.idx, lastIdx: entry.idx,
          levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
          db: db || '?', started: false, exited: false, logger
        };
      }
      workers[pid].last = date;
      workers[pid].lastIdx = entry.idx;
      workers[pid].levels[normalizedLevel]++;

      // Connection lifecycle detection
      if (/connection received|connection authorized|received startup/i.test(message)) {
        workers[pid].started = true;
      }
      if (/disconnection|connection closed|received fast shutdown|terminating connection/i.test(message) ||
          pgLevel === 'FATAL' || pgLevel === 'PANIC') {
        workers[pid].exited = true;
      }

      last = entry;
    } else if (last) {
      // Multi-line continuation (long queries etc.)
      last.message += '\n' + line;
      last.raw += '\n' + line;
    }
  }

  return { entries, workers, loggers, dbs, levelCounts };
};
