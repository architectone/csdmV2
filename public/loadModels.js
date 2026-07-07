(function () {
  const MODAL_ID = 'csdm-load-saved-model-modal';
  const MODEL_NAME_ID = 'current-model-name';
  const MODEL_NAME_KEY = 'csdm.currentModelName';

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function prettyDate(value) {
    try { return new Date(value).toLocaleString(); }
    catch (_) { return value || ''; }
  }

  function safeFileName(value) {
    return String(value || 'csdm-model')
      .trim()
      .replace(/[^a-z0-9\-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'csdm-model';
  }

  function currentModel() {
    return typeof currentModelData !== 'undefined' ? currentModelData : null;
  }

  function normalizeModelForFile(model) {
    return {
      schemaVersion: model.schemaVersion || 'phase-3.7',
      seedModel: model.seedModel || 'Custom / Edited Model',
      nodes: model.nodes || [],
      edges: (model.edges || []).map(e => ({ from: e.from, to: e.to, label: e.label || e.relationship }))
    };
  }

  function getModelDisplayName() {
    const stored = localStorage.getItem(MODEL_NAME_KEY);
    if (stored) return stored;
    const model = currentModel();
    if (model && model.seedModel) return model.seedModel;
    return 'csdmData.json';
  }

  function setModelDisplayName(name) {
    const value = name || 'csdmData.json';
    localStorage.setItem(MODEL_NAME_KEY, value);
    updateModelNameDisplay();
  }

  function ensureModelNameDisplay() {
    const status = document.getElementById('status-bar');
    if (!status) return null;
    let el = document.getElementById(MODEL_NAME_ID);
    if (!el) {
      el = document.createElement('strong');
      el.id = MODEL_NAME_ID;
      el.className = 'current-model-name';
      el.setAttribute('data-lexical-text', 'true');
      const statusText = document.getElementById('status-text');
      status.insertBefore(el, statusText ? statusText.nextSibling : status.firstChild);
    }
    return el;
  }

  function updateModelNameDisplay() {
    const el = ensureModelNameDisplay();
    if (!el) return;
    el.textContent = `Current: ${getModelDisplayName()}`;
    el.title = `Current file/model: ${getModelDisplayName()}`;
  }

  function markBrowserSaved(name) {
    try {
      if (typeof clone === 'function' && typeof currentModelData !== 'undefined') lastSavedModel = clone(currentModelData);
      if (typeof undoStack !== 'undefined') undoStack = [];
      if (typeof redoStack !== 'undefined') redoStack = [];
      if (name) setModelDisplayName(name);
      if (typeof updateStatusBar === 'function') updateStatusBar();
      else updateModelNameDisplay();
    } catch (err) {
      console.warn('Saved, but local status could not be updated.', err);
      if (name) setModelDisplayName(name);
    }
  }

  function ensureStyles() {
    if (document.getElementById('csdm-load-save-styles')) return;
    const style = document.createElement('style');
    style.id = 'csdm-load-save-styles';
    style.textContent = `
      #status-load-model { background: #0f766e; }
      .current-model-name {
        display: inline-flex;
        align-items: center;
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 4px 8px;
        border: 1px solid #bfdbfe;
        border-radius: 999px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 11px;
      }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 100001;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15,23,42,.42);
        color: #0f172a;
        font-family: Segoe UI, Tahoma, sans-serif;
      }
      #${MODAL_ID}.hidden { display: none !important; }
      #${MODAL_ID} .lm-card {
        width: min(780px, calc(100vw - 36px));
        max-height: calc(100vh - 36px);
        overflow: auto;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 25px 70px rgba(15,23,42,.35);
      }
      #${MODAL_ID} .lm-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
      #${MODAL_ID} h2 { margin: 0; font-size: 16px; }
      #${MODAL_ID} .lm-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
      #${MODAL_ID} label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; }
      #${MODAL_ID} select { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; }
      #${MODAL_ID} .lm-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #f8fafc; line-height: 1.55; font-size: 12px; }
      #${MODAL_ID} .lm-good { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
      #${MODAL_ID} .lm-bad { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
      #${MODAL_ID} .lm-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 4px; }
      #${MODAL_ID} button { padding: 8px 10px; border: none; border-radius: 7px; font-weight: 700; cursor: pointer; background: #2563eb; color: white; }
      #${MODAL_ID} button.secondary { background: #64748b; }
      #${MODAL_ID} button.load-local { background: #0f766e; }
      #${MODAL_ID} .muted { color: #64748b; font-size: 12px; }
    `;
    document.head.appendChild(style);
  }

  function ensureStatusButtons() {
    ensureStyles();
    ensureModelNameDisplay();
    updateModelNameDisplay();
    const status = document.getElementById('status-bar');
    if (!status) return;
    let loadButton = document.getElementById('status-load-model');
    const saveButton = document.getElementById('status-save-model') || [...status.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
    if (!loadButton) {
      loadButton = document.createElement('button');
      loadButton.id = 'status-load-model';
      loadButton.type = 'button';
      loadButton.textContent = 'Load';
      status.insertBefore(loadButton, saveButton || null);
    }
    loadButton.textContent = 'Load';
    loadButton.onclick = openLoadDialog;
    if (saveButton) {
      saveButton.id = 'status-save-model';
      saveButton.onclick = saveModelAs;
    }
  }

  function ensureModal() {
    ensureStyles();
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden';
    modal.innerHTML = `<div class="lm-card"><div class="lm-header"><h2>Load Model</h2><button class="secondary" id="lm-close" type="button">Close</button></div><div class="lm-body" id="lm-body"></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#lm-close').addEventListener('click', closeLoadDialog);
    modal.addEventListener('click', e => { if (e.target === modal) closeLoadDialog(); });
    return modal;
  }

  function closeLoadDialog() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('hidden');
  }

  async function saveModelAs() {
    const model = currentModel();
    if (!model) return alert('No model is currently loaded.');
    const validator = window.CSDM_VALIDATOR;
    if (validator && typeof validator.validateGraph === 'function') {
      const validation = validator.validateGraph(model);
      if (!validation.valid) return alert(validation.errors.join('\n'));
    }
    const normalized = normalizeModelForFile(model);
    const json = JSON.stringify(normalized, null, 2);
    const suggestedName = `${safeFileName(normalized.seedModel)}.json`;
    let savedName = suggestedName;
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'CSDM JSON model', accept: { 'application/json': ['.json'] } }] });
        savedName = handle.name || suggestedName;
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      markBrowserSaved(savedName);
      alert('Model saved to the selected file.');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      alert(err.message || 'Save was canceled or failed.');
    }
  }

  async function openLoadDialog() {
    ensureStatusButtons();
    const modal = ensureModal();
    const body = modal.querySelector('#lm-body');
    modal.classList.remove('hidden');
    body.innerHTML = '<div class="lm-box">Loading saved models...</div>';
    try {
      const response = await fetch('/api/csdm/models');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The server did not return the saved model list.');
      renderModels(payload.models || []);
    } catch (err) {
      body.innerHTML = `<div class="lm-box lm-bad"><strong>Could not load saved models.</strong><br>${esc(err.message)}<br><br>You can still try loading a local JSON model file.</div><div class="lm-actions"><button class="load-local" type="button" id="lm-open-local">Open JSON File...</button><button class="secondary" type="button" id="lm-cancel">Cancel</button></div>`;
      body.querySelector('#lm-open-local').addEventListener('click', loadLocalFile);
      body.querySelector('#lm-cancel').addEventListener('click', closeLoadDialog);
    }
  }

  function renderModels(models) {
    const modal = ensureModal();
    const body = modal.querySelector('#lm-body');
    body.innerHTML = `<div class="muted">Choose a model from the app backup list, or open a JSON model file from your computer. Loading a model overwrites the current working model without creating a backup first.</div><div class="lm-actions" style="justify-content:flex-start"><button class="load-local" type="button" id="lm-open-local">Open JSON File...</button></div>${models.length ? `<div><label>Saved model</label><select id="lm-select">${models.map(m => `<option value="${esc(m.file)}">${esc(m.displayName)} — ${Number(m.nodeCount || 0)} nodes / ${Number(m.edgeCount || 0)} relationships — ${m.valid ? 'valid' : 'invalid'}</option>`).join('')}</select></div><div id="lm-detail"></div><div class="lm-actions"><button class="secondary" type="button" id="lm-refresh">Refresh</button><button class="secondary" type="button" id="lm-cancel">Cancel</button><button type="button" id="lm-load">Load</button></div>` : '<div class="lm-box lm-bad">No app-managed saved models were found.</div>'}`;
    body.querySelector('#lm-open-local').addEventListener('click', loadLocalFile);
    if (!models.length) return;
    const select = body.querySelector('#lm-select');
    function updateDetail() {
      const m = models.find(x => x.file === select.value);
      const detail = body.querySelector('#lm-detail');
      if (!m) { detail.innerHTML = ''; return; }
      detail.innerHTML = `<div class="lm-box ${m.valid ? 'lm-good' : 'lm-bad'}"><strong>${esc(m.displayName)}</strong><br>Schema: ${esc(m.schemaVersion || 'Unknown')}<br>Seed Model: ${esc(m.seedModel || 'Unknown')}<br>Nodes: ${Number(m.nodeCount || 0)}<br>Relationships: ${Number(m.edgeCount || 0)}<br>Last Modified: ${esc(prettyDate(m.modified))}<br>Status: ${m.valid ? 'Valid' : 'Invalid'}${m.error ? `<br>Error: ${esc(m.error)}` : ''}</div>`;
    }
    select.addEventListener('change', updateDetail);
    body.querySelector('#lm-refresh').addEventListener('click', openLoadDialog);
    body.querySelector('#lm-cancel').addEventListener('click', closeLoadDialog);
    body.querySelector('#lm-load').addEventListener('click', async () => {
      const selected = select.value;
      const m = models.find(x => x.file === selected);
      if (!m) return alert('Select a model first.');
      if (!m.valid) return alert('This model is invalid and cannot be loaded.');
      const message = m.isCurrent ? 'Reload the current working model from disk?' : 'Load this model and overwrite the current working model? No backup will be created first.';
      if (!confirm(message)) return;
      try {
        const response = await fetch('/api/csdm/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: selected }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Unable to load selected model.');
        setModelDisplayName(m.isCurrent ? 'csdmData.json' : m.displayName);
        alert('Model loaded. The page will refresh.');
        window.location.reload();
      } catch (err) { alert(err.message); }
    });
    updateDetail();
  }

  function chooseFileWithInput() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        resolve({ name: file.name, textPromise: file.text() });
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  async function loadLocalFile() {
    try {
      let text, fileName = 'local JSON file';
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'CSDM JSON model', accept: { 'application/json': ['.json'] } }] });
        const file = await handle.getFile();
        fileName = file.name || handle.name || fileName;
        text = await file.text();
      } else {
        const picked = await chooseFileWithInput();
        if (!picked) return;
        fileName = picked.name || fileName;
        text = await picked.textPromise;
      }
      if (!text) return;
      const model = JSON.parse(text);
      if (!confirm('Load this JSON file and overwrite the current working model? No backup will be created first.')) return;
      const response = await fetch('/api/csdm/load-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to load selected file.');
      setModelDisplayName(fileName);
      alert('Model loaded. The page will refresh.');
      window.location.reload();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      alert(err.message || 'Unable to load the selected file.');
    }
  }

  window.CSDM_OPEN_LOAD_MODELS = openLoadDialog;
  window.CSDM_SAVE_MODEL_AS = saveModelAs;
  window.CSDM_UPDATE_MODEL_NAME_DISPLAY = updateModelNameDisplay;
  window.persistChanges = saveModelAs;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStatusButtons);
  else ensureStatusButtons();
  setTimeout(updateModelNameDisplay, 250);
  setTimeout(updateModelNameDisplay, 1000);
})();
