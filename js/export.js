/**
 * LogScope - Export (CSV / JSON)
 */

window.LogScope = window.LogScope || {};

/**
 * Download the currently filtered entries as a file.
 * @param {'csv' | 'json'} format
 */
LogScope.exportFiltered = function (format) {
  const entries = LogScope.state.filtered;
  if (entries.length === 0) {
    alert('Rien à exporter.');
    return;
  }

  let blob;
  if (format === 'json') {
    const data = entries.map((e) => ({
      timestamp: e.ts,
      pid: e.pid,
      level: e.level,
      db: e.db,
      logger: e.logger,
      message: e.message
    }));
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  } else {
    const header = 'timestamp,pid,level,db,logger,message\n';
    const rows = entries.map((e) => {
      const msg = '"' + e.message.replace(/"/g, '""').replace(/\n/g, '\\n') + '"';
      return [e.ts, e.pid, e.level, e.db, e.logger, msg].join(',');
    }).join('\n');
    blob = new Blob([header + rows], { type: 'text/csv' });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'logscope-export.' + format;
  a.click();
  URL.revokeObjectURL(url);
};
