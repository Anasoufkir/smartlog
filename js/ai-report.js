/**
 * LogScope — Rapport IA (analyse Claude Opus) + export PDF
 */
(function () {
  const API = 'http://localhost:3000';
  const MAX_SAMPLE_LINES = 300;

  let _currentReport  = null;
  let _currentFilename = '';

  // ── Stats / samples builders ─────────────────────────────────────────────────

  function buildStats(state) {
    const entries     = state.entries || [];
    const levelCounts = state.levelCounts || {};
    const workers     = state.workers || {};

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
      if (!latest   || t > latest)   latest   = t;
    });

    return {
      totalEntries: entries.length, levelCounts,
      timeRange: {
        from: earliest ? new Date(earliest).toISOString() : null,
        to:   latest   ? new Date(latest).toISOString()   : null,
        durationMinutes: (earliest && latest) ? Math.round((latest - earliest) / 60000) : null
      },
      topErrors: top10Errors, topLoggers, workers: workerSummary,
      sources: (state.sources || []).map(s => s.name)
    };
  }

  function buildSamples(state) {
    const entries  = state.entries || [];
    const critical = entries.filter(e => e.level === 'CRITICAL' || e.level === 'ERROR').slice(0, 100);
    const warnings = entries.filter(e => e.level === 'WARNING').slice(0, 50);
    const others   = entries.filter(e => e.level !== 'CRITICAL' && e.level !== 'ERROR' && e.level !== 'WARNING');
    const step     = Math.max(1, Math.floor(others.length / 100));
    const spread   = others.filter((_, i) => i % step === 0).slice(0, 100);
    return [...critical, ...warnings, ...spread]
      .sort((a, b) => { if (!a.timestamp || !b.timestamp) return 0; return new Date(a.timestamp) - new Date(b.timestamp); })
      .slice(0, MAX_SAMPLE_LINES)
      .map(e => `[${e.timestamp || '?'}] [${e.level || '?'}] [${e.logger || '?'}] ${e.message || ''}`)
      .join('\n');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function scoreColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function scoreLabel(score) {
    if (score === 100) return { text: 'Système parfait', sub: 'Aucune anomalie détectée' };
    if (score >= 80)   return { text: 'Système sain',    sub: 'Quelques warnings sans gravité' };
    if (score >= 50)   return { text: 'Attention requise', sub: 'Problèmes détectés nécessitant une intervention' };
    return               { text: 'État critique', sub: 'Incidents graves — intervention immédiate recommandée' };
  }

  function impactType(impact) {
    if (impact === 'CRITIQUE') return 'critical';
    if (impact === 'MAJEUR')   return 'major';
    return 'minor';
  }

  function priorityType(p) {
    if (p === 'HAUTE')   return 'critical';
    if (p === 'MOYENNE') return 'major';
    return 'minor';
  }

  function levelType(l) {
    if (l === 'CRITICAL') return 'critical';
    if (l === 'ERROR')    return 'major';
    if (l === 'WARNING')  return 'minor';
    return 'info';
  }

  // ── App render (dark theme) ──────────────────────────────────────────────────

  function badge(label, type) {
    return `<span class="ai-badge ai-badge-${type}">${esc(label)}</span>`;
  }

  function renderReport(report, container, stats) {
    const score  = Number(report.score_sante) || 0;
    const clr    = scoreColor(score);
    const lbl    = scoreLabel(score);
    const dash   = (score / 100 * 113.1).toFixed(1);
    const lc     = stats?.levelCounts || {};

    // ── Score + légende ──
    const scoreLegendHtml = `
      <div class="ai-section ai-score-section">

        <div class="ai-score-main">
          <div class="ai-score-ring-wrap">
            <svg viewBox="0 0 44 44" width="96" height="96">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface)" stroke-width="5"/>
              <circle cx="22" cy="22" r="18" fill="none" stroke="${clr}" stroke-width="5"
                stroke-dasharray="${dash} 113.1" stroke-dashoffset="28.3"
                stroke-linecap="round" transform="rotate(-90 22 22)"/>
            </svg>
            <div class="ai-score-num" style="color:${clr}">${score}<span class="ai-score-max">/100</span></div>
          </div>

          <div class="ai-score-info">
            <div class="ai-score-verdict" style="color:${clr}">${esc(lbl.text)}</div>
            <div class="ai-score-sub">${esc(lbl.sub)}</div>
            <p class="ai-score-desc">
              Calculé par Claude Opus en analysant la proportion d'erreurs, la fréquence des incidents,
              l'état des workers et la gravité des anomalies détectées dans le fichier.
            </p>
          </div>
        </div>

        <div class="ai-score-legend">
          <div class="ai-legend-title">Interprétation du score</div>
          <div class="ai-legend-grid">
            <div class="ai-legend-row ${score === 100 ? 'ai-legend-active' : ''}">
              <div class="ai-legend-dot" style="background:#22c55e"></div>
              <div class="ai-legend-range">100</div>
              <div class="ai-legend-desc">Système parfait — aucune anomalie</div>
            </div>
            <div class="ai-legend-row ${score >= 80 && score < 100 ? 'ai-legend-active' : ''}">
              <div class="ai-legend-dot" style="background:#4ade80"></div>
              <div class="ai-legend-range">80 – 99</div>
              <div class="ai-legend-desc">Système sain — quelques warnings sans gravité</div>
            </div>
            <div class="ai-legend-row ${score >= 50 && score < 80 ? 'ai-legend-active' : ''}">
              <div class="ai-legend-dot" style="background:#f59e0b"></div>
              <div class="ai-legend-range">50 – 79</div>
              <div class="ai-legend-desc">Problèmes détectés — attention requise</div>
            </div>
            <div class="ai-legend-row ${score < 50 ? 'ai-legend-active' : ''}">
              <div class="ai-legend-dot" style="background:#ef4444"></div>
              <div class="ai-legend-range">0 – 49</div>
              <div class="ai-legend-desc">État critique — incidents graves, intervention immédiate</div>
            </div>
          </div>
        </div>

      </div>`;

    // ── Barre de stats rapides ──
    const statsBarHtml = `
      <div class="ai-stats-bar">
        <div class="ai-stat-pill ai-stat-total">
          <div class="ai-stat-pill-val">${(stats?.totalEntries || 0).toLocaleString('fr-FR')}</div>
          <div class="ai-stat-pill-lbl">Lignes analysées</div>
        </div>
        <div class="ai-stat-pill ai-stat-critical">
          <div class="ai-stat-pill-val">${lc.CRITICAL || 0}</div>
          <div class="ai-stat-pill-lbl">CRITICAL</div>
        </div>
        <div class="ai-stat-pill ai-stat-error">
          <div class="ai-stat-pill-val">${lc.ERROR || 0}</div>
          <div class="ai-stat-pill-lbl">ERROR</div>
        </div>
        <div class="ai-stat-pill ai-stat-warning">
          <div class="ai-stat-pill-val">${lc.WARNING || 0}</div>
          <div class="ai-stat-pill-lbl">WARNING</div>
        </div>
        <div class="ai-stat-pill ai-stat-info">
          <div class="ai-stat-pill-val">${lc.INFO || 0}</div>
          <div class="ai-stat-pill-lbl">INFO</div>
        </div>
      </div>`;

    // ── Résumé ──
    const resumeHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Résumé exécutif
        </h3>
        <p class="ai-resume-text">${esc(report.resume_executif)}</p>
      </div>`;

    // ── Incidents ──
    const incidentsHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Incidents critiques
          <span class="ai-section-count">${(report.incidents_critiques || []).length}</span>
        </h3>
        <div class="ai-incidents-list">
          ${(report.incidents_critiques || []).length === 0
            ? '<div class="ai-empty">Aucun incident critique détecté.</div>'
            : (report.incidents_critiques || []).map((inc, i) => `
              <div class="ai-incident-card ai-incident-${impactType(inc.impact)}">
                <div class="ai-incident-num">${String(i + 1).padStart(2, '0')}</div>
                <div class="ai-incident-body">
                  <div class="ai-incident-header">
                    <span class="ai-incident-title">${esc(inc.titre)}</span>
                    ${badge(inc.impact, impactType(inc.impact))}
                  </div>
                  ${inc.timestamp ? `<div class="ai-incident-ts">${esc(inc.timestamp)}</div>` : ''}
                  <div class="ai-incident-desc">${esc(inc.description)}</div>
                  <div class="ai-incident-reco">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
                    <strong>Action recommandée :</strong> ${esc(inc.recommandation)}
                  </div>
                </div>
              </div>`).join('')}
        </div>
      </div>`;

    // ── Performances ──
    const observations = (report.analyse_performances?.observations || []).map(o => `<li>${esc(o)}</li>`).join('');
    const goulots      = (report.analyse_performances?.goulots      || []).map(g => `<li>${esc(g)}</li>`).join('');
    const perfHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Analyse des performances
        </h3>
        ${report.analyse_performances?.workers ? `<div class="ai-perf-workers">${esc(report.analyse_performances.workers)}</div>` : ''}
        <div class="ai-perf-cols">
          ${observations ? `<div class="ai-perf-block"><h4 class="ai-perf-label">Observations</h4><ul class="ai-list">${observations}</ul></div>` : ''}
          ${goulots      ? `<div class="ai-perf-block"><h4 class="ai-perf-label">Goulots d'étranglement</h4><ul class="ai-list ai-list-warn">${goulots}</ul></div>` : ''}
        </div>
      </div>`;

    // ── Tendances ──
    const tendancesHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          Tendances observées
        </h3>
        <ul class="ai-list">
          ${(report.tendances || []).map(t => `<li>${esc(t)}</li>`).join('') || '<li>Aucune tendance identifiée.</li>'}
        </ul>
      </div>`;

    // ── Recommandations ──
    const recosHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Recommandations
          <span class="ai-section-count">${(report.recommandations || []).length}</span>
        </h3>
        <div class="ai-recos-list">
          ${(report.recommandations || []).length === 0
            ? '<div class="ai-empty">Aucune recommandation.</div>'
            : (report.recommandations || []).map((r, i) => `
              <div class="ai-reco-card">
                <div class="ai-reco-num">${String(i + 1).padStart(2, '0')}</div>
                <div class="ai-reco-body">
                  <div class="ai-reco-header">
                    ${badge(r.priorite, priorityType(r.priorite))}
                    <span class="ai-reco-action">${esc(r.action)}</span>
                  </div>
                  <div class="ai-reco-detail">${esc(r.detail)}</div>
                </div>
              </div>`).join('')}
        </div>
      </div>`;

    // ── Chronologie ──
    const chronoHtml = `
      <div class="ai-section">
        <h3 class="ai-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Chronologie des événements
        </h3>
        <div class="ai-chrono">
          ${(report.chronologie || []).length === 0
            ? '<div class="ai-empty">Aucun événement.</div>'
            : (report.chronologie || []).map(c => `
              <div class="ai-chrono-row">
                <div class="ai-chrono-time">${esc(c.moment)}</div>
                <div class="ai-chrono-line">
                  <div class="ai-chrono-dot ai-chrono-dot-${levelType(c.niveau)}"></div>
                </div>
                <div class="ai-chrono-event">${esc(c.evenement)}</div>
              </div>`).join('')}
        </div>
      </div>`;

    container.innerHTML = `
      <div class="ai-report-result">
        <div class="ai-report-toolbar">
          <div class="ai-report-meta">Fichier : <strong>${esc(_currentFilename)}</strong></div>
          <button class="btn ai-pdf-btn" id="aiPdfBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Exporter en PDF
          </button>
        </div>
        ${scoreLegendHtml}
        ${statsBarHtml}
        ${resumeHtml}
        ${incidentsHtml}
        ${perfHtml}
        ${tendancesHtml}
        ${recosHtml}
        ${chronoHtml}
      </div>`;

    document.getElementById('aiPdfBtn').addEventListener('click', () => downloadPdf(report, _currentFilename, stats));
  }

  // ── PDF export ───────────────────────────────────────────────────────────────

  function downloadPdf(report, filename, stats) {
    const score   = Number(report.score_sante) || 0;
    const clr     = scoreColor(score);
    const lbl     = scoreLabel(score);
    const dash    = (score / 100 * 113.1).toFixed(1);
    const lc      = stats?.levelCounts || {};
    const genDate = new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    function escP(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    const BADGE_STYLES = {
      critical: 'background:#fff0f0;color:#c0392b;border:1px solid #f5c6cb',
      major:    'background:#fff8ec;color:#92400e;border:1px solid #fde68a',
      minor:    'background:#f0fdf4;color:#166534;border:1px solid #bbf7d0',
      info:     'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe'
    };
    const DOT_COLORS = { critical:'#c0392b', major:'#d97706', minor:'#16a34a', info:'#2563eb' };

    function pBadge(label, type) {
      return `<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;${BADGE_STYLES[type]||BADGE_STYLES.info}">${escP(label)}</span>`;
    }

    // Score ring SVG
    const scoreSvg = `<svg viewBox="0 0 44 44" width="80" height="80">
      <circle cx="22" cy="22" r="18" fill="none" stroke="#e8ecf0" stroke-width="5"/>
      <circle cx="22" cy="22" r="18" fill="none" stroke="${clr}" stroke-width="5"
        stroke-dasharray="${dash} 113.1" stroke-dashoffset="28.3" stroke-linecap="round" transform="rotate(-90 22 22)"/>
      <text x="22" y="25" text-anchor="middle" font-size="12" font-weight="800" fill="${clr}" font-family="system-ui,sans-serif">${score}</text>
      <text x="22" y="33" text-anchor="middle" font-size="7" fill="#94a3b8" font-family="system-ui,sans-serif">/100</text>
    </svg>`;

    // Incidents
    const incidentsPdf = (report.incidents_critiques || []).map((inc, i) => {
      const t = impactType(inc.impact);
      const borderClr = DOT_COLORS[t];
      return `<div style="margin-bottom:14px;padding:14px 16px;background:#fafafa;border:1px solid #e2e8f0;border-left:4px solid ${borderClr};border-radius:6px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;font-family:monospace">#${String(i+1).padStart(2,'0')}</span>
            <span style="font-weight:700;font-size:13px;color:#1a202c">${escP(inc.titre)}</span>
          </div>
          ${pBadge(inc.impact, t)}
        </div>
        ${inc.timestamp ? `<div style="font-size:10px;color:#94a3b8;font-family:monospace;margin-bottom:8px">${escP(inc.timestamp)}</div>` : ''}
        <p style="font-size:12px;color:#475569;line-height:1.65;margin:0 0 10px">${escP(inc.description)}</p>
        <div style="font-size:12px;color:#1d4ed8;background:#eff6ff;padding:8px 12px;border-radius:5px;border:1px solid #bfdbfe">
          <strong>Action recommandée :</strong> ${escP(inc.recommandation)}
        </div>
      </div>`;
    }).join('') || '<p style="color:#94a3b8;font-size:12px">Aucun incident critique détecté.</p>';

    // Perf
    const observHtml = (report.analyse_performances?.observations || []).map(o => `<li style="margin-bottom:5px">${escP(o)}</li>`).join('');
    const goulotHtml = (report.analyse_performances?.goulots || []).map(g => `<li style="margin-bottom:5px;color:#92400e">${escP(g)}</li>`).join('');

    // Tendances
    const tendHtml = (report.tendances || []).map(t => `<li style="margin-bottom:5px">${escP(t)}</li>`).join('') || '<li>Aucune tendance identifiée.</li>';

    // Recos
    const recoPdf = (report.recommandations || []).map((r, i) => {
      const t = priorityType(r.priorite);
      return `<div style="margin-bottom:10px;padding:12px 14px;background:#fafafa;border:1px solid #e2e8f0;border-radius:6px;page-break-inside:avoid">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;font-family:monospace">#${String(i+1).padStart(2,'0')}</span>
          ${pBadge(r.priorite, t)}
          <span style="font-weight:600;font-size:13px;color:#1a202c">${escP(r.action)}</span>
        </div>
        <p style="font-size:12px;color:#475569;margin:0;line-height:1.65;padding-left:30px">${escP(r.detail)}</p>
      </div>`;
    }).join('') || '<p style="color:#94a3b8;font-size:12px">Aucune recommandation.</p>';

    // Chrono
    const chronoPdf = (report.chronologie || []).map(c => {
      const t = levelType(c.niveau);
      return `<div style="display:grid;grid-template-columns:120px 18px 1fr;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
        <div style="font-size:10px;font-family:monospace;color:#94a3b8;text-align:right;line-height:1.4">${escP(c.moment)}</div>
        <div style="width:10px;height:10px;border-radius:50%;background:${DOT_COLORS[t]};margin:0 auto"></div>
        <div style="font-size:12px;color:#334155;line-height:1.55">${escP(c.evenement)}</div>
      </div>`;
    }).join('') || '<p style="color:#94a3b8;font-size:12px">Aucun événement.</p>';

    function sec(title) {
      return `<h2 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 14px;padding-bottom:9px;border-bottom:2px solid #e2e8f0">${title}</h2>`;
    }

    const listStyle = 'margin:0;padding:0 0 0 18px;font-size:12px;color:#475569;line-height:1.7';

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>Rapport IA LogScope — ${escP(filename)}</title>
<style>
  * { box-sizing:border-box;margin:0;padding:0 }
  body { font-family:'Segoe UI',Arial,sans-serif;color:#1a202c;background:#fff;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact }
  @page { margin:16mm 15mm;size:A4 }
  @media print { .no-print{display:none!important} }
  .page { max-width:800px;margin:0 auto;padding:24px }
  .section { margin-bottom:24px;padding:18px 20px;border:1px solid #e2e8f0;border-radius:8px;page-break-inside:avoid }
</style>
</head>
<body>
<div class="page">

  <!-- ── HEADER ── -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #0f172a">
    <div>
      <div style="font-size:24px;font-weight:800;letter-spacing:-.5px">Log<span style="color:#f59e0b">Scope</span></div>
      <div style="font-size:13px;font-weight:600;color:#475569;margin-top:4px">Rapport d'analyse IA des logs</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:3px">Généré le ${genDate}</div>
      <div style="font-size:12px;color:#334155;margin-top:6px;font-weight:600">Fichier : ${escP(filename)}</div>
    </div>
    <div style="text-align:center">
      ${scoreSvg}
      <div style="font-size:10px;font-weight:700;color:${clr};margin-top:2px;text-transform:uppercase;letter-spacing:.04em">${escP(lbl.text)}</div>
    </div>
  </div>

  <!-- ── SCORE & LÉGENDE ── -->
  <div class="section" style="background:#f8fafc">
    ${sec('Score de santé & interprétation')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <div>
        <p style="font-size:12px;color:#475569;line-height:1.7;margin-bottom:12px">
          Le score de santé est un indicateur synthétique calculé par Claude Opus en analysant
          la proportion d'erreurs, la fréquence des incidents, l'état des workers et
          la gravité des anomalies détectées dans le fichier de logs.
        </p>
        <div style="padding:12px 14px;background:#fff;border-radius:6px;border:1px solid #e2e8f0">
          <div style="font-size:13px;font-weight:700;color:${clr};margin-bottom:3px">${escP(lbl.text)}</div>
          <div style="font-size:12px;color:#475569">${escP(lbl.sub)}</div>
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Grille d'interprétation</div>
        ${[
          { range:'100',    clr:'#16a34a', lbl:'Système parfait — aucune anomalie' },
          { range:'80 – 99',clr:'#22c55e', lbl:'Système sain — warnings mineurs' },
          { range:'50 – 79',clr:'#f59e0b', lbl:'Problèmes détectés — attention requise' },
          { range:'0 – 49', clr:'#ef4444', lbl:'État critique — intervention immédiate' }
        ].map(r => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9">
            <div style="width:10px;height:10px;border-radius:50%;background:${r.clr};flex-shrink:0"></div>
            <span style="font-size:11px;font-weight:700;color:#334155;min-width:48px">${r.range}</span>
            <span style="font-size:11px;color:#475569">${r.lbl}</span>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- ── STATS RAPIDES ── -->
  <div class="section" style="background:#fff">
    ${sec('Statistiques du fichier')}
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
      ${[
        { val:(stats?.totalEntries||0).toLocaleString('fr-FR'), lbl:'Lignes', clr:'#334155' },
        { val:lc.CRITICAL||0, lbl:'CRITICAL', clr:'#c0392b' },
        { val:lc.ERROR||0,    lbl:'ERROR',    clr:'#d97706' },
        { val:lc.WARNING||0,  lbl:'WARNING',  clr:'#ca8a04' },
        { val:lc.INFO||0,     lbl:'INFO',     clr:'#2563eb' }
      ].map(s => `
        <div style="text-align:center;padding:12px 8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
          <div style="font-size:20px;font-weight:800;color:${s.clr}">${s.val}</div>
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:3px">${s.lbl}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ── RÉSUMÉ ── -->
  <div class="section" style="border-left:4px solid ${clr}">
    ${sec('Résumé exécutif')}
    <p style="font-size:13px;color:#334155;line-height:1.75">${escP(report.resume_executif)}</p>
  </div>

  <!-- ── INCIDENTS ── -->
  <div class="section">
    ${sec(`Incidents critiques (${(report.incidents_critiques||[]).length})`)}
    ${incidentsPdf}
  </div>

  <!-- ── PERFORMANCES ── -->
  <div class="section">
    ${sec('Analyse des performances')}
    ${report.analyse_performances?.workers ? `<p style="font-size:12px;color:#475569;margin-bottom:14px;padding:10px 14px;background:#f8fafc;border-radius:5px">${escP(report.analyse_performances.workers)}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      ${observHtml ? `<div><h3 style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Observations</h3><ul style="${listStyle}">${observHtml}</ul></div>` : ''}
      ${goulotHtml ? `<div><h3 style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Goulots d'étranglement</h3><ul style="${listStyle}">${goulotHtml}</ul></div>` : ''}
    </div>
  </div>

  <!-- ── TENDANCES ── -->
  <div class="section">
    ${sec('Tendances observées')}
    <ul style="${listStyle}">${tendHtml}</ul>
  </div>

  <!-- ── RECOMMANDATIONS ── -->
  <div class="section">
    ${sec(`Recommandations (${(report.recommandations||[]).length})`)}
    ${recoPdf}
  </div>

  <!-- ── CHRONOLOGIE ── -->
  <div class="section">
    ${sec('Chronologie des événements')}
    ${chronoPdf}
  </div>

  <!-- ── FOOTER ── -->
  <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8">
    Rapport LogScope · Analyse IA powered by Anthropic Claude Opus · ${genDate}
  </div>

  <div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 28px;background:#0f172a;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">
      Imprimer / Enregistrer en PDF
    </button>
  </div>

</div>
<script>setTimeout(()=>window.print(),450);<\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Autorisez les popups pour télécharger le PDF.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

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
      errorEl.hidden  = true;
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
        renderReport(data.report, contentEl, stats);
        contentEl.hidden = false;
      } catch (err) {
        errorEl.textContent = 'Erreur lors de l\'analyse : ' + err.message;
        errorEl.hidden = false;
      } finally {
        loadingEl.hidden  = true;
        generateBtn.disabled = false;
        hintEl.style.display = '';
        hintEl.style.color   = '';
        hintEl.textContent   = 'Rapport généré par Claude Opus';
      }
    });

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
