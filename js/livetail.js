/**
 * LogScope - Live tail (Server-Sent Events)
 * Streams new log lines from a local or remote file in real time.
 */

window.LogScope = window.LogScope || {};

(function () {
  const API = 'http://localhost:3000';
  let evtSource = null;
  let liveBuffer = [];
  let liveFormat = null;
  let flushTimer = null;
  let liveActive = false;

  function setStatus(msg, cls) {
    const el = document.getElementById('liveTailStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'live-status ' + (cls || '');
  }

  function appendEntries(newEntries) {
    if (!newEntries.length) return;
    const state = LogScope.state;

    // Re-index
    const offset = state.entries.length;
    newEntries.forEach((e, i) => { e.idx = offset + i; });

    state.entries.push(...newEntries);
    state.filtered.push(...newEntries.filter(e => state.activeLevels.has(e.level)));

    // Update level counts
    newEntries.forEach(e => {
      state.levelCounts[e.level] = (state.levelCounts[e.level] || 0) + 1;
    });

    LogScope.renderStats();
    LogScope.renderLogRows();
    LogScope.updateTabCounts();

    // Auto-scroll log table to bottom
    const logRows = document.getElementById('logRows');
    if (logRows) logRows.scrollTop = logRows.scrollHeight;
  }

  function flushBuffer() {
    if (!liveBuffer.length) return;
    appendEntries(liveBuffer.splice(0));
  }

  function startFlushTimer() {
    if (!flushTimer) flushTimer = setInterval(flushBuffer, 800);
  }

  function stopFlushTimer() {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    flushBuffer();
  }

  LogScope.startLiveTail = function () {
    const path    = document.getElementById('liveTailPath')?.value.trim();
    const host    = document.getElementById('liveTailHost')?.value.trim();
    const port    = document.getElementById('liveTailPort')?.value.trim() || '22';
    const user    = document.getElementById('liveTailUser')?.value.trim();
    const keyPath = document.getElementById('liveTailKey')?.value.trim();
    const sudo    = document.getElementById('liveTailSudo')?.checked;
    const fmt     = document.getElementById('liveTailFormat')?.value || 'auto';

    if (!path) { setStatus('Renseignez un chemin de fichier.', 'error'); return; }

    LogScope.stopLiveTail();

    const token = LogScope.getAuthToken ? LogScope.getAuthToken() : '';
    const params = new URLSearchParams({ path, token });
    if (host)    params.set('host', host);
    if (port)    params.set('port', port);
    if (user)    params.set('user', user);
    if (keyPath) params.set('keyPath', keyPath);
    if (sudo)    params.set('sudo', '1');
    if (fmt && fmt !== 'auto') params.set('format', fmt);

    liveFormat = fmt === 'auto' ? null : fmt;
    liveActive = true;

    evtSource = new EventSource(`${API}/live-tail?${params}`);

    evtSource.addEventListener('connected', () => {
      setStatus('Connecté — en attente de nouvelles lignes…', 'ok');
      startFlushTimer();
      document.getElementById('liveTailStartBtn').disabled = true;
      document.getElementById('liveTailStopBtn').disabled  = false;
    });

    evtSource.addEventListener('line', (e) => {
      try {
        const data = JSON.parse(e.data);
        const raw  = data.line || '';
        if (!raw.trim()) return;

        // Detect format on first line if auto
        if (!liveFormat) {
          liveFormat = LogScope.detectFormat(raw) || LogScope.FORMATS.ODOO;
        }

        // Parse the single line synchronously using the detected format
        let entry = null;
        if (liveFormat === LogScope.FORMATS.JSON) {
          entry = LogScope.parseJsonLine ? LogScope.parseJsonLine(raw, 0) : null;
        } else if (liveFormat === LogScope.FORMATS.ODOO) {
          const m = LogScope.ODOO_REGEX.exec(raw);
          if (m) {
            entry = {
              idx: 0, timestamp: LogScope.parseTimestamp(m[1]),
              ts: m[1], pid: m[2], level: m[3], db: m[4],
              logger: m[5].trim(), message: m[6], raw, format: 'odoo'
            };
          }
        } else if (liveFormat === LogScope.FORMATS.POSTGRES) {
          const m = LogScope.PG_REGEX.exec(raw);
          if (m) {
            const level = LogScope.PG_LEVEL_MAP[m[4]] || 'INFO';
            entry = {
              idx: 0, timestamp: new Date(m[1].trim()),
              ts: m[1].trim(), pid: m[2], level, db: '',
              logger: '', message: m[5], raw, format: 'postgres'
            };
          }
        }

        if (entry) liveBuffer.push(entry);
      } catch { /* skip bad line */ }
    });

    evtSource.addEventListener('error', (e) => {
      if (!liveActive) return;
      setStatus('Connexion perdue. Vérifiez le service et le chemin.', 'error');
      LogScope.stopLiveTail();
    });

    setStatus('Connexion en cours…', '');
  };

  LogScope.stopLiveTail = function () {
    liveActive = false;
    if (evtSource) { evtSource.close(); evtSource = null; }
    stopFlushTimer();
    setStatus('Arrêté.', '');
    const startBtn = document.getElementById('liveTailStartBtn');
    const stopBtn  = document.getElementById('liveTailStopBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn)  stopBtn.disabled  = true;
  };

  LogScope.initLiveTail = function () {
    document.getElementById('liveTailStartBtn')?.addEventListener('click', LogScope.startLiveTail);
    document.getElementById('liveTailStopBtn')?.addEventListener('click', LogScope.stopLiveTail);
  };
})();
