/**
 * LogScope - Syslog / Ubuntu 22.04 system log parser
 *
 * Handles the BSD syslog format found in /var/log/syslog, /var/log/auth.log,
 * /var/log/kern.log, and journalctl default output.
 *
 *   Format: "MMM DD HH:MM:SS hostname process[PID]: message"
 *   Example: "Jan 15 10:30:45 ubuntu-srv systemd[1]: Started Daily apt upgrade"
 *
 * Syslog lines do NOT include a year. We assume the current year, with a
 * simple rollover: if a later line has an earlier month than its predecessor,
 * the year is incremented.
 *
 * No severity level is present in the text, so we infer one by keyword matching
 * on the message body. Default is INFO.
 */

window.LogScope = window.LogScope || {};

const SEVERITY_PATTERNS = [
  { level: 'CRITICAL', re: /\b(panic|emergency|emerg|alert|critical|crit|fatal)\b/i },
  { level: 'ERROR',    re: /\b(error|err|failed|failure|cannot|denied|refused|rejected|unable to|exception|segfault|segmentation fault)\b/i },
  { level: 'WARNING',  re: /\b(warning|warn|deprecated|slow|timeout|retry|retrying)\b/i },
  { level: 'DEBUG',    re: /\b(debug|trace|verbose)\b/i }
];

function inferSeverity(message) {
  for (const { level, re } of SEVERITY_PATTERNS) {
    if (re.test(message)) return level;
  }
  return 'INFO';
}

LogScope.parseSyslogLinesAsync = function (lines, onProgress) {
  return new Promise((resolve) => {
    const entries = [];
    const workers = {};       // keyed by PID (or process name if no PID)
    const loggers = new Set();
    const dbs = new Set();    // will hold hostnames for syslog
    const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

    const defaultYear = new Date().getFullYear();
    let currentYear = defaultYear;
    let lastMonthIdx = -1;

    let last = null;
    const total = lines.length;
    const step = 4000;
    let i = 0;

    function processChunk() {
      const end = Math.min(i + step, total);
      for (; i < end; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const m = LogScope.SYSLOG_REGEX.exec(line);
        if (m) {
          const monthStr = m[1];
          const day = parseInt(m[2], 10);
          const hour = parseInt(m[3], 10);
          const min = parseInt(m[4], 10);
          const sec = parseInt(m[5], 10);
          const host = m[6];
          const process = m[7];
          const pid = m[8] || ''; // may be empty if no [pid]
          const message = m[9] || '';

          const monthIdx = LogScope.SYSLOG_MONTHS[monthStr];
          if (monthIdx === undefined) continue;

          if (lastMonthIdx !== -1 && monthIdx < lastMonthIdx - 6) {
            currentYear++;
          }
          lastMonthIdx = monthIdx;

          const date = new Date(currentYear, monthIdx, day, hour, min, sec);
          const level = inferSeverity(message);
          const tsDisplay = `${monthStr} ${String(day).padStart(2, ' ')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
          const workerKey = pid || process;

          const entry = {
            idx: entries.length,
            timestamp: date,
            ts: tsDisplay,
            pid: pid || '—',
            level,
            db: host,
            host,
            logger: process,
            message,
            raw: line,
            format: 'syslog'
          };
          entries.push(entry);
          loggers.add(process);
          dbs.add(host);
          levelCounts[level]++;

          if (!workers[workerKey]) {
            workers[workerKey] = {
              pid: entry.pid, first: date, last: date,
              firstIdx: entry.idx, lastIdx: entry.idx,
              levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
              db: host, started: false, exited: false, logger: process
            };
          }
          workers[workerKey].last = date;
          workers[workerKey].lastIdx = entry.idx;
          workers[workerKey].levels[level]++;

          if (/started|starting|startup|activated|listening|ready/i.test(message)) {
            workers[workerKey].started = true;
          }
          if (/stopped|stopping|shutdown|deactivated|killed|terminated|exited/i.test(message)) {
            workers[workerKey].exited = true;
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

LogScope.parseSyslog = function (text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const workers = {};       // keyed by PID (or process name if no PID)
  const loggers = new Set();
  const dbs = new Set();    // will hold hostnames for syslog
  const levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

  const defaultYear = new Date().getFullYear();
  let currentYear = defaultYear;
  let lastMonthIdx = -1;

  let last = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const m = LogScope.SYSLOG_REGEX.exec(line);
    if (m) {
      const monthStr = m[1];
      const day = parseInt(m[2], 10);
      const hour = parseInt(m[3], 10);
      const min = parseInt(m[4], 10);
      const sec = parseInt(m[5], 10);
      const host = m[6];
      const process = m[7];
      const pid = m[8] || ''; // may be empty if no [pid]
      const message = m[9] || '';

      const monthIdx = LogScope.SYSLOG_MONTHS[monthStr];
      if (monthIdx === undefined) continue;

      // Year rollover detection (file contains entries across a new year)
      if (lastMonthIdx !== -1 && monthIdx < lastMonthIdx - 6) {
        currentYear++;
      }
      lastMonthIdx = monthIdx;

      const date = new Date(currentYear, monthIdx, day, hour, min, sec);
      const level = inferSeverity(message);
      const tsDisplay = `${monthStr} ${String(day).padStart(2, ' ')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

      // Key for workers map: use PID when present, otherwise process name
      // so we still get aggregation for services that don't print [PID]
      const workerKey = pid || process;

      const entry = {
        idx: entries.length,
        timestamp: date,
        ts: tsDisplay,
        pid: pid || '—',
        level,
        db: host,       // reused field: host maps to the DB filter column
        host,
        logger: process,
        message,
        raw: line,
        format: 'syslog'
      };
      entries.push(entry);
      loggers.add(process);
      dbs.add(host);
      levelCounts[level]++;

      if (!workers[workerKey]) {
        workers[workerKey] = {
          pid: entry.pid, first: date, last: date,
          firstIdx: entry.idx, lastIdx: entry.idx,
          levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
          db: host, started: false, exited: false, logger: process
        };
      }
      workers[workerKey].last = date;
      workers[workerKey].lastIdx = entry.idx;
      workers[workerKey].levels[level]++;

      if (/started|starting|startup|activated|listening|ready/i.test(message)) {
        workers[workerKey].started = true;
      }
      if (/stopped|stopping|shutdown|deactivated|killed|terminated|exited/i.test(message)) {
        workers[workerKey].exited = true;
      }

      last = entry;
    } else if (last) {
      last.message += '\n' + line;
      last.raw += '\n' + line;
    }
  }

  return { entries, workers, loggers, dbs, levelCounts };
};
