/**
 * LogScope - Format detection
 *
 * Scans the first non-empty lines of the file and picks the format whose
 * regex matches the most. Returns null if no format looks plausible.
 */

window.LogScope = window.LogScope || {};

const SAMPLE_LINES = 50;

LogScope.detectFormat = function (text) {
  const allLines = text.split(/\r?\n/);
  const lines = [];
  for (const l of allLines) {
    if (l.trim()) lines.push(l);
    if (lines.length >= SAMPLE_LINES) break;
  }
  if (lines.length === 0) return null;

  // JSON: count how many non-empty lines parse as JSON with timestamp+level
  let jsonScore = 0;
  for (const line of lines) {
    if (!line.trim() || line.trim()[0] !== '{') continue;
    try {
      const obj = JSON.parse(line);
      const hasTs = ['timestamp','time','@timestamp','ts','date','t','@t'].some(f => obj[f] != null);
      const hasMsg = ['message','msg','log','text','body','event','@m'].some(f => obj[f] != null);
      if (hasTs || hasMsg) jsonScore++;
    } catch { /* not JSON */ }
  }
  if (jsonScore / lines.length >= 0.3) return LogScope.FORMATS.JSON;

  let odoo = 0, pg = 0, sys = 0;
  for (const line of lines) {
    if (LogScope.ODOO_REGEX.test(line)) odoo++;
    else if (LogScope.PG_REGEX.test(line)) pg++;
    else if (LogScope.SYSLOG_REGEX.test(line)) sys++;
  }

  const max = Math.max(odoo, pg, sys);
  // Require at least 30% of sampled lines to match to avoid false positives
  if (max === 0 || max / lines.length < 0.3) return null;

  if (odoo === max) return LogScope.FORMATS.ODOO;
  if (pg === max) return LogScope.FORMATS.POSTGRES;
  return LogScope.FORMATS.SYSLOG;
};
