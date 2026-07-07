# CSDM Deep Linker Sandbox — Phase 3.7

Adds Relationship Management UX: right-click relationship menu, relationship details, change relationship type, reverse direction with validation, delete relationship, and duplicate relationship checks in Model Quality Advisor. Preserves smart routing, persisted positions, View Modes, Reset Layout, and prior behavior.


## Load Saved Model enhancement
- Adds `GET /api/csdm/models`, `GET /api/csdm/model`, and `POST /api/csdm/load`.
- Adds `public/loadModels.js`, which renders an always-visible floating **Load Saved Model** button.
- Loading a backup creates a fresh backup of the current `csdmData.json` before replacing it.


## Large-model Phase 4 update
- Adds a Performance control: Auto, Fast, and Detail.
- Auto switches to lightweight rendering for large visible graphs.
- Fast mode suppresses dense edge labels and uses shorter node labels for smoother navigation.
- Detail mode keeps full node and edge labels visible.
- Zooming out in Auto/Fast suppresses labels dynamically; zooming back in restores them when appropriate.
- Avoids expensive edge-smoothing calculations in lightweight mode.
- Keeps Phase 1 viewport preservation, Phase 2 search/focus/filter navigation, and Phase 3 domain clustering.
