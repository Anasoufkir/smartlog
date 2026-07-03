/**
 * LogScope - Timeline chart (HTML5 Canvas)
 *
 * Draws a stacked histogram showing the distribution of log levels over
 * the time span covered by the filtered entries.
 */

window.LogScope = window.LogScope || {};

const BUCKET_COUNT = 60;
const PADDING = { top: 20, right: 20, bottom: 45, left: 50 };
const STACK_ORDER = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

/**
 * Resize the canvas backing store to match its CSS size at device pixel ratio.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ctx: CanvasRenderingContext2D, W: number, H: number}}
 */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, W, H };
}

/**
 * Bucket the filtered entries into `BUCKET_COUNT` time slices.
 * @param {Array} entries
 * @returns {{buckets: Array, first: number, last: number, span: number}}
 */
function bucketize(entries) {
  const first = entries[0].timestamp.getTime();
  const last = entries[entries.length - 1].timestamp.getTime();
  const span = Math.max(1, last - first);

  const buckets = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    buckets.push({ CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0, total: 0 });
  }

  for (const e of entries) {
    let idx = Math.floor((e.timestamp.getTime() - first) / span * BUCKET_COUNT);
    if (idx >= BUCKET_COUNT) idx = BUCKET_COUNT - 1;
    if (idx < 0) idx = 0;
    buckets[idx][e.level]++;
    buckets[idx].total++;
  }
  return { buckets, first, last, span };
}

/**
 * Draw the stacked timeline histogram on the canvas.
 */
LogScope.drawTimeline = function () {
  const canvas = document.getElementById('timelineCanvas');
  if (!canvas) return;
  const { ctx, W, H } = setupCanvas(canvas);
  ctx.clearRect(0, 0, W, H);

  const entries = LogScope.state.filtered;
  if (entries.length === 0) {
    ctx.fillStyle = '#6C7690';
    ctx.font = '12px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Aucune donnée à afficher', W / 2, H / 2);
    return;
  }

  const { buckets, first, span } = bucketize(entries);
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  const chartW = W - PADDING.left - PADDING.right;
  const chartH = H - PADDING.top - PADDING.bottom;
  const barW = chartW / BUCKET_COUNT;

  // Horizontal grid + Y labels
  ctx.strokeStyle = '#222B3F';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6C7690';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = PADDING.top + (chartH * i / 4);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(PADDING.left + chartW, y);
    ctx.stroke();
    const v = Math.round(maxTotal * (1 - i / 4));
    ctx.fillText(String(v), PADDING.left - 6, y + 3);
  }

  // Stacked bars
  buckets.forEach((b, i) => {
    let y = PADDING.top + chartH;
    const x = PADDING.left + i * barW;
    const barActualW = Math.max(1, barW - 1);

    for (const lvl of STACK_ORDER) {
      if (b[lvl] === 0) continue;
      const segH = (b[lvl] / maxTotal) * chartH;
      ctx.fillStyle = LogScope.LEVEL_COLORS[lvl];
      ctx.fillRect(x, y - segH, barActualW, segH);
      y -= segH;
    }
  });

  // X axis rotated labels
  ctx.fillStyle = '#A7B0C2';
  ctx.font = '10px JetBrains Mono';
  const labelCount = 6;
  for (let i = 0; i <= labelCount; i++) {
    const t = first + span * i / labelCount;
    const d = new Date(t);
    const x = PADDING.left + chartW * i / labelCount;
    ctx.save();
    ctx.translate(x, PADDING.top + chartH + 12);
    ctx.rotate(-Math.PI / 6);
    ctx.textAlign = 'right';
    ctx.fillText(LogScope.formatDate(d), 0, 0);
    ctx.restore();
  }

  // Axes
  ctx.strokeStyle = '#2D3853';
  ctx.beginPath();
  ctx.moveTo(PADDING.left, PADDING.top);
  ctx.lineTo(PADDING.left, PADDING.top + chartH);
  ctx.lineTo(PADDING.left + chartW, PADDING.top + chartH);
  ctx.stroke();
};

