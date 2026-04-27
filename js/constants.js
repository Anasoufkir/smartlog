/**
 * LogScope - Constants
 * Shared constants used across modules
 */

const LogScope = window.LogScope || {};
window.LogScope = LogScope;

LogScope.LEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'];

LogScope.LEVEL_COLORS = {
  CRITICAL: '#FF4757',
  ERROR: '#FF6B6B',
  WARNING: '#FFA502',
  INFO: '#3DA9FC',
  DEBUG: '#747D8C'
};

/**
 * Supported log formats
 */
LogScope.FORMATS = {
  ODOO: 'odoo',
  POSTGRES: 'postgres',
  SYSLOG: 'syslog',
  JSON: 'json'
};

LogScope.FORMAT_NAMES = {
  odoo: 'Odoo',
  postgres: 'PostgreSQL',
  syslog: 'Syslog (Ubuntu)',
  json: 'JSON (Docker/K8s/Node.js)'
};

/**
 * Odoo log format.
 * Example: 2026-04-22 12:00:03,099 643418 INFO MASTER_BASE odoo.service.server: Worker exiting.
 */
LogScope.ODOO_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) (\d+) (CRITICAL|ERROR|WARNING|INFO|DEBUG) (\S+) ([^:]+): (.*)$/;
// Legacy alias
LogScope.LOG_REGEX = LogScope.ODOO_REGEX;

/**
 * PostgreSQL log format. Handles common log_line_prefix variants:
 *   %m [%p] %q%u@%d        → 2024-01-15 10:30:45.123 UTC [12345] user@db LOG:  message
 *   %t [%p-%l] %q%u@%d     → 2024-01-15 10:30:45 UTC [12345-1] user@db LOG:  message
 *   %t [%p]: [%l-1] %q...  → 2024-01-15 10:30:45 UTC [12345]: [1-1] user@db LOG:  message
 *   (no timezone)           → 2024-01-15 10:30:45.123 [12345] postgres@mydb FATAL:  message
 *   (+HH:MM offset)         → 2024-01-15 10:30:45.123 +01:00 [12345] LOG:  message
 */
LogScope.PG_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[^\[]*)\[(\d+)(?:-\d+)?\]\s*:?\s*(?:\[\d+-\d+\]\s*)?(.*?)(PANIC|FATAL|ERROR|WARNING|NOTICE|INFO|LOG|DEBUG[1-5]?|STATEMENT|DETAIL|HINT|CONTEXT|QUERY|LOCATION):\s*(.*)$/;

/**
 * Map PostgreSQL levels onto LogScope's normalized five-level scale.
 */
LogScope.PG_LEVEL_MAP = {
  PANIC: 'CRITICAL',
  FATAL: 'CRITICAL',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  NOTICE: 'INFO',
  INFO: 'INFO',
  LOG: 'INFO',
  DEBUG: 'DEBUG',
  DEBUG1: 'DEBUG',
  DEBUG2: 'DEBUG',
  DEBUG3: 'DEBUG',
  DEBUG4: 'DEBUG',
  DEBUG5: 'DEBUG',
  STATEMENT: 'DEBUG',
  DETAIL: 'DEBUG',
  HINT: 'DEBUG',
  CONTEXT: 'DEBUG',
  QUERY: 'DEBUG',
  LOCATION: 'DEBUG'
};

/**
 * Syslog / Ubuntu system log format (RFC 3164 BSD syslog).
 * Example:  Jan 15 10:30:45 hostname process[1234]: message
 * The year is absent in the line — we assume the current year.
 */
LogScope.SYSLOG_REGEX = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\S+)\s+([^\[\s:][^\[\s:]*?)(?:\[(\d+)\])?:\s*(.*)$/;

LogScope.SYSLOG_MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

LogScope.PAGE_SIZE = 100;
