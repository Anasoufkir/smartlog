/**
 * LogScope - Annotations
 * Add persistent notes to log entries, stored server-side.
 */

window.LogScope = window.LogScope || {};

(function () {
  const API = 'http://localhost:3000';
  let cache = {}; // fileHash -> { entryIdx -> annotation }
  let currentFileHash = null;

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 2000); i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0');
  }

  async function fetchAnnotations(hash) {
    try {
      const res = await LogScope.authenticatedFetch(`${API}/api/annotations?hash=${hash}`);
      if (!res.ok) return {};
      const list = await res.json();
      const map = {};
      list.forEach(a => { map[a.entryIdx] = a; });
      return map;
    } catch { return {}; }
  }

  LogScope.loadAnnotations = async function () {
    const state = LogScope.state;
    if (!state.entries.length) return;
    const raw = state.sources.length ? state.sources.map(s => s.rawText || '').join('') : '';
    currentFileHash = simpleHash(raw || state.fileName || '');
    cache[currentFileHash] = await fetchAnnotations(currentFileHash);
    LogScope.renderLogRows(); // Refresh to show annotation icons
  };

  LogScope.getAnnotation = function (entryIdx) {
    if (!currentFileHash) return null;
    return (cache[currentFileHash] || {})[entryIdx] || null;
  };

  LogScope.openAnnotationModal = async function (entryIdx) {
    const existing = LogScope.getAnnotation(entryIdx);
    const entry = LogScope.state.entries[entryIdx];
    if (!entry) return;

    const modal = document.getElementById('annotationModal');
    const input = document.getElementById('annotationText');
    const title = document.getElementById('annotationTitle');
    const delBtn = document.getElementById('annotationDeleteBtn');
    if (!modal || !input) return;

    if (title) title.textContent = `Annotation — PID ${entry.pid} / ${entry.level}`;
    input.value = existing ? existing.text : '';
    if (delBtn) delBtn.style.display = existing ? 'inline-flex' : 'none';

    modal.dataset.entryIdx = entryIdx;
    modal.classList.add('active');
    input.focus();
  };

  LogScope.saveAnnotation = async function () {
    const modal = document.getElementById('annotationModal');
    const input = document.getElementById('annotationText');
    if (!modal || !input) return;

    const entryIdx = Number(modal.dataset.entryIdx);
    const text = input.value.trim();
    if (!text) { LogScope.deleteAnnotation(entryIdx); return; }

    const user = LogScope.getCurrentUser ? (LogScope.getCurrentUser()?.username || 'anonymous') : 'anonymous';
    try {
      const res = await LogScope.authenticatedFetch(`${API}/api/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: currentFileHash, entryIdx, text, username: user })
      });
      if (res.ok) {
        const saved = await res.json();
        if (!cache[currentFileHash]) cache[currentFileHash] = {};
        cache[currentFileHash][entryIdx] = saved;
        modal.classList.remove('active');
        LogScope.renderLogRows();
      }
    } catch (err) { console.error('Annotation save error', err); }
  };

  LogScope.deleteAnnotation = async function (entryIdx) {
    const ann = LogScope.getAnnotation(entryIdx);
    if (!ann) { document.getElementById('annotationModal')?.classList.remove('active'); return; }

    try {
      await LogScope.authenticatedFetch(`${API}/api/annotations/${ann.id}`, { method: 'DELETE' });
      if (cache[currentFileHash]) delete cache[currentFileHash][entryIdx];
      document.getElementById('annotationModal')?.classList.remove('active');
      LogScope.renderLogRows();
    } catch (err) { console.error('Annotation delete error', err); }
  };

  LogScope.initAnnotations = function () {
    document.getElementById('annotationSaveBtn')?.addEventListener('click', LogScope.saveAnnotation);
    document.getElementById('annotationDeleteBtn')?.addEventListener('click', () => {
      const idx = Number(document.getElementById('annotationModal')?.dataset.entryIdx);
      if (!isNaN(idx)) LogScope.deleteAnnotation(idx);
    });
    document.getElementById('annotationModalClose')?.addEventListener('click', () => {
      document.getElementById('annotationModal')?.classList.remove('active');
    });
    document.getElementById('annotationModal')?.addEventListener('click', e => {
      if (e.target.id === 'annotationModal') e.target.classList.remove('active');
    });
  };
})();
