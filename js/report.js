/**
 * LogScope - HTML/PDF report generator
 * Generates a self-contained HTML report from the current filtered view.
 * Use window.print() in the report window for PDF export.
 */

window.LogScope = window.LogScope || {};

LogScope.generateReport = function () {
  const state = LogScope.state;
  if (!state.entries.length) { alert('Aucun log chargé. Chargez un fichier avant de générer un rapport.'); return; }

  const filtered = state.filtered;
  const total = state.entries.length;
  const c = state.levelCounts;
  const first = state.entries[0]?.timestamp;
  const last  = state.entries[state.entries.length - 1]?.timestamp;
  const dur   = first && last ? LogScope.formatDuration(last - first) : '—';
  const now   = new Date().toLocaleString('fr-FR');
  const fmt   = LogScope.FORMAT_NAMES[state.format] || state.format || '?';

  // Top 10 errors
  const errors = filtered
    .filter(e => e.level === 'ERROR' || e.level === 'CRITICAL')
    .slice(0, 200);

  const topErrors = errors.reduce((acc, e) => {
    const key = e.message.slice(0, 120);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const sortedErrors = Object.entries(topErrors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Level distribution bar
  const maxCount = Math.max(...Object.values(c));
  const levelBar = LogScope.LEVELS.map(lvl => {
    const count = c[lvl] || 0;
    const pct = maxCount ? Math.round(count / maxCount * 100) : 0;
    const colors = { CRITICAL: '#FF4757', ERROR: '#FF6B6B', WARNING: '#FFA502', INFO: '#3DA9FC', DEBUG: '#747D8C' };
    return `
      <tr>
        <td style="width:80px;font-weight:600;color:${colors[lvl]}">${lvl}</td>
        <td><div style="background:${colors[lvl]};height:16px;width:${pct}%;min-width:2px;border-radius:3px"></div></td>
        <td style="padding-left:10px;font-family:monospace">${count.toLocaleString('fr')}</td>
      </tr>`;
  }).join('');

  // Log table (first 500 filtered entries)
  const rows = filtered.slice(0, 500).map(e => {
    const colors = { CRITICAL: '#FF4757', ERROR: '#FF6B6B', WARNING: '#FFA502', INFO: '#3DA9FC', DEBUG: '#747D8C' };
    const ts = e.ts ? e.ts.replace('T', ' ').replace('Z', '').slice(0, 19) : '';
    const msg = (e.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 200);
    return `<tr>
      <td style="white-space:nowrap;font-size:11px">${ts}</td>
      <td>${e.pid}</td>
      <td style="color:${colors[e.level]};font-weight:600">${e.level}</td>
      <td style="font-size:11px">${(e.logger || '').replace(/</g,'&lt;').slice(0,40)}</td>
      <td>${msg}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>LogScope — Rapport ${state.fileName || ''}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #fff; color: #111; padding: 32px 48px; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
    .section { margin-bottom: 28px; }
    .section h2 { font-size: 15px; font-weight: 700; border-bottom: 2px solid #eee; padding-bottom: 6px; margin-bottom: 12px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat { background: #f5f5f5; border-radius: 8px; padding: 12px 16px; }
    .stat .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .5px; }
    .stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 6px 8px; background: #f0f0f0; font-size: 11px; text-transform: uppercase; }
    td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:hover td { background: #fafafa; }
    .logo { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
    .logo span { color: #3DA9FC; }
    .footer { margin-top: 32px; font-size: 11px; color: #aaa; text-align: center; }
    @media print {
      body { padding: 16px; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <div class="logo">Log<span>Scope</span></div>
  <h1>Rapport d'analyse — ${(state.fileName || 'Fichier inconnu').replace(/</g,'&lt;')}</h1>
  <p class="subtitle">Généré le ${now} • Format : ${fmt} • Période : ${dur}</p>

  <div style="text-align:right;margin-bottom:16px">
    <button onclick="window.print()" style="background:#3DA9FC;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">
      Exporter en PDF
    </button>
  </div>

  <div class="section">
    <h2>Résumé</h2>
    <div class="stats-grid">
      <div class="stat"><div class="label">Total entrées</div><div class="value">${total.toLocaleString('fr')}</div></div>
      <div class="stat"><div class="label">Résultats filtrés</div><div class="value">${filtered.length.toLocaleString('fr')}</div></div>
      <div class="stat"><div class="label">PIDs uniques</div><div class="value">${Object.keys(state.workers).length}</div></div>
      <div class="stat"><div class="label">Durée</div><div class="value" style="font-size:16px">${dur}</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Distribution par niveau</h2>
    <table><tbody>${levelBar}</tbody></table>
  </div>

  ${sortedErrors.length ? `
  <div class="section">
    <h2>Top erreurs (sur les résultats filtrés)</h2>
    <table>
      <thead><tr><th>Occurrences</th><th>Message</th></tr></thead>
      <tbody>
        ${sortedErrors.map(([msg, n]) => `<tr>
          <td style="font-weight:700;width:80px">${n}</td>
          <td style="font-size:11px">${msg.replace(/</g,'&lt;')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <div class="section">
    <h2>Logs filtrés (${Math.min(filtered.length, 500).toLocaleString('fr')} / ${filtered.length.toLocaleString('fr')})</h2>
    <table>
      <thead><tr><th>Timestamp</th><th>PID</th><th>Niveau</th><th>Logger</th><th>Message</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${filtered.length > 500 ? `<p style="margin-top:8px;font-size:11px;color:#888">… et ${(filtered.length - 500).toLocaleString('fr')} entrées supplémentaires non affichées.</p>` : ''}
  </div>

  <div class="footer">LogScope — Rapport généré le ${now}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) alert('Popup bloquée. Autorisez les popups pour générer le rapport.');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
