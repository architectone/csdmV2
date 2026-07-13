const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateGraph } = require('./shared/csdmValidator');
const schema = require('./shared/csdmSchema');
const { migrateModel } = require('./shared/migrations');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'csdmData.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_FILE_PATTERN = /^csdmData\..+\.json$/;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

function readJson(filePath, message) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    err.message = `${message}: ${err.message}`;
    throw err;
  }
}

function readModel() {
  return readJson(DATA_FILE, 'Unable to read CSDM data');
}

function normalizeModel(model) {
  return {
    schemaVersion: model.schemaVersion || 'phase-3.7',
    seedModel: model.seedModel || 'Custom / Edited Model',
    nodes: model.nodes || [],
    edges: (model.edges || []).map(e => ({
      from: e.from,
      to: e.to,
      label: e.label || e.relationship
    }))
  };
}

function validateOrThrow(model) {
  const normalized = normalizeModel(migrateModel(model, schema));
  const v = validateGraph(normalized);
  if (!v.valid) {
    const err = new Error('CSDM model validation failed.');
    err.status = 400;
    err.details = v.errors;
    throw err;
  }
  return normalized;
}

function backupCurrentModel() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_DIR, `csdmData.${stamp}.json`);
  fs.copyFileSync(DATA_FILE, backup);
  return backup;
}

function writeModel(model) {
  const normalized = validateOrThrow(model);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(normalized, null, 2);

  try {
    backupCurrentModel();
    fs.writeFileSync(tmp, payload, 'utf8');
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    err.message = `Unable to write CSDM data safely: ${err.message}`;
    throw err;
  }
}

function writeModelWithoutBackup(model) {
  const normalized = validateOrThrow(model);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(normalized, null, 2);
  try {
    fs.writeFileSync(tmp, payload, 'utf8');
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    err.message = `Unable to write CSDM data safely: ${err.message}`;
    throw err;
  }
}

function resolveSavedModelPath(file) {
  if (!file || file === 'current') return DATA_FILE;

  const safeName = path.basename(file);
  if (safeName !== file || !BACKUP_FILE_PATTERN.test(safeName)) {
    const err = new Error('Invalid saved model file name.');
    err.status = 400;
    throw err;
  }

  const fullPath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    const err = new Error('Saved model was not found.');
    err.status = 404;
    throw err;
  }

  return fullPath;
}

function summarizeModelFile(filePath, file, displayName, isCurrent) {
  const stat = fs.statSync(filePath);
  const summary = {
    file,
    displayName,
    isCurrent: !!isCurrent,
    modified: stat.mtime.toISOString(),
    size: stat.size
  };

  try {
    const model = normalizeModel(readJson(filePath, `Unable to read ${displayName}`));
    const v = validateGraph(model);
    summary.schemaVersion = model.schemaVersion;
    summary.seedModel = model.seedModel;
    summary.nodeCount = model.nodes.length;
    summary.edgeCount = model.edges.length;
    summary.valid = v.valid;
    summary.errors = v.errors || [];
  } catch (err) {
    summary.valid = false;
    summary.error = err.message;
  }

  return summary;
}

function listSavedModels() {
  const models = [];

  if (fs.existsSync(DATA_FILE)) {
    models.push(summarizeModelFile(DATA_FILE, 'current', 'Current working model', true));
  }

  if (fs.existsSync(BACKUP_DIR)) {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => BACKUP_FILE_PATTERN.test(name))
      .map(name => summarizeModelFile(path.join(BACKUP_DIR, name), name, name, false))
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    models.push(...backups);
  }

  return models;
}

function readSavedModel(file) {
  return normalizeModel(readJson(resolveSavedModelPath(file), 'Unable to read saved model'));
}

app.get('/api/csdm', (req, res, next) => {
  try {
    res.json(readModel());
  } catch (err) {
    next(err);
  }
});

app.post('/api/csdm', (req, res, next) => {
  try {
    writeModel(req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/csdm/models', (req, res, next) => {
  try {
    res.json({ models: listSavedModels() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/csdm/model', (req, res, next) => {
  try {
    res.json(readSavedModel(req.query.file || 'current'));
  } catch (err) {
    next(err);
  }
});

app.post('/api/csdm/load', (req, res, next) => {
  try {
    const file = req.body && req.body.file;
    const model = readSavedModel(file || 'current');

    if (file && file !== 'current') {
      writeModelWithoutBackup(model);
    }

    res.json({
      success: true,
      loadedFrom: file || 'current',
      model: readModel()
    });
  } catch (err) {
    next(err);
  }
});


app.post('/api/csdm/load-content', (req, res, next) => {
  try {
    const model = validateOrThrow(req.body);
    writeModelWithoutBackup(model);
    res.json({ success: true, model: readModel() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', phase: '3.7' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message, details: err.details });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`CSDM Graph-Linking Engine running at http://localhost:${PORT}`));
}

module.exports = {
  app,
  readModel,
  writeModel,
  listSavedModels,
  readSavedModel
};
