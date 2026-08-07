# CSDM Deep-Linker Sandbox

A browser-based learning tool for ServiceNow's **Common Service Data Model**. You build a CSDM graph — business capabilities → applications → services → offerings → infrastructure — against the real relationship rules, and then break it on purpose.

The point is not the diagram. It is the moment a single storage volume goes red and the cascade reaches a business service with a 99.9% commitment on it. Impact analysis, failure simulation, revenue-at-risk and resilience what-ifs all exist so the model's *value* is something you watch happen rather than something you read about.

## Run it

```bash
npm install
```

```bash
npm start
```

Then open **http://localhost:3000** (set `PORT` to change it). No database and no build step — Express serves `public/` and `shared/`, and the model lives in a JSON file.

Node 18+ is a safe floor: the server itself uses nothing newer than optional chaining, and the Anthropic SDK expects a modern runtime. Two dependencies — `express`, and `@anthropic-ai/sdk`, which is only ever *used* if you supply an API key (uninstall it and the parser simply reports itself unavailable).

## The LLM parser is optional

Interview Mode's infrastructure question can send your prose to Claude Haiku 4.5 to pull out the *things* you mentioned. It is strictly additive:

- **With a key** — set `ANTHROPIC_API_KEY` before starting, or paste one at runtime under **Config ▾** in the status bar. A pasted key is test-called before it is accepted, is held in memory only, and does not survive a restart — it is never written to `csdmData.json` or localStorage.
- **Without one** — the endpoint answers `501 { unavailable: true }` and the client falls back to the hand-written lexicon in `public/interviewLexicon.js`. Everything still works.

The model never authors relationships; it returns things and which things go together, and the edges are built deterministically. Per-call token cost is logged, and `GET /api/interview/usage` reports the running session total. Set `INTERVIEW_CREDIT_USD=20` to have it also report credit remaining.

## Where to start

The app opens on an empty canvas, and the **Start Here** panel offers three ways in, easiest first — describe your environment in your own words (Interview Mode), open a finished model and take it apart, or build it layer by layer with a definition at every step. There is also a short tour of the interface, offered on the Start Here panel and always available from **Learn ▾ → Take the Tour**. It does not open itself over an empty canvas, and it skips the steps that describe nodes until you have some.

If you want the payoff in one minute, take the second card — it opens the **Shared-Infrastructure Example**. Then right-click the shared cluster → **Simulate Failure**, and watch it hit both trading services while a single database failure hits only one.

## What's in it

- **Interview Mode** — describe your real environment in plain language. Words that are ambiguous in CSDM ("service", "cluster", "instance") are *asked about*, never guessed. Every proposed node and edge arrives as a claim you can untick, and committing runs the cascade immediately.
- **Three guided builders** — Guided CSDM Path, Infrastructure Topology, Validated Relationship. All of them can only produce relationships CSDM actually allows.
- **Learning Mode** — flips the builders from hand-holding to guess-and-check.
- **Impact Analysis, failure cascade, 2am Incident Replay, revenue-at-risk ticker, resilience what-ifs** — the "why does this matter" half of the tool. Redundancy is scope-ranked, not a checkbox: an HA cluster survives losing a node, and nothing survives losing a cloud region.
- **Coach, Explain This Model, Portfolio Health Dashboard, Modeling Traps, Reference / Classes / Stats** — the teaching half.
- **Phase chips** on the status bar scope the builders to a CSDM adoption phase (Crawl / Walk / Run / Fly), so you meet 13 classes on day one instead of 52. They never hide anything already on the canvas — impact analysis has to see the whole model.

`CLAUDE.md` has the full feature inventory and the architecture notes.

## Data and storage

- `csdmData.json` — the working model. Ships **empty**, so a fresh clone opens on Start Here rather than inside a model you did not build. Saving writes it and drops a timestamped copy in `backups/`, so once you have saved something that is what you reopen.
- `backups/` — saved models plus the shipped examples, all loadable from **File ▾ → Open**:
  - `csdmData.reference-example.json` — one service, end to end.
  - `csdmData.shared-infra-example.json` — two services sharing infrastructure (the impact-contrast demo).
  - `csdmData.vm-ha-example.json` — VM/HA cluster, full Service Delivery and Sell/Consume layers, and the facility layer (rack → PDU/UPS/CRAC). The richest one.
- `captures/` — optional Interview Mode transcripts (what you typed, what the draft builder made of it, what you say it should have been), used to tune the builder.

Every load and save runs `migrateModel()` then `validateGraph()`, so an old or hand-edited file is upgraded and checked before it reaches the canvas.

## Tests

```bash
npm test
```

Five tests over the validator, edge creation and duplicate detection, relationship reversal, save/undo/redo, and migrations. Run them after any change to `shared/csdmSchema.js` or `shared/migrations.js`.

## Layout

| Path | What it is |
| --- | --- |
| `server.js` | Express server, JSON storage, load/save/validate routes |
| `interviewParse.js` | Optional LLM front door + token/cost accounting |
| `shared/` | UMD modules shared by browser and tests: schema, validator, graph service, migrations, model state |
| `public/` | The client — `app.js` (engine), `interview.js` + `interviewLexicon.js` (Interview Mode), `loadModels.js`, `index.html`, `styles.css` |
| `scripts/` | One-off schema maintenance, run by hand |
| `tests/` | `node tests/run-tests.js` |

`CLAUDE.md` is the working guide — architecture, conventions, and the gotchas worth reading before editing. `INTERVIEW_MODE_SPEC.md` is the design spec for Interview Mode.

## History

Earlier notes, kept for context. The schema still reports itself as `phase-3.7`; the phase numbering below refers to development milestones, not to the Crawl/Walk/Run/Fly adoption phases in the UI.

- **Phase 3.7 — relationship management UX.** Right-click relationship menu, relationship details, change relationship type, reverse direction with validation, delete relationship, duplicate-relationship checks in the Model Quality Advisor.
- **Saved models.** Added `GET /api/csdm/models`, `GET /api/csdm/model`, `POST /api/csdm/load` and `public/loadModels.js`. (The floating "Load Saved Model" button this shipped with is gone — Open now lives in the **File ▾** menu on the status bar.) Loading a saved model overwrites `csdmData.json` directly, without backing it up first.
- **Large-model phase 4 — performance.** Auto / Fast / Detail rendering modes. Auto switches to lightweight rendering for large visible graphs; Fast suppresses dense edge labels and shortens node labels; Detail keeps everything. Zooming out suppresses labels dynamically and zooming back in restores them. Preserves viewport on re-render, search/focus/filter navigation, and domain clustering.
- **Large-model phase 5A — the Inspector.** A fixed overlay, so it does not reflow the graph or the status bar. Selecting a node shows details, relationship counts, connection lists and quick actions; selecting an edge shows relationship details and copy/filter actions; selecting a collapsed domain cluster drills in without expanding it.
