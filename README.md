# CSDM Deep Linker Sandbox — Phase 3.7

Adds Relationship Management UX: right-click relationship menu, relationship details, change relationship type, reverse direction with validation, delete relationship, and duplicate relationship checks in Model Quality Advisor. Preserves smart routing, persisted positions, View Modes, Reset Layout, and prior behavior.


## Load Saved Model enhancement
- Adds `GET /api/csdm/models`, `GET /api/csdm/model`, and `POST /api/csdm/load`.
- Adds `public/loadModels.js`, which renders an always-visible floating **Load Saved Model** button.
- Loading a saved model overwrites the current `csdmData.json` directly, without creating a backup of it first.


## Large-model Phase 4 update
- Adds a Performance control: Auto, Fast, and Detail.
- Auto switches to lightweight rendering for large visible graphs.
- Fast mode suppresses dense edge labels and uses shorter node labels for smoother navigation.
- Detail mode keeps full node and edge labels visible.
- Zooming out in Auto/Fast suppresses labels dynamically; zooming back in restores them when appropriate.
- Avoids expensive edge-smoothing calculations in lightweight mode.
- Keeps Phase 1 viewport preservation, Phase 2 search/focus/filter navigation, and Phase 3 domain clustering.


## Large-model Phase 5A fixed update
- Adds the Inspector as a fixed overlay so it does not change the main graph layout or bottom status/menu bar.
- Selecting a node opens node details, relationship counts, connection lists, and quick actions.
- Selecting an edge opens relationship details and copy/filter actions.
- Selecting a collapsed domain cluster opens cluster drill-down details without automatically expanding it.
