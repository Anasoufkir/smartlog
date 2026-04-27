/**
 * LogScope - UI helpers
 *
 * Modal dialog, loader overlay, tabs, and upload zone behaviour.
 */

window.LogScope = window.LogScope || {};

/**
 * Show the loader overlay with a custom message.
 * @param {string} [text]
 */
LogScope.showLoader = function (text) {
  document.getElementById('loaderText').textContent = text || 'Chargement...';
  document.getElementById('loader').classList.add('active');
};

/**
 * Hide the loader overlay.
 */
LogScope.hideLoader = function () {
  document.getElementById('loader').classList.remove('active');
};

/**
 * Open the detail modal for a single log entry.
 * @param {number} idx - index of the entry in `state.entries`
 */
LogScope.showEntryDetail = function (idx) {
  const e = LogScope.state.entries[idx];
  if (!e) return;
  document.getElementById('modalTitle').innerHTML =
    `<span class="level-badge level-${e.level}">${e.level}</span> PID ${LogScope.escapeHtml(e.pid)}`;
  document.getElementById('modalMeta').textContent =
    e.ts + ' • ' + e.logger + (e.db && e.db !== '?' ? ' • DB: ' + e.db : '');
  document.getElementById('modalContent').textContent = e.raw;
  document.getElementById('modalOverlay').classList.add('active');
};

/**
 * Close the detail modal.
 */
LogScope.closeModal = function () {
  document.getElementById('modalOverlay').classList.remove('active');
};

/**
 * Wire up tab switching.
 */
LogScope.initTabs = function () {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const panel = document.querySelector(`[data-panel="${t.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
      if (t.dataset.tab === 'timeline') LogScope.drawTimeline();
      if (t.dataset.tab === 'gantt') LogScope.drawGantt();
    });
  });
};

/**
 * Wire up the upload zone (click, drag-drop, mouse spotlight).
 */
LogScope.initUploadZone = function (onFile) {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  uploadZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn &&
        !e.target.closest('button') &&
        !e.target.closest('input') &&
        !e.target.closest('select') &&
        !e.target.closest('textarea')) {
      fileInput.click();
    }
  });
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  uploadZone.addEventListener('mousemove', (e) => {
    const r = uploadZone.getBoundingClientRect();
    uploadZone.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    uploadZone.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag');
    if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) onFile(e.target.files[0]);
  });
};

/**
 * Wire up an SSH key file picker: clicking the browse button opens a file dialog,
 * reads the key content, stores it on the text input as `dataset.keyContent`,
 * and shows the file name in the input.
 *
 * @param {string} browseId   - id of the browse button
 * @param {string} pickerId   - id of the hidden <input type="file">
 * @param {string} displayId  - id of the text input to show the filename
 */
LogScope.initSshKeyPicker = function (browseId, pickerId, displayId) {
  const browseBtn = document.getElementById(browseId);
  const picker    = document.getElementById(pickerId);
  const display   = document.getElementById(displayId);
  if (!browseBtn || !picker || !display) return;

  // Also allow clicking directly on the readonly text input
  display.addEventListener('click', () => picker.click());
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); picker.click(); });

  picker.addEventListener('change', () => {
    const file = picker.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      display.value = file.name;
      display.dataset.keyContent = e.target.result;
      display.title = `Clé chargée : ${file.name}`;
    };
    reader.readAsText(file);
    picker.value = ''; // reset so same file can be re-selected
  });
};

/**
 * Return the SSH key content for a given display input id.
 * Returns the dataset.keyContent if available, otherwise the raw value (legacy path).
 */
LogScope.getSshKeyContent = function (displayId) {
  const el = document.getElementById(displayId);
  if (!el) return null;
  return el.dataset.keyContent || el.value.trim() || null;
};
