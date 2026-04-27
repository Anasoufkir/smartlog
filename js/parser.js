/**
 * LogScope - Parser orchestrator
 *
 * Dispatches the raw file content to the correct format-specific parser.
 * Each parser returns the same data structure so downstream UI modules
 * don't need to know which format was used.
 *
 * If `forcedFormat` is omitted, the format is auto-detected.
 */

window.LogScope = window.LogScope || {};

function parseByFormat(format, text, onProgress) {
  if (format === LogScope.FORMATS.POSTGRES) return LogScope.parsePostgres(text);
  if (format === LogScope.FORMATS.SYSLOG) return LogScope.parseSyslog(text);
  if (format === LogScope.FORMATS.JSON) return LogScope.parseJson(text);
  return LogScope.parseOdoo(text);
}

function parseByFormatAsync(format, lines, onProgress) {
  if (format === LogScope.FORMATS.POSTGRES) return LogScope.parsePostgresLinesAsync(lines, onProgress);
  if (format === LogScope.FORMATS.SYSLOG) return LogScope.parseSyslogLinesAsync(lines, onProgress);
  if (format === LogScope.FORMATS.JSON) return LogScope.parseJsonLinesAsync(lines, onProgress);
  return LogScope.parseOdooLinesAsync(lines, onProgress);
}

LogScope.parseLogFile = function (text, forcedFormat) {
  const detected = forcedFormat || LogScope.detectFormat(text) || LogScope.FORMATS.ODOO;
  let result = parseByFormat(detected, text);
  result.format = detected;

  if (result.entries.length === 0) {
    const fallbacks = [LogScope.FORMATS.POSTGRES, LogScope.FORMATS.SYSLOG, LogScope.FORMATS.ODOO]
      .filter((fmt) => fmt !== detected);
    for (const fmt of fallbacks) {
      const fallback = parseByFormat(fmt, text);
      if (fallback.entries.length > 0) {
        fallback.format = fmt;
        return fallback;
      }
    }
  }

  return result;
};

LogScope.parseLogFileAsync = function (text, forcedFormat, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const detected = forcedFormat || LogScope.detectFormat(text) || LogScope.FORMATS.ODOO;
      const lines = text.split(/\r?\n/);
      const parser = parseByFormatAsync(detected, lines, onProgress);

      parser.then((result) => {
        result.format = detected;
        if (result.entries.length === 0) {
          const fallbacks = [LogScope.FORMATS.POSTGRES, LogScope.FORMATS.SYSLOG, LogScope.FORMATS.ODOO]
            .filter((fmt) => fmt !== detected);
          const next = (idx) => {
            if (idx >= fallbacks.length) {
              resolve(result);
              return;
            }
            parseByFormatAsync(fallbacks[idx], lines, onProgress).then((fallback) => {
              if (fallback.entries.length > 0) {
                fallback.format = fallbacks[idx];
                resolve(fallback);
              } else {
                next(idx + 1);
              }
            }).catch(reject);
          };
          next(0);
        } else {
          resolve(result);
        }
      }).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
};
