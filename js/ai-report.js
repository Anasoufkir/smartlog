/**
 * LogScope — Rapport IA (analyse Claude Opus) + export PDF
 */
(function () {
  const API = 'http://localhost:3000';
  const MAX_SAMPLE_LINES = 300;

  let _currentReport = null;
  let _currentFilename = '';

  // ── Stats / samples builders ────────────────────────────────────────────────

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
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    const loggers = {};
    entries.forEach(e => { if (e.logger) loggers[e.logger] = (loggers[e.logger] || 0) + 1; });
    const topLoggers = Object.entries(loggers)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const workerSummary = Object.values(workers).map(w => ({
      pid: w.pid, source: w.source, duration: w.duration,
      errorCount: w.errorCount, criticalCount: w.criticalCount
    })).slice(0, 20);

    let earliest = null, latest = null;
    entries.forEach(e => {
      if (!e.timestamp) return;
      const t = new Date(e.timestamp).getTime();
      if (!earliest || t < earliest) earliest = t;
      if (!latest || t > latest) latest = t;
    });

    return {
      totalEntries: entries.length, levelCounts,
      timeRange: {
        from: earliest ? new Date(earliest).toISOString() : null,
        to:   latest   ? new Date(latest).toISOString()   : null,
        durationMinutes: (earliest && latest) ? Math.round((latest - earliest) / 60000) : null
      },
      topErrors: top10Errors, topLoggers,
      workers: workerSummary,
      sources: (state.sources || []).map(s => s.name)
    };
  }

  function buildSamples(state) {
    const entries = state.entries || [];
    const critical = entries.filter(e => e.level === 'CRITICAL' || e.level === 'ERROR').slice(0, 100);
    const warnings = entries.filter(e => e.level === 'WARNING').slice(0, 50);
    const others   = entries.filter(e => e.level !== 'CRITICAL' && e.level !== 'ERROR' && e.level !== 'WARNING');
    const step = Math.max(1, Math.floor(others.length / 100));
    const spread = others.filter((_, i) => i % step === 0).slice(0, 100);
    const combined = [...critical, ...warnings, ...spread]
      .sort((a, b) => { if (!a.timestamp || !b.timestamp) return 0; return new Date(a.timestamp) - new Date(b.timestamp); })
      .slice(0, MAX_SAMPLE_LINES);
    return combined.map(e => `[${e.timestamp || '?'}] [${e.level || '?'}] [${e.logger || '?'}] ${e.message || ''}`).join('\n');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function scoreColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function impactClass(impact) {
    if (impact === 'CRITIQUE') return 'ai-badge-critical';
    if (impact === 'MAJEUR')   return 'ai-badge-major';
    return 'ai-badge-minor';
  }

  function priorityClass(p) {
    if (p === 'HAUTE')   return 'ai-badge-critical';
    if (p === 'MOYENNE') return 'ai-badge-major';
    return 'ai-badge-minor';
  }

  function levelClass(l) {
    if (l === 'CRITICAL') return 'ai-badge-critical';
    if (l === 'ERROR')    return 'ai-badge-major';
    if (l === 'WARNING')  return 'ai-badge-minor';
    return 'ai-badge-info';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── App render (dark UI) ────────────────────────────────────────────────────

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
        <div class="ai-incident-reco"><strong>Action :</strong> ${esc(inc.recommandation)}</div>
      </div>
    `).join('') || '<div class="ai-empty">Aucun incident critique détecté.</div>';

    const observations = (report.analyse_performances?.observations || []).map(o => `<li>${esc(o)}</li>`).join('');
    const goulots      = (report.analyse_performances?.goulots      || []).map(g => `<li>${esc(g)}</li>`).join('');
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

        <div class="ai-report-toolbar">
          <button class="btn btn-secondary ai-pdf-btn" id="aiPdfBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Télécharger en PDF
          </button>
        </div>

        <div class="ai-section ai-summary-section">
          <div class="ai-score-ring" style="--score-color:${scoreColor(score)}">
            <svg viewBox="0 0 44 44" width="80" height="80">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--bg-2,#1a1f2e)" stroke-width="4"/>
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

        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Incidents critiques
          </h3>
          <div class="ai-incidents-list">${incidentsHtml}</div>
        </div>

        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Analyse des performances
          </h3>
          ${report.analyse_performances?.workers ? `<div class="ai-perf-workers">${esc(report.analyse_performances.workers)}</div>` : ''}
          ${observations ? `<div class="ai-perf-block"><h4>Observations</h4><ul class="ai-list">${observations}</ul></div>` : ''}
          ${goulots ? `<div class="ai-perf-block"><h4>Goulots d'étranglement</h4><ul class="ai-list">${goulots}</ul></div>` : ''}
        </div>

        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Tendances observées
          </h3>
          <ul class="ai-list">${tendancesHtml || '<li>Aucune tendance identifiée.</li>'}</ul>
        </div>

        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Recommandations
          </h3>
          <div class="ai-recos-list">${recoHtml}</div>
        </div>

        <div class="ai-section">
          <h3 class="ai-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Chronologie des événements
          </h3>
          <div class="ai-chrono">${chronoHtml}</div>
        </div>

      </div>
    `;

    document.getElementById('aiPdfBtn').addEventListener('click', () => downloadPdf(report, _currentFilename));
  }

  // ── PDF export ──────────────────────────────────────────────────────────────

  function downloadPdf(report, filename) {
    const score     = Number(report.score_sante) || 0;
    const scoreClr  = scoreColor(score);
    const genDate   = new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    function badge(label, type) {
      const colors = {
        critical: { bg: '#fff0f0', color: '#c0392b', border: '#f5c6cb' },
        major:    { bg: '#fff8ec', color: '#b45309', border: '#fde68a' },
        minor:    { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
        info:     { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
      };
      const c = colors[type] || colors.info;
      return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${c.bg};color:${c.color};border:1px solid ${c.border}">${escPdf(label)}</span>`;
    }

    function escPdf(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function sectionTitle(title) {
      return `<h2 style="font-size:14px;font-weight:700;color:#1a202c;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:8px">${escPdf(title)}</h2>`;
    }

    // Incidents
    const incidentsPdf = (report.incidents_critiques || []).map(inc => {
      const type = inc.impact === 'CRITIQUE' ? 'critical' : inc.impact === 'MAJEUR' ? 'major' : 'minor';
      const borderClr = type === 'critical' ? '#c0392b' : type === 'major' ? '#b45309' : '#166534';
      return `
        <div style="margin-bottom:12px;padding:14px 16px;background:#fafafa;border:1px solid #e2e8f0;border-left:4px solid ${borderClr};border-radius:6px;page-break-inside:avoid">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px">
            <span style="font-weight:700;font-size:13px;color:#1a202c">${escPdf(inc.titre)}</span>
            ${badge(inc.impact, type)}
          </div>
          ${inc.timestamp ? `<div style="font-size:10px;color:#718096;font-family:monospace;margin-bottom:6px">${escPdf(inc.timestamp)}</div>` : ''}
          <p style="font-size:12px;color:#4a5568;line-height:1.6;margin:0 0 10px">${escPdf(inc.description)}</p>
          <div style="font-size:12px;color:#1d4ed8;background:#eff6ff;padding:8px 12px;border-radius:4px"><strong>Action :</strong> ${escPdf(inc.recommandation)}</div>
        </div>`;
    }).join('') || '<p style="color:#718096;font-size:12px">Aucun incident critique détecté.</p>';

    // Performances
    const observHtml = (report.analyse_performances?.observations || []).map(o => `<li style="margin-bottom:5px">${escPdf(o)}</li>`).join('');
    const goulotHtml = (report.analyse_performances?.goulots || []).map(g => `<li style="margin-bottom:5px">${escPdf(g)}</li>`).join('');

    // Tendances
    const tendHtml = (report.tendances || []).map(t => `<li style="margin-bottom:5px">${escPdf(t)}</li>`).join('') || '<li>Aucune tendance identifiée.</li>';

    // Recommandations
    const recoPdf = (report.recommandations || []).map(r => {
      const type = r.priorite === 'HAUTE' ? 'critical' : r.priorite === 'MOYENNE' ? 'major' : 'minor';
      return `
        <div style="margin-bottom:10px;padding:12px 14px;background:#fafafa;border:1px solid #e2e8f0;border-radius:6px;page-break-inside:avoid">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            ${badge(r.priorite, type)}
            <span style="font-weight:600;font-size:13px;color:#1a202c">${escPdf(r.action)}</span>
          </div>
          <p style="font-size:12px;color:#4a5568;margin:0;line-height:1.6">${escPdf(r.detail)}</p>
        </div>`;
    }).join('') || '<p style="color:#718096;font-size:12px">Aucune recommandation.</p>';

    // Chronologie
    const chronoPdf = (report.chronologie || []).map(c => {
      const type = c.niveau === 'CRITICAL' ? 'critical' : c.niveau === 'ERROR' ? 'major' : c.niveau === 'WARNING' ? 'minor' : 'info';
      const dotClr = { critical: '#c0392b', major: '#b45309', minor: '#d97706', info: '#1d4ed8' }[type];
      return `
        <div style="display:grid;grid-template-columns:130px 12px 1fr;gap:12px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f0f0f0">
          <div style="font-size:10px;font-family:monospace;color:#718096;text-align:right;padding-top:2px;word-break:break-all">${escPdf(c.moment)}</div>
          <div style="width:10px;height:10px;border-radius:50%;background:${dotClr};margin-top:3px;flex-shrink:0"></div>
          <div style="font-size:12px;color:#2d3748;line-height:1.5">${escPdf(c.evenement)}</div>
        </div>`;
    }).join('') || '<p style="color:#718096;font-size:12px">Aucun événement.</p>';

    // Score ring SVG
    const dash = (score / 100 * 113.1).toFixed(1);
    const scoreSvg = `
      <svg viewBox="0 0 44 44" width="70" height="70" style="flex-shrink:0">
        <circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" stroke-width="4"/>
        <circle cx="22" cy="22" r="18" fill="none" stroke="${scoreClr}" stroke-width="4"
          stroke-dasharray="${dash} 113.1" stroke-dashoffset="28.3"
          stroke-linecap="round" transform="rotate(-90 22 22)"/>
        <text x="22" y="27" text-anchor="middle" font-size="11" font-weight="800" fill="${scoreClr}" font-family="system-ui">${score}</text>
      </svg>`;

    const listStyle = 'margin:0;padding:0 0 0 16px;font-size:12px;color:#4a5568;line-height:1.7';

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Rapport IA LogScope — ${escPdf(filename)}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Arial,sans-serif; color:#1a202c; background:#fff; font-size:13px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page { margin:18mm 16mm; size:A4; }
    @media print {
      .no-print { display:none !important; }
      body { font-size:12px; }
    }
    .page { max-width:820px; margin:0 auto; padding:24px; }
    h1 { font-size:22px; font-weight:800; color:#1a202c; }
    h2 { font-size:15px; }
    p  { line-height:1.6; }
    ul { line-height:1.7; }
    .section { margin-bottom:28px; padding:18px 20px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; page-break-inside:avoid; }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:18px;border-bottom:3px solid #1a202c">
    <div>
      <h1>Log<span style="color:#f59e0b">Scope</span> — Rapport IA</h1>
      <div style="margin-top:6px;font-size:12px;color:#718096">Analyse par Claude Opus · Généré le ${genDate}</div>
      <div style="margin-top:4px;font-size:12px;color:#4a5568;font-weight:600">Fichier : ${escPdf(filename)}</div>
    </div>
    <div style="text-align:center">
      ${scoreSvg}
      <div style="font-size:10px;color:#718096;margin-top:2px">Score santé</div>
    </div>
  </div>

  <!-- Résumé exécutif -->
  <div class="section" style="background:#f8fafc;border-left:4px solid ${scoreClr}">
    ${sectionTitle('Résumé exécutif')}
    <p style="font-size:13px;color:#2d3748;line-height:1.7">${escPdf(report.resume_executif)}</p>
  </div>

  <!-- Incidents critiques -->
  <div class="section" style="page-break-before:auto">
    ${sectionTitle('Incidents critiques')}
    ${incidentsPdf}
  </div>

  <!-- Analyse des performances -->
  <div class="section">
    ${sectionTitle('Analyse des performances')}
    ${report.analyse_performances?.workers ? `<p style="font-size:12px;color:#4a5568;margin-bottom:14px;padding:10px 14px;background:#f7fafc;border-radius:4px">${escPdf(report.analyse_performances.workers)}</p>` : ''}
    ${observHtml ? `<h3 style="font-size:12px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Observations</h3><ul style="${listStyle}">${observHtml}</ul>` : ''}
    ${goulotHtml ? `<h3 style="font-size:12px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px">Goulots d'étranglement</h3><ul style="${listStyle}">${goulotHtml}</ul>` : ''}
  </div>

  <!-- Tendances -->
  <div class="section">
    ${sectionTitle('Tendances observées')}
    <ul style="${listStyle}">${tendHtml}</ul>
  </div>

  <!-- Recommandations -->
  <div class="section" style="page-break-before:auto">
    ${sectionTitle('Recommandations')}
    ${recoPdf}
  </div>

  <!-- Chronologie -->
  <div class="section">
    ${sectionTitle('Chronologie des événements')}
    <div style="position:relative">${chronoPdf}</div>
  </div>

  <!-- Footer -->
  <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#a0aec0">
    Rapport généré par LogScope — Analyse IA powered by Anthropic Claude Opus · ${genDate}
  </div>

  <!-- Print button (hidden in PDF) -->
  <div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 28px;background:#1a202c;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">
      Imprimer / Enregistrer en PDF
    </button>
  </div>

</div>
<script>setTimeout(()=>window.print(),400);<\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Autorisez les popups pour télécharger le PDF.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    const generateBtn = document.getElementById('aiGenerateBtn');
    const hintEl      = document.getElementById('aiReportHint');
    const loadingEl   = document.getElementById('aiReportLoading');
    const errorEl     = document.getElementById('aiReportError');
    const contentEl   = document.getElementById('aiReportContent');

    if (!generateBtn) return;

    generateBtn.addEventListener('click', async () => {
      const state = LogScope.state;
      if (!state || !state.entries || state.entries.length === 0) {
        hintEl.textContent = 'Chargez un fichier de logs avant de générer le rapport.';
        hintEl.style.color = 'var(--error,#ef4444)';
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
        _currentFilename = state.fileName || 'inconnu';

        const res = await window.LogScope.authenticatedFetch(`${API}/ai/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stats, samples, filename: _currentFilename })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

        _currentReport = data.report;
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
