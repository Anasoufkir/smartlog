/**
 * LogScope - Filter presets
 * Save and restore named filter combinations via localStorage.
 */

window.LogScope = window.LogScope || {};

(function () {
  const STORAGE_KEY = 'logscopePresets';

  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function savePresets(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function captureCurrentFilters() {
    return {
      search: document.getElementById('searchInput')?.value || '',
      pid: document.getElementById('pidInput')?.value || '',
      db: document.getElementById('dbSelect')?.value || '',
      logger: document.getElementById('loggerSelect')?.value || '',
      levels: [...LogScope.state.activeLevels],
      dateStart: document.getElementById('dateStart')?.value || '',
      dateEnd: document.getElementById('dateEnd')?.value || ''
    };
  }

  function applyPresetFilters(filters) {
    if (!filters) return;
    if (document.getElementById('searchInput')) document.getElementById('searchInput').value = filters.search || '';
    if (document.getElementById('pidInput')) document.getElementById('pidInput').value = filters.pid || '';
    if (document.getElementById('dbSelect')) document.getElementById('dbSelect').value = filters.db || '';
    if (document.getElementById('loggerSelect')) document.getElementById('loggerSelect').value = filters.logger || '';
    if (document.getElementById('dateStart')) document.getElementById('dateStart').value = filters.dateStart || '';
    if (document.getElementById('dateEnd')) document.getElementById('dateEnd').value = filters.dateEnd || '';

    if (filters.levels) {
      LogScope.state.activeLevels = new Set(filters.levels);
      document.querySelectorAll('#levelCheckboxes input').forEach(cb => {
        cb.checked = LogScope.state.activeLevels.has(cb.dataset.level);
      });
    }
    LogScope.applyFilters();
  }

  LogScope.savePreset = function (name) {
    if (!name) return;
    const presets = loadPresets();
    const existing = presets.findIndex(p => p.name === name);
    const preset = { name, filters: captureCurrentFilters(), savedAt: new Date().toISOString() };
    if (existing >= 0) presets[existing] = preset;
    else presets.push(preset);
    savePresets(presets);
    LogScope.renderPresets();
  };

  LogScope.deletePreset = function (name) {
    const presets = loadPresets().filter(p => p.name !== name);
    savePresets(presets);
    LogScope.renderPresets();
  };

  LogScope.applyPreset = function (name) {
    const preset = loadPresets().find(p => p.name === name);
    if (preset) applyPresetFilters(preset.filters);
  };

  LogScope.renderPresets = function () {
    const select = document.getElementById('presetsSelect');
    const deleteBtn = document.getElementById('presetDeleteBtn');
    if (!select) return;
    const presets = loadPresets();
    select.innerHTML = '<option value="">— Presets —</option>' +
      presets.map(p => `<option value="${LogScope.escapeHtml(p.name)}">${LogScope.escapeHtml(p.name)}</option>`).join('');
    if (deleteBtn) deleteBtn.disabled = !select.value;
  };

  LogScope.initPresets = function () {
    const saveBtn   = document.getElementById('presetSaveBtn');
    const deleteBtn = document.getElementById('presetDeleteBtn');
    const select    = document.getElementById('presetsSelect');
    if (!saveBtn || !select) return;

    saveBtn.addEventListener('click', () => {
      const name = prompt('Nom du preset :');
      if (name?.trim()) LogScope.savePreset(name.trim());
    });

    deleteBtn?.addEventListener('click', () => {
      const name = select.value;
      if (name && confirm(`Supprimer le preset « ${name} » ?`)) {
        LogScope.deletePreset(name);
      }
    });

    select.addEventListener('change', () => {
      if (select.value) LogScope.applyPreset(select.value);
      if (deleteBtn) deleteBtn.disabled = !select.value;
    });

    LogScope.renderPresets();
  };
})();
