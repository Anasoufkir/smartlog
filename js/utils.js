/**
 * LogScope - Utility functions
 */

window.LogScope = window.LogScope || {};

/**
 * Convert an Odoo timestamp string to a Date object.
 * @param {string} ts - "YYYY-MM-DD HH:MM:SS,mmm"
 * @returns {Date}
 */
LogScope.parseTimestamp = function (ts) {
  const parts = ts.split(' ');
  const date = parts[0];
  const timePart = parts[1].split(',');
  return new Date(date + 'T' + timePart[0] + '.' + timePart[1]);
};

/**
 * Format a duration in milliseconds as a human-readable string.
 * @param {number} ms
 * @returns {string}
 */
LogScope.formatDuration = function (ms) {
  if (ms < 1000) return ms + ' ms';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ' + (ms % 1000) + 'ms';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
  const d = Math.floor(h / 24);
  return d + 'j ' + (h % 24) + 'h ' + (m % 60) + 'm';
};

/**
 * Format a Date for display.
 * @param {Date} d
 * @returns {string}
 */
LogScope.formatDate = function (d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
};

/**
 * Format a Date for a `datetime-local` input.
 * @param {Date} d
 * @returns {string}
 */
LogScope.toLocalDatetimeString = function (d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
};

/**
 * Escape HTML special characters to prevent XSS in user-provided content.
 * @param {string} s
 * @returns {string}
 */
LogScope.escapeHtml = function (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

/**
 * Highlight occurrences of a query inside text with a <mark> tag.
 * @param {string} text
 * @param {string} q
 * @returns {string}
 */
LogScope.highlight = function (text, q) {
  if (!q) return LogScope.escapeHtml(text);
  const escaped = LogScope.escapeHtml(text);
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + safeQ + ')', 'ig');
  return escaped.replace(re, '<mark>$1</mark>');
};

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
LogScope.debounce = function (fn, delay) {
  let t;
  return function () {
    const args = arguments;
    const ctx = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), delay);
  };
};
