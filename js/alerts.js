/**
 * LogScope - Threshold alerts
 * Define rules: "if more than N errors of level X in Y minutes → notify"
 * Rules are persisted in localStorage. Evaluation runs on file load and live tail.
 */

window.LogScope = window.LogScope || {};

(function () {
  const STORAGE_KEY = 'logscopeAlertRules';

  function loadRules() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function saveRules(rules) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  }

  LogScope.addAlertRule = function (level, count, windowMin) {
    const rules = loadRules();
    rules.push({
      id: Date.now(),
      level: level.toUpperCase(),
      count: Number(count),
      windowMin: Number(windowMin)
    });
    saveRules(rules);
    LogScope.renderAlertRules();
  };

  LogScope.deleteAlertRule = function (id) {
    saveRules(loadRules().filter(r => r.id !== id));
    LogScope.renderAlertRules();
  };

  LogScope.evaluateAlerts = function () {
    const entries = LogScope.state.entries;
    if (!entries.length) return;
    const rules = loadRules();
    if (!rules.length) return;

    const notifications = [];

    rules.forEach(rule => {
      const windowMs = rule.windowMin * 60 * 1000;
      let maxCount = 0;
      let worstWindow = null;

      // Sliding window scan
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.level !== rule.level) continue;
        const t0 = e.timestamp.getTime();
        let n = 0;
        for (let j = i; j < entries.length; j++) {
          if (entries[j].timestamp.getTime() - t0 > windowMs) break;
          if (entries[j].level === rule.level) n++;
        }
        if (n > maxCount) { maxCount = n; worstWindow = e.timestamp; }
      }

      if (maxCount >= rule.count) {
        notifications.push({
          rule,
          found: maxCount,
          at: worstWindow
        });
      }
    });

    renderAlertBanner(notifications);
  };

  function renderAlertBanner(notifications) {
    const banner = document.getElementById('alertsBanner');
    if (!banner) return;
    if (!notifications.length) { banner.hidden = true; return; }

    banner.hidden = false;
    const colors = { CRITICAL: '#FF4757', ERROR: '#FF6B6B', WARNING: '#FFA502' };
    banner.innerHTML = notifications.map(n => {
      const color = colors[n.rule.level] || '#FFA502';
      const ts = n.at ? n.at.toLocaleString('fr-FR') : '';
      return `<div class="alert-item" style="border-left:3px solid ${color}">
        <strong style="color:${color}">${n.rule.level}</strong>
        ${n.found} occurrences en ${n.rule.windowMin} min (seuil : ${n.rule.count})
        ${ts ? `— pic à ${ts}` : ''}
        <button class="alert-dismiss" onclick="this.closest('.alert-item').remove()">✕</button>
      </div>`;
    }).join('');
  }

  LogScope.renderAlertRules = function () {
    const tbody = document.getElementById('alertRulesBody');
    if (!tbody) return;
    const rules = loadRules();
    if (!rules.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-3);text-align:center;padding:10px">Aucune règle définie.</td></tr>';
      return;
    }
    const colors = { CRITICAL: '#FF4757', ERROR: '#FF6B6B', WARNING: '#FFA502', INFO: '#3DA9FC', DEBUG: '#747D8C' };
    tbody.innerHTML = rules.map(r => `
      <tr>
        <td><span style="color:${colors[r.level]||'#ccc'};font-weight:600">${r.level}</span></td>
        <td>${r.count}</td>
        <td>${r.windowMin} min</td>
        <td><button class="btn-small btn-danger" onclick="LogScope.deleteAlertRule(${r.id})">Supprimer</button></td>
      </tr>`).join('');
  };

  LogScope.initAlerts = function () {
    const form = document.getElementById('alertRuleForm');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const level = document.getElementById('alertLevel').value;
      const count = parseInt(document.getElementById('alertCount').value, 10);
      const win   = parseInt(document.getElementById('alertWindow').value, 10);
      if (!level || isNaN(count) || count < 1 || isNaN(win) || win < 1) return;
      LogScope.addAlertRule(level, count, win);
    });
    LogScope.renderAlertRules();
  };
})();
