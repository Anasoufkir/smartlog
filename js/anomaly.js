/**
 * LogScope - Anomaly detection
 * Computes error rate per time bucket and flags statistical outliers (mean + 2σ).
 * Results are displayed as an overlay on the timeline and as a stats card.
 */

window.LogScope = window.LogScope || {};

LogScope.detectAnomalies = function () {
  const entries = LogScope.state.entries;
  if (entries.length < 10) return [];

  const first = entries[0].timestamp.getTime();
  const last  = entries[entries.length - 1].timestamp.getTime();
  const span  = last - first;
  if (span <= 0) return [];

  // Choose bucket size: aim for ~60 buckets, min 1 min, max 1 hour
  const rawBucket = span / 60;
  const bucketMs  = Math.max(60000, Math.min(3600000, rawBucket));
  const nBuckets  = Math.ceil(span / bucketMs) + 1;

  const counts = new Array(nBuckets).fill(0);
  const criticalLevels = new Set(['CRITICAL', 'ERROR']);

  entries.forEach(e => {
    if (!criticalLevels.has(e.level)) return;
    const bi = Math.floor((e.timestamp.getTime() - first) / bucketMs);
    if (bi >= 0 && bi < nBuckets) counts[bi]++;
  });

  // Compute mean and std dev
  const filled = counts.filter(c => c > 0);
  if (!filled.length) return [];

  const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
  const variance = filled.reduce((s, c) => s + (c - mean) ** 2, 0) / filled.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 2 * std;

  const anomalies = [];
  counts.forEach((c, i) => {
    if (c > threshold && c >= 3) {
      const tStart = new Date(first + i * bucketMs);
      const tEnd   = new Date(first + (i + 1) * bucketMs);
      anomalies.push({
        bucketIdx: i,
        count: c,
        threshold: Math.round(threshold),
        mean: Math.round(mean),
        tStart, tEnd
      });
    }
  });

  return anomalies;
};

LogScope.renderAnomalyCard = function () {
  const card = document.getElementById('anomalyCard');
  if (!card) return;

  const anomalies = LogScope.detectAnomalies();
  if (!anomalies.length) {
    card.innerHTML = `
      <div class="label">Anomalies</div>
      <div class="value" style="color:var(--success)">0</div>
      <div class="sub">Aucun pic détecté</div>`;
    card.className = 'stat-card anomaly-ok';
    return;
  }

  const worst = anomalies.reduce((a, b) => b.count > a.count ? b : a);
  card.innerHTML = `
    <div class="label">Anomalies détectées</div>
    <div class="value" style="color:var(--error)">${anomalies.length}</div>
    <div class="sub">Pic : ${worst.count} erreurs à ${worst.tStart.toLocaleTimeString('fr-FR')}</div>`;
  card.className = 'stat-card anomaly-warn';
  card.style.cursor = 'pointer';
  card.title = 'Cliquez pour voir les anomalies';
  card.onclick = () => LogScope.showAnomalyDetails(anomalies);
};

LogScope.showAnomalyDetails = function (anomalies) {
  const list = anomalies.map(a => {
    const fmt = (d) => d.toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
    return `• ${fmt(a.tStart)} → ${fmt(a.tEnd)} : ${a.count} erreurs (seuil : ${a.threshold})`;
  }).join('\n');
  alert(`Anomalies détectées (${anomalies.length}) :\n\n${list}\n\nMoyenne normale : ~${anomalies[0]?.mean} erreurs/période.`);
};