LogScope.drawGantt = function () {
  const canvas = document.getElementById('ganttCanvas');
  if (!canvas) return;

  const entries = LogScope.state.filtered;
  if (!entries.length) {
    const { ctx, W, H } = setupCanvas(canvas);
    ctx.fillStyle = '#6C7690';
    ctx.font = '12px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Aucune donnée à afficher', W / 2, H / 2);
    return;
  }

  const rows = new Map();
  for (const e of entries) {
    if (!rows.has(e.pid)) {
      rows.set(e.pid, {
        pid: e.pid,
        first: e.timestamp.getTime(),
        last: e.timestamp.getTime(),
        count: 0,
        logger: e.logger,
        db: e.db,
        levels: { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 }
      });
    }
    const row = rows.get(e.pid);
    row.first = Math.min(row.first, e.timestamp.getTime());
    row.last = Math.max(row.last, e.timestamp.getTime());
    row.count += 1;
    row.levels[e.level]++;
  }

  const list = [...rows.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const minTime = Math.min(...list.map((r) => r.first));
  const maxTime = Math.max(...list.map((r) => r.last));
  const span = Math.max(1, maxTime - minTime);

  const rowHeight = 28;
  const labelWidth = 160;
  const requiredHeight = 80 + list.length * rowHeight;
  canvas.style.height = Math.max(260, requiredHeight) + 'px';
  const { ctx, W, H } = setupCanvas(canvas);

  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px JetBrains Mono';
  ctx.textAlign = 'left';

  const leftMargin = PADDING.left + labelWidth;
  const chartW = W - leftMargin - PADDING.right;

  // Header
  ctx.fillStyle = '#A7B0C2';
  ctx.fillText('PID / worker', PADDING.left, PADDING.top - 4);

  // Background rows
  list.forEach((row, idx) => {
    const y = PADDING.top + idx * rowHeight;
    ctx.fillStyle = idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
    ctx.fillRect(PADDING.left, y, W - PADDING.left - PADDING.right, rowHeight);
  });

  // Bars
  list.forEach((row, idx) => {
    const y = PADDING.top + idx * rowHeight + 6;
    const x = leftMargin + ((row.first - minTime) / span) * chartW;
    const width = Math.max(2, ((row.last - row.first) / span) * chartW);

    // Couleur basée sur le niveau dominant
    const dominantLevel = Object.keys(row.levels).reduce((a, b) => row.levels[a] > row.levels[b] ? a : b);
    const colors = { CRITICAL: '#FF6B6B', ERROR: '#FFA726', WARNING: '#FFEB3B', INFO: '#4CAF50', DEBUG: '#2196F3' };
    ctx.fillStyle = colors[dominantLevel] || '#747D8C';

    ctx.fillRect(x, y, width, rowHeight - 10);

    ctx.fillStyle = '#E8EAED';
    ctx.fillText(`${row.pid} (${row.count})`, PADDING.left, y + 12);

    // Stocker les données pour les interactions
    row._x = x;
    row._y = y;
    row._width = width;
    row._height = rowHeight - 10;
  });

  // Ajouter les interactions après le dessin
  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    list.forEach((row) => {
      if (clickX >= row._x && clickX <= row._x + row._width &&
          clickY >= row._y && clickY <= row._y + row._height) {
        // Filtrer par PID
        LogScope.state.pidFilter = row.pid;
        LogScope.applyFilters();
        LogScope.drawGantt();
      }
    });
  });

  // Time axis
  ctx.strokeStyle = '#2D3853';
  ctx.beginPath();
  ctx.moveTo(leftMargin, PADDING.top + list.length * rowHeight + 4);
  ctx.lineTo(leftMargin + chartW, PADDING.top + list.length * rowHeight + 4);
  ctx.stroke();

  ctx.fillStyle = '#A7B0C2';
  ctx.textAlign = 'center';
  const axisCount = 5;
  for (let i = 0; i <= axisCount; i++) {
    const x = leftMargin + (chartW * i / axisCount);
    const t = minTime + (span * i / axisCount);
    const d = new Date(t);
    ctx.fillText(LogScope.formatDate(d), x, PADDING.top + list.length * rowHeight + 20);
  }
};
