# CSDM Deep-Linker Sandbox — project guide

A browser-based **learning tool** for ServiceNow's Common Service Data Model (CSDM). It lets a person build a CSDM graph (business capabilities → applications → services → offerings → infrastructure), validate it against real CSDM relationship rules, and — the heart of the tool — **feel *why* the model exists** through impact analysis, failure simulation, cost/revenue-at-risk, and resilience what-ifs. Every feature should make the user experience the payoff, not just read an explanation.

## Architecture
- **server.js** — Express server. Storage is a JSON file (`csdmData.json`); no database. Loads/validates models, keeps timestamped copies in `backups/`. Runs `migrateModel` + `validateGraph` on save/load. Serves `public/` and `shared/`.
- **shared/** (UMD modules, used by both browser and `tests/`):
  - `csdmSchema.js` — **large, minified, single-line** file. The domain model: 50 `nodeTypes` (class → domain/level/color/prefix/metadataFields) and a ~4,850-entry `relationshipRules` array (allowed `{fromType,toType,label,explanation}`). Infra classes form a full "mesh" (every infra type × every infra type × 7 labels); business/service relationships are curated. **Edit this with small Node scripts, not hand edits, then verify by `require()`.** Helpers: `getAllowedRelationship`, `getRulesFromType`, `getValidRelationshipLabels`, `getMetadataFields`, `infrastructureTypes`, `visuals.domainMap`. `level` is a depth number (Business Capability 1 … Container Image 10 … Cloud Region 15, Facility 16) and Interview Mode nests infrastructure by it.
  - `csdmValidator.js` — `validateGraph(model)`: every node type known, every edge valid.
  - `graphService.js` — edge add/validate/reverse helpers.
  - `migrations.js` — `migrateModel()`: fills domain/position, renames legacy fields, and applies label/type migrations (e.g. legacy `Realizes`→`Provides`, `Business Service Offering`→`Service Offering`). Run on every load/save.
  - `modelState.js` — undo/redo/save/discard container (used by tests; the browser reimplements the same pattern inline).
- **public/**:
  - `app.js` — the whole client engine (also **minified, ~one statement per function**). vis-network rendering with an inline-SVG fallback. Owns `currentModelData`, undo/redo (`markChange`), all dialogs, impact/cascade/lineage/dashboard logic.
  - `index.html` — canvas, three right-click context menus (canvas/node/edge), the status bar with **View ▾** and **Learn ▾** popup menus, a generic modal, the Inspector panel, and an embedded `CSDM_FALLBACK_DATA`.
  - `loadModels.js` — Load/Save-As dialog; reads `backups/` via `/api/csdm/models`.
  - `interviewLexicon.js` — Interview Mode vocabulary (`window.CSDM_LEXICON`): ambiguity `traps` (service/app/cluster/server/database/environment/instance — always *ask*, never guess), class-match `groups` by area, plus `match`/`split`/`strip`. Every entry carries a `why` teaching line; quantifiers ("two VMs") become a redundancy value, not two nodes.
  - `interview.js` — Interview Mode engine (`window.CSDM_IV` / `CSDM_START_INTERVIEW`). Eight stages (anchor → environments → ownership → capability → consumers → infrastructure → resilience → money → review), a `buildDraft()` that proposes nodes/edges as rejectable *claims*, then a commit that runs the cascade and shows the payoff. Injects its launcher into the **Learn ▾** menu and the canvas context menu on load.
  - `styles.css` — all styling.
- **INTERVIEW_MODE_SPEC.md** — the design spec for Interview Mode (question tree, lexicon tables, coverage matrix, open issues). Read it before changing stage wording or the lexicon.
- **tests/run-tests.js** — `node tests/run-tests.js` (5 tests: validator, edge dup, reverse, save/undo/redo, migration).

## Feature inventory (all built)
**Interview Mode** (the front door: describe your real environment in your own words → lexicon maps it to CSDM classes, ambiguous words are *asked* not guessed → a review screen where every proposed node/edge is justified and can be unticked → commit, then an immediate cascade + revenue-at-risk payoff and a "now lose the whole region" closer) · Guided builders (Guided Path w/ per-step definitions+examples, Topology, Relationship — all validated) · **Learn mode** (guess-and-check quiz in the 3 builders) · Reference / Classes / Stats dialogs · **Explain This Model** (narrative) · **Coach** (Model Quality Advisor: completeness checks + SPOF detection, each with a "why") · **Impact Analysis** (blast radius, change safety, cost, compliance — directional) · **failure cascade** on canvas (redundancy-aware: resilient nodes absorb=amber) · **revenue-at-risk live ticker** · **Resilience/What-If** (toggle redundancy live) · **VM/HA** host-failure + **Re-run Discovery** (Service Mapping) · **Portfolio Health Dashboard** (whole-model cost/SPOF/resilience/completeness rollup) · **Why This Node Matters** (per-node role narrative) · two-lane layout · per-class metadata · non-operational (non-failable) design CIs · multi-select (Ctrl+click / shift-drag) + multi-delete · first-run tour · straight (non-curved) edges.

## CSDM domains modeled (all four)
Design & Planning (Business Capability, Business Application, Information Object) · Service Delivery (Application Service, Technical Service, Technical Service Offering, Application, plus the CSDM 5 **Service Instance** generalization: Data / Network / Connection / Operational Process / Facility Service Instance) · Service Consumption a.k.a. Sell/Consume (Business Service, Service Offering, Service Commitment, Service Portfolio, Service Catalog, Catalog Item, Subscription) · Infrastructure, split into sub-domains `Infrastructure / Compute · Runtime · Data · Storage · Network · Security · Cloud · Physical · Facility` (Facility = UPS, PDU, Generator, CRAC Unit, Chiller — the power/cooling layer under a Rack).

## Example models (loadable from the Load dialog / `backups/`)
- `csdmData.reference-example.json` — single-service reference.
- `csdmData.shared-infra-example.json` — two services sharing infra (impact-contrast demo).
- `csdmData.vm-ha-example.json` — VM/HA cluster + full Service Delivery + Sell/Consume layers, plus the facility layer (rack → PDU/UPS/CRAC) — the richest.
- `csdmData.json` — the current working model.

## Conventions & gotchas (READ BEFORE EDITING)
- **Schema changes (`shared/csdmSchema.js`) require a SERVER RESTART** — `server.js` `require()`s the schema once at startup, so the browser sees new classes on refresh but server-side validation still uses the old copy until restart (a load will fail "validation failed" until then). `public/*` changes only need a browser refresh.
- **`public/app.js` and `shared/csdmSchema.js` are minified one-liners.** After ANY edit run `node --check public/app.js`. In single-quoted JS strings, apostrophes break the file (a past bug) — prefer template literals / backticks for any prose.
- **EA vs ServiceNow naming is intentional dual-naming.** UI labels use clear EA terms; the real ServiceNow relationship/class names are shown on hover, in the Inspector, and in Reference/Classes tables via `SERVICENOW_REL` / `SERVICENOW_CLASS` maps in `app.js`.
- **Impact direction:** `IMPACT_REVERSE_LABELS` in `app.js` decides which edges propagate failure target→source (Depends on/Runs on/Uses/Instantiates/Offers) vs source→target (Contains/Routes to/Points to/Provides/Realizes).
- **Non-operational types** (`NON_OPERATIONAL_TYPES`) can't be failure-simulated (Design + Sell/Consume artifacts).
- **Resilience is scope-ranked, not boolean.** `FAILURE_DOMAIN_RANK` (Physical Host 1, Rack 2, Data Center 3, AZ 4, Cloud Region 5) vs `REDUNDANCY_SCOPE_RANK` (`Redundant pair` 2, `HA cluster`/`Auto-scaling` 4) in `app.js`: a node absorbs a failure only when its redundancy rank ≥ the origin's domain rank. Nothing reaches 5 — losing a region is deliberately unsurvivable, and Interview Mode ends on exactly that.
- **Interview Mode must only emit `IMPACT_REVERSE_LABELS` edges** for the dependency spine (`pickLabel` in `interview.js`). Using `Contains` there would look correct on the canvas and silently produce no cascade — the whole point of the feature dies. Same reason data/network/security leaves hang off the *Application Service*, not off whatever VM happened to be placed last.
- **Sandbox classes:** `isPickableClass()` hides classes with no `SERVICENOW_CLASS` mapping from pickers unless the `csdmAllowSandbox` localStorage toggle is on (set from the Classes dialog).
- **Verify in-browser cheaply:** prefer `javascript_tool`/DOM/`getSelectedNodes` checks over screenshots (screenshots are token-heavy). vis-network uses Hammer.js, so synthetic click events don't drive selection — use real clicks or programmatic `selectNodes`.
- Run `node tests/run-tests.js` after schema/migration changes.

## Workflow
Commit/push only when asked. `backups/Baseline.json` and runtime backup churn are typically left out of feature commits.
