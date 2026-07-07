# CSDM Deep Linker Sandbox — Phase 3.7

Adds Relationship Management UX: right-click relationship menu, relationship details, change relationship type, reverse direction with validation, delete relationship, and duplicate relationship checks in Model Quality Advisor. Preserves smart routing, persisted positions, View Modes, Reset Layout, and prior behavior.


## Load Saved Model enhancement
- Adds `GET /api/csdm/models`, `GET /api/csdm/model`, and `POST /api/csdm/load`.
- Adds `public/loadModels.js`, which adds a **Load** button beside **Save**, overrides **Save** with a browser Save As dialog, and shows the current file/model name in the status bar.
- Loading a model overwrites the current `csdmData.json` without creating a backup first.


## Current model name update
- Adds a visible **Current:** file/model badge to the status bar.
- The badge updates after loading an app backup, opening a local JSON file, or saving through the Save As dialog.
