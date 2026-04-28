/**
 * LogScope — Rapport IA (analyse Claude Opus)
 */
(function () {
  const API = 'http://localhost:3000';
  const MAX_SAMPLE_LINES = 300;

  function buildStats(state) {
    const entries = state.entries || [];
    const levelCounts = state.levelCounts || {};
    const workers = state.workers || {};

    const errors = entries.filter(e => e.level === 'ERROR' || e.level === 'CRITICAL');
    const topErrors = {};
    errors.forEach(e => {
      const key = (e.message || '').slice(0, 120);
      topErrors[key] = (topErrors[key] || 0) + 1;
    });
    const top10Errors = Object.entries(topErrors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([msg, count]) => ({ message: msg, count }));

    const loggers = {};
    entries.forEach(e => {
      if (e.logger) loggers[e.logger] = (loggers[e.logger] || 0) + 1;
    });
    const topLoggers = Object.entries(loggers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const workerSummary = Object.values(workers).map(w => ({
      pid: w.pid,
      source: w.source,
      duration: w.duration,
      errorCount: w.errorCount,
      criticalCount: w.criticalCount
    })).slice(0, 20);

    let earliest = null, latest = null;
    entries.forEach(e => {
      if (!e.timestamp) return;
      const t = new Date(e.timestamp).getTime();
      if (!earliest || t < earliest) earliest = t;
      if (!latest || t > latest) latest = t;
    });

    return {
      totalEntries: entries.length,
      levelCounts,
      timeRange: {
        from: earliest ? new Date(earliest).toISOString() : null,
        to: latest ? new Date(latest).toISOString() : null,
        durationMinutes: (earliest && latest) ? Math.round((latest - earliest) / 60000) : null
      },
      topErrors: top10Errors,
      topLoggers,
      workers: workerSummary,
      sources: (state.sources || []).map(s => s.name)
    };
  }

  function buildSamples(state) {
    const entries = state.entries || [];

    // Prioritize critical/error lines, then a spread of others
    const critical = entries.filter(e => e.level === 'CRITICAL' || e.level === 'ERROR').slice(0, 100);
    const warnings = entries.filter(e => e.level === 'WARNING').slice(0, 50);
    const others   = entries.filter(e => e.level !== 'CRITICAL' && e.level !== 'ERROR' && e.level !== 'WARNING');

    // Evenly distributed sample from the rest
    const step = Math.max(1, Math.floor(others.length / 100));
    const spread = others.filter((_, i) => i % step === 0).slice(0, 100);

    const combined = [...critical, ...warnings, ...spread]
      .sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return new Date(a.timestamp) - new Date(b.timestamp);
      })
      .slice(0, MAX_SAMPLE_LINES);

    return combined.map(e =>
      `[${e.timestamp || '?'}] [${e.level || '?'}] [${e.logger || '?'}] ${e.message || ''}`
    ).join('\n');
  }

  function scoreColor(score) {
    if (score >= 80) return 'var(--success, #22c55e)';
    if (score >= 50) return 'var(--warning, #f59e0b)';
    return 'var(--error, #ef4444)';
  }

  function impactClass(impact) {
    if (impact === 'CRITIQUE') return 'ai-badge-critical';
    if (impact === 'MAJEUR') return 'ai-badge-major';
    return 'ai-badge-minor';
  }

  function priorityClass(p) {
    if (p === 'HAUTE') return 'ai-badge-critical';
    if (p === 'MOYENNE') return 'ai-badge-major';
    return 'ai-badge-minor';
  }

  function levelClass(l) {
    if (l === 'CRITICAL') return 'ai-badge-critical';
    if (l === 'ERROR') return 'ai-badge-major';
    if (l === 'WARNING') return 'ai-badge-minor';
    return 'ai-badge-info';
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderReport(report, container) {
    const score = Number(report.score_sante) || 0;

    const incidentsHtml = (report.incidents_critiques || []).map(inc => `
      <div class="ai-incident-card">
        <div class="ai-incident-header">
          <span class="ai-incident-title">${esc(inc.titre)}</span>
          <span class="ai-badge ${impactClass(inc.impact)}">${esc(inc.impact)}</span>
        </div>
        ${inc.timestamp ? `<div class="ai-incident-ts">${esc(inc.timestamp)}</div>` : ''}
        <div class="ai-incident-desc">${esc(inc.description)}</div>
        <div class="ai-incident-reco">
          <strong>Action :</strong> ${esc(inc.recommandation)}
        </div>
      </div>
    `).join('') || '<div class="ai-empty">Aucun incident critique détecté.</div>';

    const observations = (report.analyse_performances?.observations || []).map(o => `<li>${esc(o)}</li>`).join('');
    const goulots = (report.analyse_performances?.goulots || []).map(g => `<li>${esc(g)}</li>`).join('');

    const tendancesHtml = (report.tendances || []).map(t => `<li>${esc(t)}</li>`).join('');

    const recoHtml = (report.recommandations || []).map(r => `
      <div class="ai-reco-card">
        <div class="ai-reco-header">
          <span class="ai-badge ${priorityClass(r.priorite)}">${esc(r.priorite)}</span>
          <span class="ai-reco-action">${esc(r.action)}</span>
        </div>
        <div class="ai-reco-detail">${esc(r.detail)}</div>
      </div>
    `).join('') || '<div class="ai-empty">Aucune recommandation.</div>';

    const chronoHtml = (report.chronologie || []).map(c => `
      <div class="ai-chrono-row">
        <div class="ai-chrono-time">${esc(c.moment)}</div>
        <div class="ai-chrono-dot ${levelClass(c.niveau)}"></div>
        <div class="ai-chrono-event">${esc(c.evenement)}</div>
      </div>
    `).join('') || '<div class="ai-empty">Aucun événement chronologique.</div>';

    container.innerHTML = `
      <div class="ai-report-result">

        <!-- Score + Résumé -->
        <div class="ai-section ai-summary-section">
          <div class="ai-score-ring" style="--score-color:${scoreColor(score)}">
            <svg viewBox="0 0 44 44" width="80" height="80">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--bg-2, #1a1f2e)" stroke-width="4"/>
              <circle cx="22" cy="22" r="18" fill="none" stroke="${scoreColor(score)}" stroke-width="4"
                stroke-dasharray="${(score / 100 * 113.1).toFixed(1)} 113.1"
                stroke-dashoffset="28.3" stroke-linecap="round" transform="rotate(-90 22 22)"/>
            </svg>
            <div class="ai-score-value" style="color:${scoreColor(score)}">${score}</div>
          </div>
          <div class="ai-summary-text">
            <h3 class="ai-section-title">Résumé exécutif</h3>
            <p class="ai-summary-content">${esc(report.resume_executif)}</p>
          </div>
        </div>

        <!-- Incidents critiques -->
        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Incidents critiques
          </h3>
          <div class="ai-incidents-list">${incidentsHtml}</div>
        </div>

        <!-- Analyse des performances -->
        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Analyse des performances
          </h3>
          ${report.analyse_performances?.workers ? `<div class="ai-perf-workers">${esc(report.analyse_performances.workers)}</div>` : ''}
          ${observations ? `<div class="ai-perf-block"><h4>Observations</h4><ul class="ai-list">${observations}</ul></div>` : ''}
          ${goulots ? `<div class="ai-perf-block"><h4>Goulots d'étranglement</h4><ul class="ai-list">${goulots}</ul></div>` : ''}
        </div>

        <!-- Tendances -->
        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Tendances observées
          </h3>
          <ul class="ai-list">${tendancesHtml || '<li>Aucune tendance identifiée.</li>'}</ul>
        </div>

        <!-- Recommandations -->
        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Recommandations
          </h3>
          <div class="ai-recos-list">${recoHtml}</div>
        </div>

        <!-- Chronologie -->
        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Chronologie des événements
          </h3>
          <div class="ai-chrono">${chronoHtml}</div>
        </div>

      </div>
    `;
  }

  function init() {
    const generateBtn  = document.getElementById('aiGenerateBtn');
    const hintEl       = document.getElementById('aiReportHint');
    const loadingEl    = document.getElementById('aiReportLoading');
    const errorEl      = document.getElementById('aiReportError');
    const contentEl    = document.getElementById('aiReportContent');

    if (!generateBtn) return;

    generateBtn.addEventListener('click', async () => {
      const state = LogScope.state;
      if (!state || !state.entries || state.entries.length === 0) {
        hintEl.textContent = 'Chargez un fichier de logs avant de générer le rapport.';
        hintEl.style.color = 'var(--error, #ef4444)';
        return;
      }

      generateBtn.disabled = true;
      hintEl.style.display = 'none';
      errorEl.hidden = true;
      contentEl.hidden = true;
      loadingEl.hidden = false;

      try {
        const stats   = buildStats(state);
        const samples = buildSamples(state);

        const res = await window.LogScope.authenticatedFetch(`${API}/ai/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stats, samples, filename: state.fileName || 'inconnu' })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

        renderReport(data.report, contentEl);
        contentEl.hidden = false;
      } catch (err) {
        errorEl.textContent = 'Erreur lors de l\'analyse : ' + err.message;
        errorEl.hidden = false;
      } finally {
        loadingEl.hidden = true;
        generateBtn.disabled = false;
        hintEl.style.display = '';
        hintEl.style.color = '';
        hintEl.textContent = 'Rapport généré par Claude Opus';
      }
    });

    // Update hint when logs are loaded
    const origUpdate = LogScope.updateTabsAfterLoad;
    LogScope.updateTabsAfterLoad = function (...args) {
      if (origUpdate) origUpdate.apply(this, args);
      const state = LogScope.state;
      if (state && state.entries && state.entries.length > 0) {
        hintEl.textContent = `${state.entries.length.toLocaleString('fr-FR')} entrées prêtes pour l'analyse IA`;
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
