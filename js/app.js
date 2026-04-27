/**
 * LogScope — Application entry point
 * Handles auth, file loading, dashboard orchestration.
 */

window.LogScope = window.LogScope || {};

(function () {
  const API_BASE = 'http://localhost:3000';
  const LOCAL_LOG_SERVICE = `${API_BASE}/read-log`;
  const KEY_TOKEN = 'logscopeAuthToken';
  const KEY_USER  = 'logscopeAuthUser';
  const KEY_ROLE  = 'logscopeAuthRole';

  // ── Auth helpers (exposed for admin.js) ───────────────────────────────────

  function getAuthToken() { return sessionStorage.getItem(KEY_TOKEN); }
  function isAuthenticated() { return Boolean(getAuthToken()); }

  function getCurrentUser() {
    const username = sessionStorage.getItem(KEY_USER);
    if (!username) return null;
    // We need ID too; read from stored data
    const raw = sessionStorage.getItem('logscopeAuthUserData');
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* */ }
    }
    return { username, role: sessionStorage.getItem(KEY_ROLE) || 'user' };
  }

  async function authenticatedFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      clearAuthentication();
      showOverlay();
      setLoginError('Votre session a expiré. Veuillez vous reconnecter.');
    }
    return response;
  }

  // Expose for admin.js
  LogScope.getAuthToken = getAuthToken;
  LogScope.authenticatedFetch = authenticatedFetch;
  LogScope.getCurrentUser = getCurrentUser;

  // ── Auth UI helpers ───────────────────────────────────────────────────────

  function showOverlay() {
    document.getElementById('authOverlay').classList.add('active');
  }

  function hideOverlay() {
    document.getElementById('authOverlay').classList.remove('active');
  }

  function setLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function setRegisterError(msg) {
    const el = document.getElementById('registerError');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function setRegisterSuccess(msg) {
    const el = document.getElementById('registerSuccess');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function setAuthenticated(token, user) {
    sessionStorage.setItem(KEY_TOKEN, token);
    sessionStorage.setItem(KEY_USER, user.username);
    sessionStorage.setItem(KEY_ROLE, user.role || 'user');
    sessionStorage.setItem('logscopeAuthUserData', JSON.stringify(user));
    hideOverlay();
    updateAuthUi(user);
  }

  function clearAuthentication() {
    sessionStorage.removeItem(KEY_TOKEN);
    sessionStorage.removeItem(KEY_USER);
    sessionStorage.removeItem(KEY_ROLE);
    sessionStorage.removeItem('logscopeAuthUserData');
    updateAuthUi(null);
  }

  function updateAuthUi(user) {
    const logoutBtn   = document.getElementById('logoutBtn');
    const authPill    = document.getElementById('authUser');
    const adminBtn    = document.getElementById('adminPanelBtn');
    const adminBanner = document.getElementById('adminBanner');

    if (user) {
      authPill.hidden = false;
      authPill.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        ${escapeHtml(user.username)}
        ${user.role === 'admin' ? '<span class="pill-admin">Admin</span>' : ''}
      `;
      logoutBtn.hidden = false;
      adminBtn.hidden  = user.role !== 'admin';
      if (adminBanner) adminBanner.hidden = user.role !== 'admin';
    } else {
      authPill.hidden  = true;
      logoutBtn.hidden = true;
      adminBtn.hidden  = true;
      if (adminBanner) adminBanner.hidden = true;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Session restore ───────────────────────────────────────────────────────

  async function restoreSession() {
    if (!isAuthenticated()) { clearAuthentication(); return false; }
    try {
      const res = await authenticatedFetch(`${API_BASE}/auth/session`);
      if (!res.ok) { clearAuthentication(); return false; }
      const { user } = await res.json();
      setAuthenticated(getAuthToken(), user);
      return true;
    } catch {
      clearAuthentication();
      setLoginError('Le service local est inaccessible. Lancez `node local-log-service.js`.');
      return false;
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async function logout() {
    try {
      await authenticatedFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch { /* offline — clear anyway */ }
    clearAuthentication();
    // Hide admin panel if open
    document.getElementById('adminPanel').hidden = true;
    document.getElementById('appMain').style.display = '';
    showOverlay();
    setLoginError('');
    document.getElementById('loginPass').value = '';
  }

  // ── Auth tabs ─────────────────────────────────────────────────────────────

  function bindAuthTabs() {
    const tabLogin    = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const formLogin   = document.getElementById('loginForm');
    const formReg     = document.getElementById('registerForm');

    function switchTab(active) {
      if (active === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        formLogin.classList.add('active');
        formReg.classList.remove('active');
      } else {
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        formLogin.classList.remove('active');
        formReg.classList.add('active');
      }
    }

    tabLogin.addEventListener('click', () => switchTab('login'));
    tabRegister.addEventListener('click', () => switchTab('register'));

    // Password eye toggles
    document.querySelectorAll('.auth-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
  }

  // ── Login form ────────────────────────────────────────────────────────────

  function bindLoginForm() {
    const form = document.getElementById('loginForm');
    const btn  = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setLoginError('');
      btn.disabled = true;
      btn.textContent = 'Connexion…';

      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('loginUser').value.trim(),
            password: document.getElementById('loginPass').value
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) { setLoginError(payload.error || 'Connexion impossible.'); return; }

        setAuthenticated(payload.token, payload.user);
        document.getElementById('loginPass').value = '';
      } catch {
        setLoginError('Le service local est inaccessible. Lancez `node local-log-service.js`.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    });
  }

  // ── Register form ─────────────────────────────────────────────────────────

  function bindRegisterForm() {
    const form = document.getElementById('registerForm');
    const btn  = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setRegisterError('');
      setRegisterSuccess('');

      const username = document.getElementById('regUser').value.trim();
      const password = document.getElementById('regPass').value;
      const confirm  = document.getElementById('regPassConfirm').value;

      if (!username || !password) { setRegisterError('Tous les champs sont requis.'); return; }
      if (!/^[a-zA-Z0-9_.\-]{3,32}$/.test(username)) {
        setRegisterError('Identifiant invalide : 3-32 caractères alphanumérique (a-z, 0-9, _ . -).');
        return;
      }
      if (password.length < 6) { setRegisterError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
      if (password !== confirm) { setRegisterError('Les mots de passe ne correspondent pas.'); return; }

      btn.disabled = true;
      btn.textContent = 'Création…';

      try {
        // Registration creates a "user" role account via admin endpoint — but
        // we expose a /auth/register route that any visitor can use.
        // For now we call the open register route (added in backend).
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) { setRegisterError(payload.error || 'Création du compte impossible.'); return; }

        setRegisterSuccess(`Compte « ${username} » créé ! Vous pouvez maintenant vous connecter.`);
        document.getElementById('regUser').value = '';
        document.getElementById('regPass').value = '';
        document.getElementById('regPassConfirm').value = '';

        // Auto-switch to login tab after 2 s
        setTimeout(() => {
          document.getElementById('tabLogin').click();
          document.getElementById('loginUser').value = username;
          document.getElementById('loginPass').focus();
        }, 2000);
      } catch {
        setRegisterError('Le service local est inaccessible. Lancez `node local-log-service.js`.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Créer le compte';
      }
    });
  }

  // ── Auth init ─────────────────────────────────────────────────────────────

  async function bindAuth() {
    updateAuthUi(null);
    bindAuthTabs();
    bindLoginForm();
    bindRegisterForm();

    document.getElementById('logoutBtn').addEventListener('click', logout);

    const adminBannerBtn = document.getElementById('adminBannerBtn');
    if (adminBannerBtn) {
      adminBannerBtn.addEventListener('click', () => {
        document.getElementById('adminPanel').hidden = false;
        LogScope.loadAdminUsers && LogScope.loadAdminUsers();
      });
    }

    const hasSession = await restoreSession();
    document.getElementById('authOverlay').classList.toggle('active', !hasSession);
  }

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!isAuthenticated()) { alert('Veuillez vous connecter avant de charger un fichier.'); return; }
    if (file.size > 50 * 1024 * 1024 &&
        !confirm('Le fichier est très volumineux (>50MB). Continuer ?')) return;

    LogScope.showLoader('Lecture du fichier ' + file.name + '...');
    const reader = new FileReader();
    reader.onload = async (e) => {
      LogScope.showLoader('Analyse du contenu...');
      setTimeout(async () => {
        try {
          const forced = document.getElementById('formatSelect').value;
          const fmt = forced === 'auto' ? null : forced;
          let result = await LogScope.parseLogFileAsync(e.target.result, fmt, p => {
            LogScope.showLoader('Analyse du contenu... ' + p + '%');
          });
          if (result.entries.length === 0 && fmt) {
            const fb = await LogScope.parseLogFileAsync(e.target.result, null, p => {
              LogScope.showLoader('Détection du format... ' + p + '%');
            });
            if (fb.entries.length > 0) result = fb;
          }
          if (result.entries.length === 0) {
            LogScope.hideLoader();
            alert('Aucune ligne de log valide détectée pour le format "' +
              LogScope.FORMAT_NAMES[result.format] + '".');
            return;
          }
          addSource(file.name, result, e.target.result);
          LogScope.hideLoader();
        } catch (err) {
          LogScope.hideLoader();
          alert('Erreur lors de l\'analyse : ' + err.message);
        }
      }, 50);
    };
    reader.onerror = () => { LogScope.hideLoader(); alert('Impossible de lire le fichier.'); };
    reader.readAsText(file);
  }

  function addSource(name, result, rawText) {
    const source = {
      name, rawText,
      entries: result.entries, workers: result.workers,
      loggers: result.loggers, dbs: result.dbs,
      levelCounts: result.levelCounts, format: result.format
    };
    LogScope.state.sources.push(source);
    mergeSources();
    if (LogScope.state.sources.length === 1) {
      initDashboard(name);
    } else {
      document.getElementById('uploadZone').style.display = 'none';
      document.getElementById('dashboard').classList.add('active');
      updateDashboard();
    }
  }

  function mergeSources() {
    const s = LogScope.state;
    s.entries = []; s.workers = {}; s.loggers = new Set(); s.dbs = new Set();
    s.levelCounts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };

    for (const src of s.sources) {
      for (const entry of src.entries) { entry.source = src.name; s.entries.push(entry); }
      for (const [pid, worker] of Object.entries(src.workers)) {
        s.workers[`${src.name}:${pid}`] = { ...worker, source: src.name };
      }
      for (const logger of src.loggers) s.loggers.add(logger);
      for (const db of src.dbs) s.dbs.add(db);
      for (const level in src.levelCounts) s.levelCounts[level] += src.levelCounts[level];
    }
    s.filtered = s.entries;
    s.page = 1;
    s.fileName = s.sources.map(src => src.name).join(' + ');
  }

  async function loadPathFromService() {
    if (!isAuthenticated()) { alert('Veuillez vous connecter avant de charger un fichier.'); return; }
    const logPath = document.getElementById('pathInput').value.trim();
    if (!logPath) { alert('Veuillez saisir un chemin de fichier.'); return; }

    const host     = document.getElementById('remoteHost').value.trim();
    const port     = document.getElementById('remotePort').value.trim() || '22';
    const sshUser  = document.getElementById('sshUser').value.trim();
    const sshKeyPath = document.getElementById('sshKeyPath').value.trim();
    if (host && !sshUser) { alert('Veuillez renseigner l\'utilisateur SSH.'); return; }

    LogScope.showLoader('Lecture du fichier depuis le service local...');
    try {
      const payload = {
        path: logPath,
        host: host || undefined,
        port: host ? port : undefined,
        user: host ? sshUser : undefined,
        keyPath: host ? sshKeyPath : undefined,
        sudo: document.getElementById('useSudo').checked
      };
      const res = await authenticatedFetch(LOCAL_LOG_SERVICE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text() || 'Échec lecture : ' + res.status);
      const text = await res.text();
      const forced = document.getElementById('formatSelect').value;
      const fmt = forced === 'auto' ? null : forced;
      let result = await LogScope.parseLogFileAsync(text, fmt, p => {
        LogScope.showLoader('Analyse du contenu... ' + p + '%');
      });
      if (result.entries.length === 0 && fmt) {
        const fb = await LogScope.parseLogFileAsync(text, null, p => {
          LogScope.showLoader('Détection du format... ' + p + '%');
        });
        if (fb.entries.length > 0) result = fb;
      }
      if (result.entries.length === 0) {
        LogScope.hideLoader();
        alert('Aucune ligne de log valide détectée pour le format "' + LogScope.FORMAT_NAMES[result.format] + '".');
        return;
      }
      addSource(logPath, result, text);
      LogScope.hideLoader();
    } catch (err) {
      LogScope.hideLoader();
      alert(err.message);
    }
  }

  async function reparseWithFormat() {
    const state = LogScope.state;
    if (!state.rawText) return;
    const forced = document.getElementById('formatSelect').value;
    const fmt = forced === 'auto' ? null : forced;
    LogScope.showLoader('Re-analyse…');
    setTimeout(async () => {
      try {
        const result = await LogScope.parseLogFileAsync(state.rawText, fmt, p => {
          LogScope.showLoader('Re-analyse du contenu... ' + p + '%');
        });
        Object.assign(state, {
          entries: result.entries, workers: result.workers,
          loggers: result.loggers, dbs: result.dbs,
          levelCounts: result.levelCounts, filtered: result.entries,
          format: result.format, page: 1
        });
        if (result.entries.length === 0) { LogScope.hideLoader(); alert('Aucune ligne reconnue avec ce format.'); return; }
        initDashboard(state.fileName);
        LogScope.hideLoader();
      } catch (err) { LogScope.hideLoader(); alert('Erreur : ' + err.message); }
    }, 50);
  }

  function applyFormatLabels(format) {
    document.getElementById('dbFilterLabel').textContent = format === 'syslog' ? 'Hôte' : 'Base de données';
  }

  function initDashboard(fileName) {
    document.getElementById('uploadZone').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    const ts = document.getElementById('topbarStatus');
    ts.classList.add('loaded');
    const format = LogScope.state.format || 'odoo';
    document.getElementById('statusText').textContent =
      `${fileName} • ${LogScope.FORMAT_NAMES[format] || format} • ${LogScope.state.entries.length.toLocaleString('fr')} entrées`;
    document.getElementById('formatSelect').value = format;
    applyFormatLabels(format);
    LogScope.renderStats();
    LogScope.renderLevelFilters();
    LogScope.populateSelects();
    LogScope.setDefaultDateRange();
    LogScope.applyFilters();

    // Show anomaly card
    const anomalyCard = document.getElementById('anomalyCard');
    if (anomalyCard) anomalyCard.style.display = '';
    LogScope.renderAnomalyCard && LogScope.renderAnomalyCard();

    // Evaluate threshold alerts
    LogScope.evaluateAlerts && LogScope.evaluateAlerts();

    // Load annotations for this file
    LogScope.loadAnnotations && LogScope.loadAnnotations();
  }

  function updateDashboard() {
    LogScope.renderStats();
    LogScope.renderLevelFilters();
    LogScope.populateSelects();
    LogScope.setDefaultDateRange();
    LogScope.applyFilters();
  }

  function loadNewFile() {
    if (!confirm('Charger un nouveau fichier ? Les données actuelles seront perdues.')) return;
    LogScope.resetState();
    document.getElementById('dashboard').classList.remove('active');
    document.getElementById('uploadZone').style.display = 'block';
    document.getElementById('topbarStatus').classList.remove('loaded');
    document.getElementById('statusText').textContent = 'Aucun fichier chargé';
    document.getElementById('fileInput').value = '';
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    bindAuth();
    LogScope.initUploadZone(handleFile);
    LogScope.initTabs();
    LogScope.initCompare();

    document.getElementById('resetPidFilter').addEventListener('click', () => {
      LogScope.state.pidFilter = '';
      document.getElementById('pidInput').value = '';
      LogScope.applyFilters();
    });

    document.getElementById('filterLocksBtn').addEventListener('click', () => {
      document.getElementById('searchInput').value = 'lock';
      LogScope.applyFilters();
    });

    document.getElementById('addFileBtn').addEventListener('click', () => {
      const copyIfEmpty = (src, dst) => {
        const dstEl = document.getElementById(dst);
        if (!dstEl.value) dstEl.value = document.getElementById(src).value;
      };
      copyIfEmpty('remoteHost', 'addFileHost');
      copyIfEmpty('remotePort', 'addFilePort');
      copyIfEmpty('sshUser', 'addFileSshUser');
      copyIfEmpty('sshKeyPath', 'addFileSshKey');
      document.getElementById('addFileModal').classList.add('active');
    });

    document.getElementById('addFileModalClose').addEventListener('click', () => {
      document.getElementById('addFileModal').classList.remove('active');
    });
    document.getElementById('addFileModal').addEventListener('click', e => {
      if (e.target.id === 'addFileModal') document.getElementById('addFileModal').classList.remove('active');
    });

    document.getElementById('addFileBrowseBtn').addEventListener('click', () => {
      document.getElementById('addFileInput').click();
    });
    document.getElementById('addFileInput').addEventListener('change', async e => {
      if (!e.target.files.length) return;
      document.getElementById('addFileModal').classList.remove('active');
      await handleFile(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('addFileLoadBtn').addEventListener('click', async () => {
      if (!isAuthenticated()) { alert('Veuillez vous connecter avant de charger un fichier.'); return; }
      const logPath = document.getElementById('addFilePathInput').value.trim();
      if (!logPath) { alert('Veuillez saisir un chemin de fichier.'); return; }
      const host    = document.getElementById('addFileHost').value.trim();
      const port    = document.getElementById('addFilePort').value.trim() || '22';
      const sshUser = document.getElementById('addFileSshUser').value.trim();
      const sshKeyPath = document.getElementById('addFileSshKey').value.trim();
      if (host && !sshUser) { alert('Veuillez renseigner l\'utilisateur SSH.'); return; }
      document.getElementById('addFileModal').classList.remove('active');
      LogScope.showLoader('Lecture du fichier depuis le service local...');
      try {
        const payload = {
          path: logPath,
          host: host || undefined, port: host ? port : undefined,
          user: host ? sshUser : undefined, keyPath: host ? sshKeyPath : undefined,
          sudo: document.getElementById('addFileSudo').checked
        };
        const res = await authenticatedFetch(LOCAL_LOG_SERVICE, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text() || 'Échec lecture : ' + res.status);
        const text = await res.text();
        let result = await LogScope.parseLogFileAsync(text, null, p => {
          LogScope.showLoader('Analyse du contenu... ' + p + '%');
        });
        if (result.entries.length === 0) {
          LogScope.hideLoader();
          alert('Aucune ligne de log valide détectée.');
          return;
        }
        addSource(logPath, result, text);
        LogScope.hideLoader();
      } catch (err) { LogScope.hideLoader(); alert(err.message); }
    });

    document.getElementById('sourceSelect')?.addEventListener('change', LogScope.applyFilters);

    const debouncedApply = LogScope.debounce(LogScope.applyFilters, 150);
    document.getElementById('searchInput').addEventListener('input', debouncedApply);
    document.getElementById('pidInput').addEventListener('input', debouncedApply);
    document.getElementById('dateStart').addEventListener('change', LogScope.applyFilters);
    document.getElementById('dateEnd').addEventListener('change', LogScope.applyFilters);
    document.getElementById('dbSelect').addEventListener('change', LogScope.applyFilters);
    document.getElementById('loggerSelect').addEventListener('change', LogScope.applyFilters);

    document.getElementById('resetBtn').addEventListener('click', LogScope.resetFilters);
    document.getElementById('newFileBtn').addEventListener('click', loadNewFile);
    document.getElementById('exportCsvBtn').addEventListener('click', () => LogScope.exportFiltered('csv'));
    document.getElementById('exportJsonBtn').addEventListener('click', () => LogScope.exportFiltered('json'));
    document.getElementById('reportBtn')?.addEventListener('click', () => LogScope.generateReport());
    document.getElementById('loadPathBtn').addEventListener('click', loadPathFromService);

    // Presets, live tail, annotations, alerts
    LogScope.initPresets();
    LogScope.initLiveTail();
    LogScope.initAnnotations();
    LogScope.initAlerts();

    document.getElementById('formatSelect').addEventListener('change', () => {
      if (LogScope.state.rawText) reparseWithFormat();
    });

    document.getElementById('modalCloseBtn').addEventListener('click', LogScope.closeModal);
    document.getElementById('modalOverlay').addEventListener('click', e => {
      if (e.target.id === 'modalOverlay') LogScope.closeModal();
    });

    document.getElementById('compareToggleBtn').addEventListener('click', () => {
      const cmp = document.getElementById('compareSection');
      const active = cmp.classList.contains('active');
      if (active) {
        cmp.classList.remove('active');
        if (LogScope.state.entries.length > 0) {
          document.getElementById('dashboard').classList.add('active');
        } else {
          document.getElementById('uploadZone').style.display = 'block';
        }
      } else {
        document.getElementById('uploadZone').style.display = 'none';
        document.getElementById('dashboard').classList.remove('active');
        cmp.classList.add('active');
      }
    });

    window.addEventListener('resize', () => {
      if (document.querySelector('[data-panel="timeline"].active')) LogScope.drawTimeline();
      if (document.querySelector('[data-panel="gantt"].active')) LogScope.drawGantt();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        LogScope.closeModal();
        document.getElementById('resetPassModal')?.classList.remove('active');
      }
      if (e.key === '/' &&
          document.activeElement.tagName !== 'INPUT' &&
          document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
      }
    });
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
