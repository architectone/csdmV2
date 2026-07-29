# Interview Mode — question tree & lexicon spec

A conversational on-ramp that lets a user describe their environment in their own words and
walks out with a **reviewed, explained** CSDM model — then drops them straight into failure
cascade and revenue-at-risk.

Status: **implemented** in `public/interview.js` + `public/interviewLexicon.js` (all nine stages).
Deterministic — no LLM required; see "Optional LLM front door" at the end.

---

## 1. Design rules (non-negotiable)

1. **Narrate every mapping.** Each answer visibly becomes a classification decision *with a
   reason*, quoting the user's own words back to them. No silent inference.
2. **Propose, don't commit.** Output is a reviewable draft: accept / reject / "why did you say
   that?" per claim. The review pass *is* the lesson. A rejected guess is a teaching moment,
   not a failure.
3. **End in the payoff, not the model.** The last step fires `simulateFailure` +
   `startFailureCostTicker` on the weakest node the interview found, then Coach + Dashboard.
   The interview is the on-ramp to every feature that already exists.

Corollary: the tool never authors a CSDM rule. The LLM/lexicon proposes a *mapping*; the
authoritative *why* is always `relationshipRules[].explanation` from `shared/csdmSchema.js`,
surfaced via `relationshipExplanation()`.

---

## 2. Grounding facts the tree is built around

These are verified against the current code. The question order exists to satisfy them.

### 2.1 The revenue spine

`affectedRevenuePerHour()` (`public/app.js`) filters affected nodes to **`Business Capability`
only**, and `revenuePerHour()` needs `metadata.revenueAmount`. `revenueAmount` exists on
**exactly one class: `Business Capability`.**

The cascade reaches a Capability only along this chain (per `IMPACT_REVERSE_LABELS` =
`Depends on, Runs on, Uses, Instantiates, Offers` propagating target→source; everything else
source→target):

```
infra  ──Depends on──▶  Application Service        (reverse: infra failure hits the service)
Business Application ──Instantiates──▶ Application Service   (reverse: hits the app)
Business Application ──Provides──▶ Business Capability       (forward: hits the capability)
```

A second legal path also works:

```
infra ▶ Application Service ◀──Depends on── Service Offering ◀──Offers── Business Service ──Provides──▶ Business Capability
```

**Implication:** the model MUST contain the `Business Application` + `Business Capability` pair
with both edges wired, or the money never lights up.

This is a constraint on the **draft**, not on the question order. `buildDraft()` runs after every
stage has been answered, so it wires that pair whenever both answers exist — which is why
**Infrastructure** can be asked first (see §3) without breaking revenue. What the constraint does
mean is that skipping **Ownership** or **Capability** silently kills revenue-at-risk, so neither
may be skipped quietly: `skip()` states the exact consequence before accepting it, and `gaps()`
repeats it on the review screen and again in the payoff.

### 2.1a `level` is not a hosting order

`level` is depth from the **business**, not the hosting stack. `Application Service` 3,
`Application` 5, `VM` 6, `Database Instance` 8, `Storage Volume` 9, `Physical Host` 11.

A database is level 8 and a VM is level 6 — yet the database runs **on** the VM. Any algorithm
that parents by `level` therefore gets every data, storage, network and security class backwards.
This was a real defect: `buildDraft()` classed `Database Instance` as a non-spine "leaf", hung it
off the Application Service, and never emitted the hosting edge at all.

**A non-hosting CI needs two edges, and they point in opposite directions on purpose:**

```
Application Service --Depends on--> Database Instance   # DB outage travels UP to the business
Database Instance   --Runs on-->    VM                  # VM outage travels DOWN to the DB
```

`csdmData.json` carries both (`cr-order-engine --Uses--> cr-orders-db`,
`cr-orders-db --Runs on--> cr-web-vm-01`). With only the first, failing a VM leaves the database
on it untouched — the cascade is confidently wrong. With only the second, a database outage
reaches nothing. `buildDraft()` now emits both, and hosting classes (`HOSTING` ∪ `RUNTIME`) stack
on each other via `hostsAbove()`, which returns **every** node in the nearest shallower hosting
layer — two VMs in one rack are both in the rack.

### 2.1b The prescribed chain (Figure 16)

Figure 16 of the CSDM 5 white paper shows **no direct edge from Application Service to
Infrastructure CI**. The prescribed chain puts `Application` in between:

```
Application Service --[Depends on::Used by]--> Application --[Runs On::Runs]--> Infrastructure CI (*various)
```

The schema permits the shortcut (`Application Service -> Infrastructure CI` = `Depends on`,
`Runs on`) and that is deliberate — real Service Mapping does associate CIs straight to the
service via `svc_ci_assoc`. But it must not be the *default* the interview emits. Two things
enforce that:

- the `appserver` lexicon trap offers **The software itself → `Application`**, so the middle
  tier is reachable at all (before it existed, "app server" always hit the bare `server` trap
  and only ever produced Physical Host / VM / Compute Node);
- **pass 4** of the infrastructure builder connects the service directly to a box *only* when
  nothing else already reaches it.

Known divergences from Figure 16, deliberate or open:

| Figure 16 | This app | Status |
|---|---|---|
| Business Application `[Uses::Used by]` Application Service | `Instantiates` → `Instantiates::Instantiated by` | **open** — the ServiceNow half of the dual-naming is wrong for this pair; fixing it is a schema change plus a `migrations.js` label migration |
| `Ref: "Published as"`, `Ref: "Is part of"` | modelled as `Offers` / `Contains` edges | accepted — they are reference fields in CSDM, not `cmdb_rel_ci` rows, so they would not really propagate impact |
| Value Stream, Business Process, SDLC Component, API, Connected Device, Network Function, Dynamic CI Group | absent | gap — `Business Process` (`Operationalizes`) and `API` (`Receives data from`) are the two worth adding |

This matches CSDM 5.0's layered Digital System Model, and the Service Delivery domain is
explicitly the one "historically used by IT Operations Management such as Service Mapping and
ServiceNow Discovery" (CSDM 5 white paper, p.36) — tools that emit chained, tier-by-tier
dependency maps rather than a flat star from the Application Service.

### 2.2 Redundancy is scope-ranked

```js
FAILURE_DOMAIN_RANK   = { Physical Host:1, Rack:2, Data Center:3, Availability Zone:4, Cloud Region:5 }
REDUNDANCY_SCOPE_RANK = { 'Redundant pair':2, 'HA cluster':4, 'Auto-scaling':4 }   // unset/'Single instance' → 0
absorbs(n) = isResilient(n) && originRank <= redundancyToleranceRank(n)
```

Consequences to exploit in **Resilience** and **Review**:

| Origin of failure | `Redundant pair` absorbs? | `HA cluster` / `Auto-scaling` absorbs? |
|---|---|---|
| Non-domain node (DB, VM, …) — rank 0 | yes | yes |
| Physical Host (1) | yes | yes |
| Rack (2) | yes | yes |
| Data Center (3) | **no** | yes |
| Availability Zone (4) | **no** | yes |
| Cloud Region (5) | **no** | **no** |

Also: `if (isResilient(root)) return { contained: true }` — simulating failure *on* a redundant
node stops the cascade dead. That is the Resilience/What-If lesson in one click.

So the redundancy question must be phrased as **scope of loss survived**, not "is it redundant?".

### 2.3 What is dark today (the bug this feature fixes)

`resolveNode()` and `commitTopologyDialog()` write `metadata: { description, position }` and
nothing else. No `redundancy`, no `revenueAmount`, no `monthlyCost`. Therefore on any
user-built model:

- `isResilient()` is false everywhere → cascade paints everything red, Coach reports SPOFs everywhere
- revenue-at-risk ticks **$0.00/hr**

**Resilience** and **Money** exist specifically to close this. They are not optional polish.

### 2.4 Classes that cannot carry redundancy

`supportsRedundancy()` is true only where the class has a `redundancy` metadata field. It is
**absent** on: `Storage Volume`, `Ingress`, `Certificate`, `Key Vault`,
`Secret`, `Network Segment`, `Subnet`, `DNS Record`, `Namespace`, `Workload`, `Pod`,
`Container`, `Container Image`, `Infrastructure CI`, `Application Service`, `Application`.

**Resilience** must skip the redundancy question for these (asking would collect an answer
nothing reads).
`Load Balancer` **does** carry `redundancy` (added to the schema after this spec was written) —
it is a canonical redundancy device and no longer reads as an automatic SPOF.

---

## 3. Question tree

Stages run in this order. Each stage name is also its key in the answer store:

```
Infrastructure → Anchor → Environments → Ownership → Capability → Consumers → Resilience → Money → Review
```

The order is declared in one place — `const ORDER` in `interview.js`, immediately after
`STAGE_DEFS`. The definition order of the stage objects is deliberately *not* the question order;
change `ORDER` alone to re-sequence.

**Why Infrastructure leads.** People can describe what they have long before they can name a
capability. Opening on "what does it all run on?" asks for something the user already knows, and
every later question then has concrete nouns to refer back to. The revenue spine is unaffected
because the draft is built once, at the end (§2.1).

Two consequences of moving it first, both handled:

- The **self-reference drop**. Infrastructure is parsed before the service is named, so
  "the billing portal runs on two app servers" can turn the service into a dependency of itself.
  `dropSelfTerms()` runs on the Anchor and Ownership reads, removes any infra term matching those
  names, and *announces it on the next screen* — design rule 1 forbids doing that silently.
- **Anchor-less drafts.** `buildDraft()` tolerates a null `prodId`, `appId` and empty `capIds`.
  Infrastructure then self-nests along the hosting spine and the topmost node is emitted as an
  orphan claim explaining that nothing above it can carry a failure.

**Skipping.** Every stage is skippable. `Skip this` does not advance — it renders the stage's
`cost()`, which names the features that stop working (blast radius, revenue-at-risk, Coach,
Impact Analysis, the Portfolio Dashboard rollup), and only then offers `Skip it anyway` against a
primary `Go back and answer it`. Going Back into a skipped stage un-skips it.

`gaps()` recomputes what is missing **from the answers, not from the skip flags**, so pressing
Next on an empty stage reports identically to pressing Skip. It feeds `skipSummary()` on both the
review screen and the payoff. Skipping **Anchor** additionally hides **Environments** via that
stage's `hidden()` predicate — there is nothing to have copies of.

`Consumers` presents its sub-questions on one screen. `Infrastructure` parses one free-text box
and auto-nests (see that stage for why it is not iterative). `Review` has three parts: review the
proposal, fire the payoff, the closing question.

**Phase scope gates whole stages.** Every class carries a `phase` (Crawl / Walk / Run / Fly); the
active scope is a multi-select in the status bar under **Learn ▾ ▸ CSDM Phase**, owned by `app.js`
(`activePhases`, `inPhaseScope`, `outOfPhaseNote`) and only *read* here via `inScope()`. A stage
whose output class is outside the scope is hidden through the same `hidden()` predicate that hides
Environments:

| stage | needs | phase |
| --- | --- | --- |
| anchor, environments | Application Service | Crawl |
| ownership | Business Application | Crawl |
| capability | Business Capability | Walk |
| consumers | Business Service | Run |
| infrastructure | any infra class | Crawl (mostly) |

`money` is **not** gated — `monthlyCost` still applies — but its revenue table swaps in a message
naming the phase when Business Capability is out of scope, because "Go Back to the business-activity
question" is wrong advice when that question was never asked.

Three rules this must keep:

- A hidden stage is reported with its own `cost()`, in a banner on every screen. Design rule 1
  applies to the phase boundary as much as to a skip: a question that silently disappears teaches
  nothing. `gaps()` excludes hidden stages, so a phase-gated question never reads as "unanswered".
- A term the parser resolved to an out-of-scope class is **dropped, never re-pointed** at a class
  the user did not say (`dropOutOfPhaseTerms`), and the drop is announced. It is *reversible* —
  widening the scope restores the term from `phaseDrop`, so following the advice in the banner does
  not cost the user a retype. `selfDrop` and a user-chosen `SKIP` are never restored.
- `buildDraft()` re-checks `inScope()` on every fixed class even though the stages are hidden. The
  scope can be changed from the Learn menu mid-interview (`onPhaseScopeChange`), and a stale answer
  must not become a node of a class the builders had already stopped offering.

Notation per question:

- **id** — stable key for the answer store. Convention: a single-question stage uses the bare
  stage name (`capability`); named sub-questions are dotted (`consumers.offering`); repeats keyed
  by depth or node are bracketed (`resilience[${nodeId}]`).
- **ask** — prompt text, in the user's language (never a CSDM class name)
- **control** — UI affordance
- **creates** — exact nodes/edges written (class names verbatim from `nodeTypes`)
- **teaches** — narration template shown in the review pass
- **branch** — routing

All narration must use **template literals** (backticks) — apostrophes in single-quoted strings
have broken `app.js` before (see CLAUDE.md).

### Global rule: reuse, never duplicate

Every stage that names a node must **match against the existing model before creating one**:
case-insensitive exact match on `label` + `type` → reuse that node's id and mark the claim
`reused`. Two corollaries:

1. **Edges need their own guard.** When both endpoints are reused, the edge may already exist.
   Check `edges.some(e => e.from === f && e.to === t && (e.label || e.relationship) === l)` and
   mark the claim `already` — rendered informationally, with no checkbox, and skipped on commit.
2. **Reuse is a feature, not just hygiene.** *Two Business Applications providing the same
   Business Capability* is exactly the shape that makes the shared-impact contrast demo work
   (`csdmData.shared-infra-example.json`). The review card should say so.

Together these make the interview **idempotent**: re-describing something already modelled adds
0 nodes and 0 edges and says so, rather than silently minting a second `Equity Trading`.

### Anchor — start from pain

> **id** `anchor`
> **ask** — "What is the one thing that, if it broke right now, someone would call you about?"
> **control** — free text (name) + optional paste of a longer description → lexicon pass (§4)
> **creates** — `Application Service` named as given, `metadata.environment = 'Production'`
> **teaches**
> > You named `${label}`. In CSDM that is an **Application Service** — the thing that actually
> > runs and can break. It is the only layer failure simulation starts from, which is why we
> > start here rather than at the top of the model.
> **branch** — always → **Environments**

Rationale: starting from pain seeds the closing demo *and* gives the impact engine its origin
node. Starting from Business Capability (as the Guided Path does) requires the user to already
know CSDM.

### Environments — the Instantiates lesson

> **id** `environments`
> **ask** — "Does `${anchor}` run in more than one place — production, staging, a DR copy?"
> **control** — multi-select `[Production, Staging, Test, Development, Disaster Recovery]`, Production pre-checked
> **creates** — one additional `Application Service` per extra environment, label
> `` `${anchor} (${env})` ``, `metadata.environment = env`
> **teaches**
> > Each environment is its **own Application Service**, not a copy of one. That is deliberate:
> > when staging goes down, production must not look degraded. One Business Application will
> > *Instantiate* all of them.
> **branch** — ≥2 selected → **Ownership** (the Instantiates lesson lands harder); else → **Ownership**
> **note** — reuse `commitAddEnvironment()`, which already clones an Application Service and its
> infra subtree and re-points the `Instantiates` edge. Do not reimplement.

### Ownership — funding and the Business Application

> **id** `ownership`
> **ask** — "Who owns and funds `${anchor}` as a product? What is it called on a budget line or a roadmap?"
> **control** — text (name) + text (support group → `metadata.owner`)
> **creates** — `Business Application`; edge `Business Application --Instantiates--> Application Service` for **every** node created by **Anchor** and **Environments**
> **teaches**
> > This is the split people get wrong most often. `${appLabel}` is the **Business Application** —
> > the thing you fund, own, and put on a roadmap; there is exactly one. The running copies from
> > the last question are **Application Services**; there are ${n}. The Business Application
> > *Instantiates* each one.
> > *CSDM rule:* `${explanation('Business Application','Application Service','Instantiates')}`
> **branch** — always → **Capability**
> **why here** — first half of the revenue spine (§2.1).

### Capability — business purpose

> **id** `capabilities` — an **array**; one entry per activity
> **ask** — "If `${appLabel}` were down all day, what could the business no longer do? Name activities, not systems."
> **control** — **repeatable rows** (add / remove), each row a text input backed by a `<datalist>`
> of existing `Business Capability` labels
> **creates** — one `Business Capability` per row; one
> `Business Application --Provides--> Business Capability` edge per row. Both are legal
> many-to-many; nothing in `relationshipRules` constrains cardinality.
> **teaches**
> > Each row is a **Business Capability** — a timeless noun describing *what the business
> > does*, never how. It outlives the application that supports it. One application can provide
> > several. These edges are what let an infrastructure failure be reported as a business
> > consequence instead of a red icon.
> > *CSDM rule:* `${explanation('Business Application','Business Capability','Provides')}`
> **branch**
> - user names something that is clearly a system (matches lexicon infra/app groups) → re-ask once: "That sounds like a system. What does the business *do* with it?"
> - **2+ rows** → foreshadow the double-count hazard (below), then → **Consumers**
> - else → **Consumers**
> **why here** — completes the revenue spine. After **Capability** the model can carry money.
>
> **Why plural is the default, not an edge case.** `affectedRevenuePerHour()` *reduces over every
> affected `Business Capability`* — the engine sums them. A single-value question under-serves it.
>
> **The double-count hazard — asked here, guarded in Money.**
> `Business Capability --Contains--> Business Capability` is legal, and `Contains` is **not** in
> `IMPACT_REVERSE_LABELS`, so it propagates source→target:
> ```
> Business Application --Provides--> "Billing" --Contains--> "Invoicing"
> ```
> A failure reaching `Billing` also reaches `Invoicing`. A revenue figure on **both** is counted
> twice. So a bare "add another" button would be actively misleading.
>
> The hierarchy question therefore lives **here**, not in Money: when 2+ rows are filled, an
> optional *"Do any of these roll up into one bigger activity?"* appears (parent name + child
> tickboxes). It has to be here so that Money can give the parent its own revenue row — without
> that row the double-count guard has nothing to catch. Rows re-render on change so the question
> appears as soon as a second activity is named.
>
> Two refusals: a parent with fewer than two children, and a parent naming one of its own children
> (*"a capability cannot contain itself"*). Within-form duplicates are collapsed case-insensitively
> — that is form noise, not a modelling lesson.

### Consumers — promises and the Sell/Consume layer

Four sub-questions, each independently skippable.

> **id** `consumers.type`
> **ask** — "Who consumes this — your own staff, external customers, or both?"
> **control** — single-select `[Internal, External, Internal & External]`
> **creates** — `Business Service`; edges `Business Service --Provides--> Business Capability`,
> `metadata.consumerType`
> **teaches**
> > A **Business Service** is the consumable face of the capability — what a consumer thinks
> > they are buying. It is a *design/commercial* artifact, so it cannot be failure-simulated
> > directly (it is in `NON_OPERATIONAL_TYPES`); it goes red only because something under it did.

> **id** `consumers.offering`
> **ask** — "Is it offered at more than one level — gold/silver, 24x7 vs business hours, regional tiers?"
> **control** — repeatable text rows, or "just one"
> **creates** — one `Service Offering` per row; edges `Business Service --Offers--> Service Offering`
> and `Service Offering --Depends on--> Application Service` (anchor)
> **teaches**
> > The **Service Offering** is where commitments and price live — the same Business Service can
> > be offered several ways. The Offering *Depends on* the running Application Service; that edge
> > is the second path by which failure becomes a business consequence.

> **id** `consumers.commitment`
> **ask** — "What did you promise for this — uptime target, support hours?"
> **control** — text (availability target) + select `[24x7, Business Hours (8x5), Extended Hours (16x5)]`
> **creates** — `metadata.availabilityTarget` / `supportHours` on the Offering; `Service Commitment`
> node + `Service Offering --Contains--> Service Commitment` if a target was given
> **teaches**
> > A promise you can name is a **Service Commitment**. Modelling it means the tool can later
> > tell you not just that something broke, but that you broke a promise.

> **id** `consumers.catalog` *(skip by default; offer as "advanced")*
> **ask** — "Can someone request this from a catalogue, or subscribe to it?"
> **creates** — `Service Catalog --Contains--> Catalog Item`, `Catalog Item --Depends on--> Service Offering`,
> and/or `Subscription --Depends on--> Service Offering` (+ `metadata.userCount`)
> **teaches** — Subscription is modelled as a relationship to an Offering, not a CI table.

### Infrastructure — the descent

**Implemented differently from the original plan, deliberately.** One free-text box, parsed by the
lexicon, then auto-nested — instead of six sequential "and what does *that* sit on?" questions.
Six modal steps to reach a rack is a worse experience and teaches nothing extra; the existing
Topology Builder remains the tool for precise manual deepening.

> **id** `infrastructure`
> **ask** — "What does `${anchor}` run on, or need to work?"
> **control** — one textarea; lexicon-parsed on Next. Terms that hit an **ambiguity trap** or are
> unrecognised re-render the stage as a resolution list — a trap shows its disambiguating options,
> an unknown shows a full class picker. Nothing proceeds until every term is resolved or skipped.

#### Auto-nesting rules (three, and all three were learned the hard way)

**1. Never use `Contains` for the dependency spine.** `Contains` is not in
`IMPACT_REVERSE_LABELS`, so it propagates *away* from the parent. A chain built from it renders
perfectly and produces **no cascade at all**. Only `Depends on` / `Runs on` / `Uses` carry a
failure upward. Prefer `Runs on` for hosting classes, `Depends on` otherwise.

**2. Hosting and runtime nest down a spine; everything else attaches to the service.**

| Family | Members | Parents to |
|---|---|---|
| **Hosting** | clusters, `Compute Node`, `VM`, `Physical Host`, `Rack`, `Data Center`, `Availability Zone`, `Cloud Region`, `Infrastructure CI` | deepest spine node with a lower `level` |
| **Runtime** | `Namespace`, `Workload`, `Pod`, `Container`, `Container Image` | same — it is a containment hierarchy under the cluster |
| **Leaf** | `Database Instance`, `Storage Volume`, `Load Balancer`, `Ingress`, `Certificate`, `Key Vault`, `Secret`, `Network Segment`, `Subnet`, `DNS Record` | the **Application Service** directly |

Parenting a database to a VM is not merely inelegant, it is **wrong in a way that silently
destroys the payoff**: `absorbs()` applies to any reverse edge regardless of label, so a
`Redundant pair` of VMs would "absorb" a database outage and the cascade would never reach the
business. Observed live — failing the DB reached nothing and revenue read `$0` despite a figure
being set. Leaves belong to the service that depends on them.

**3. Nest by `nodeTypes[].level`, but only within the spine.** Choosing "deepest placed node with
a lower level" over *all* nodes produced `Database Instance --Runs on--> Rack A1`, because the DB
happened to be deepest. Restricting the search to spine members fixes it.

If no legal parent exists (a `Cloud Region` with nothing between it and the Application Service —
that pair has no valid label), the node is kept, left unconnected, and shown under **Could not
connect** with the reason.

#### Quantity is redundancy, not duplication

`two VMs` creates **one** CI with `redundancy: 'Redundant pair'` pre-selected — not two nodes
(`three`/`several` → `HA cluster`). This is the correct CSDM answer *and* the better lesson: two
separate nodes could not absorb anything, whereas one CI with a redundancy value can. The review
card explains the substitution.

Generic labels are flagged. When a fragment is only the class word (`a load balancer`), the node
is labelled with the class name and tagged **unnamed — rename later** rather than being called
`a load balancer`.

> **id** `infrastructure[${depth}]`
> **ask (depth 0)** — "What does `${anchor}` sit on? Name whatever comes to mind — VMs, a cluster, a database, a load balancer."
> **ask (depth n)** — "And what does `${parentLabel}` sit on or need?"
> **control** — free text → lexicon pass (§4); unmatched terms fall through to a class picker
> restricted to `getRulesFromType(parentType)` so only legal targets are offered
> **creates** — the matched class; edge chosen from `getValidRelationshipLabels(parentType, childType)`,
> defaulting to `Runs on` when legal, else `Depends on`
> **teaches** (per node)
> > You said **"${sourcePhrase}"** → **${class}**. ${lexiconWhy}
> > *CSDM rule:* `${explanation(parentType, childType, label)}`
> **branch**
> - lexicon returns an ambiguity trap (§4.9) → ask the disambiguating question first
> - matched class is in `infrastructureTypes()` and has children in the mesh → offer to descend
> - user names a CSDM 5 wrapper concept (database *service*, network *service*) → create the
>   matching `* Service Instance` and teach the generalization

### Resilience — writes `metadata.redundancy`

Asked **once per created node where `supportsRedundancy(type)` is true**. Batch them into one
screen — a grid, one row per node — not N modal steps.

> **id** `resilience[${nodeId}]`
> **ask** — "`${label}` — what is the biggest loss it survives?"
> **control** — single-select, options mapped to real metadata values:
>
> | Option shown | Writes | Survives up to |
> |---|---|---|
> | "There is only one" | `Single instance` | nothing |
> | "There is a second one standing by" | `Redundant pair` | a rack |
> | "It is a cluster that tolerates node loss" | `HA cluster` | an availability zone |
> | "It scales itself out automatically" | `Auto-scaling` | an availability zone |
>
> **teaches**
> > This is the single most valuable field in the model. Without it every node reads as a single
> > point of failure and the blast radius is meaningless. With it, resilient nodes *absorb* a
> > failure and show amber instead of red.
> > Note the ceiling: a standby pair survives losing a rack, but not losing the whole data centre.
> **skip** — types in §2.4. Show a one-line note: "`${label}` has no redundancy field in this
> schema, so it will always read as a single point of failure."

### Money — writes `revenueAmount` / `monthlyCost`

> **id** `money.revenue[${capId}]` — asked **once per capability** from the Capability stage
> **ask** — "Roughly what is an hour of `${capLabel}` being unavailable worth? A yearly revenue figure is fine — or skip and give a user count instead."
> **control** — amount + period select `[per year, per month, per week, per day, per hour]`,
> batched into one screen with a running total when there are several capabilities
> **creates** — `metadata.revenueAmount` / `revenuePeriod` **on the `Business Capability`**
> **hierarchy sub-question** (only when the Capability stage produced 2+):
> > "Are any of these really parts of one bigger activity?" → optionally create a parent
> > `Business Capability` + `Business Capability --Contains--> Business Capability` edges.
> **double-count guard** — if a figure is entered on both a parent and one of its children,
> refuse to silently sum and explain why: *"a failure that reaches `${parent}` also reaches
> `${child}`, so both figures would be counted. Put the money at one level."* That interruption
> is a better lesson than the question it interrupts.
> **teaches**
> > Revenue attaches to the **Business Capability**, not to a server — because that is the level
> > at which money is actually earned. The ticker you are about to see divides this figure down
> > to a per-second burn rate while the outage runs.
> **critical** — this is the only class `affectedRevenuePerHour()` reads. Do not offer it elsewhere.

> **id** `money.cost[${nodeId}]` *(optional, batched into the **Resilience** grid)*
> **ask** — "Monthly cost, if you know it?" per node where `monthlyCost` exists
> **creates** — `metadata.monthlyCost`
> **teaches** — feeds Impact Analysis cost view and the Portfolio Dashboard rollup.

### Review — then the payoff

Three parts, in order: **Review the proposal**, **Fire the payoff**, **The closing question**.

**Review the proposal.** Render every node and edge as a claim card:

```
[✓] Billing Portal (Production)          Application Service
    from your words: "the thing customers log into"
    why: the running instance — the layer that can actually fail
    rule: —
    [accept] [reject] [explain more]
```

Nothing touches the canvas until the user accepts. On accept:

1. `migrateModel(draft)`
2. `validateGraph(draft)`
3. any edge rejected by `getAllowedRelationship` is surfaced as a teaching card:
   *"I proposed `${from} --${label}--> ${to}` and your own CSDM rules rejected it. Valid labels
   between these classes: `${getValidRelationshipLabels(from,to)}`."*
4. commit through `markChange()` so the whole interview is one undo step

**Fire the payoff.** Do not end on "done". Pick the demo target in this order:

1. a node with `redundancy === 'Single instance'` that the most Business Capabilities depend on
2. else the deepest infra node on the anchor's dependency path
3. else the anchor itself

Then, in sequence: `simulateFailure(target)` → `startFailureCostTicker()` → banner text
> "You told me `${label}` is the only one. Here is what that costs."

followed by buttons into `openDashboardDialog()` and Coach.

**The closing question.** If any `Cloud Region` or `Data Center` exists, offer one more
simulation: fail the region. Because `HA cluster` tolerance caps at 4 and Cloud Region ranks 5,
**nothing absorbs it** — the whole model goes red. Narration:

> Every redundancy option in this schema tops out below "whole region". Nothing you can tick in
> that grid survives this. The only fix is a second region in the model — which is the point.

---

## 4. Lexicon

A deterministic term → class map. Purpose is twofold: fill in obvious classes, **and** teach why
the user's word implies that class. Unmatched terms are not failures — they become
**Infrastructure** questions.

### 4.1 Matching rules

- Case-insensitive, word-boundary regex against the raw phrase.
- Longest match wins (`kubernetes cluster` before `cluster`).
- **Ambiguity traps (§4.9) are checked FIRST and always beat a class match** — a trap must ask,
  never guess.
- Every entry carries a `why` string: one sentence, in the user's register, explaining the
  mapping. This string is what the review card renders.
- Record the matched substring as `sourcePhrase` so the review card can quote it verbatim.

### 4.2 Compute & orchestration

| Pattern | Class | why |
|---|---|---|
| `k8s`, `kubernetes`, `eks`, `aks`, `gke`, `openshift` | `Kubernetes Cluster` | A managed container platform — the cluster is the failure domain, not the individual pod. |
| `vsphere`, `esx(i)?`, `vcenter`, `hyper-?v`, `virtualization cluster` | `Virtualization Cluster` | A hypervisor cluster: it can move guests between hosts, so it survives losing one host. |
| `compute cluster`, `hpc`, `slurm` | `Compute Cluster` | A pool of machines treated as one resource. |
| `node pool`, `worker node`, `compute node` | `Compute Node` | One member of a cluster — a member, not the pool. |

### 4.3 Runtime

| Pattern | Class | why |
|---|---|---|
| `vm`, `virtual machine`, `ec2`, `guest`, `instance` (see trap) | `VM` | A guest machine: it runs on something, and that host is a separate failure domain. |
| `namespace`, `ns` | `Namespace` | A logical partition inside a cluster. |
| `deployment`, `statefulset`, `daemonset`, `workload` | `Workload` | The declared desired state, not the running copy. |
| `pod` | `Pod` | The smallest schedulable unit — usually replaceable, so rarely the real risk. |
| `container` | `Container` | A running process from an image. |
| `image`, `docker image`, `container image` | `Container Image` | A build artifact — it cannot fail at runtime; it is a design CI. |

### 4.4 Data & storage

| Pattern | Class | why |
|---|---|---|
| `postgres`, `psql`, `mysql`, `mariadb`, `oracle`, `sql server`, `mssql`, `mongo`, `redis`, `db2`, `rds`, `aurora` | `Database Instance` | A specific running database — the classic single point of failure, which is why the next question asks how many there are. |
| `san`, `nas`, `volume`, `ebs`, `datastore`, `lun`, `pvc`, `persistent volume` | `Storage Volume` | Block or file storage attached to something else. |
| `data service`, `database service`, `db platform` | `Data Service Instance` | A *service wrapper* around storage — CSDM 5 lets you model "the database service we offer" separately from the database itself. |

### 4.5 Network

| Pattern | Class | why |
|---|---|---|
| `f5`, `nginx` (as LB), `haproxy`, `alb`, `nlb`, `elb`, `load ?balancer` | `Load Balancer` | Distributes traffic — and it is usually the redundant thing in front of everything else, so ask what it survives. |
| `ingress`, `ingress controller`, `api gateway` | `Ingress` | The cluster's front door for inbound traffic. |
| `vlan`, `network segment`, `vpc` | `Network Segment` | A broadcast/routing boundary. |
| `subnet`, `cidr` | `Subnet` | An address range inside a segment. |
| `dns`, `cname`, `a record`, `route ?53`, `dns record` | `DNS Record` | A name pointing at an address — cheap to model and a surprisingly common outage cause. |
| `network service`, `connectivity service` | `Network Service Instance` | The service wrapper around network plumbing. |

### 4.6 Security

| Pattern | Class | why |
|---|---|---|
| `cert`, `certificate`, `tls`, `ssl` | `Certificate` | Expires on a date — a scheduled outage waiting to happen. |
| `vault`, `key vault`, `kms`, `hsm` | `Key Vault` | Holds secrets; everything that reads from it depends on it. |
| `secret`, `credential`, `api key` | `Secret` | An individual stored credential. |

### 4.7 Cloud & physical

| Pattern | Class | why |
|---|---|---|
| `region`, `us-east`, `eu-west`, `cloud region` | `Cloud Region` | The largest failure domain in this model — and nothing in the redundancy list survives losing one. |
| `az`, `availability zone` | `Availability Zone` | An isolated site inside a region. |
| `data ?cent(er|re)`, `dc\d?`, `colo` | `Data Center` | A physical site. A standby pair does **not** survive losing one. |
| `rack`, `cabinet` | `Rack` | A physical enclosure — everything in it shares power and cooling. |
| `blade`, `bare ?metal`, `physical host`, `hypervisor host` | `Physical Host` | A physical machine; the smallest physical failure domain. |

### 4.8 Facility

| Pattern | Class | why |
|---|---|---|
| `ups`, `battery` | `UPS` | Backup power — the thing that makes a power cut survivable. |
| `pdu`, `power strip`, `power distribution` | `PDU` | Distributes power within a rack. |
| `generator`, `genset`, `diesel` | `Generator` | Long-run backup power. |
| `crac`, `cooling`, `air handler` | `CRAC Unit` | Cooling; without it the room shuts itself down. |
| `chiller` | `Chiller` | Supplies chilled water to cooling units. |
| `facility service`, `power service`, `cooling service` | `Facility Service Instance` | The service wrapper letting a Physical Host *Depend on* "power and cooling" as one thing. |

### 4.9 Ambiguity traps — MUST ask, never guess

The most important section. These words are genuinely ambiguous in CSDM; guessing teaches a
falsehood. Each routes to a disambiguating question whose *asking* is itself the lesson.

| Trigger word | Disambiguating question | Options → class |
|---|---|---|
| `service` (bare) | "Which kind of 'service' do you mean?" | "something customers buy" → `Business Service` · "a running system that can break" → `Application Service` · "a capability IT offers to other IT teams" → `Technical Service` · "a systemd/Windows service" → `Application` |
| `app`, `application`, `system`, `platform` | "Do you mean the product you fund and own, or the copy that is running right now?" | funded product → `Business Application` · running copy → `Application Service` · a deployable piece inside it → `Application` |
| `cluster` (bare) | "What kind of cluster?" | containers → `Kubernetes Cluster` · VMs/hypervisor → `Virtualization Cluster` · general compute pool → `Compute Cluster` |
| `server`, `box`, `host`, `machine` | "Physical or virtual?" | physical → `Physical Host` · virtual → `VM` · a cluster member → `Compute Node` |
| `database`, `db` | "The database itself, or the database service your team offers?" | the instance → `Database Instance` · the offered service → `Data Service Instance` |
| `environment`, `prod`, `staging`, `dev` | *(not a class)* "Environment is not a thing in CSDM — it is a property of an Application Service. Which service is this the staging copy of?" | → `metadata.environment` on an `Application Service` |
| `instance` (bare) | "Instance of what — a VM, a database, or a service?" | → `VM` / `Database Instance` / `* Service Instance` |
| `offering`, `tier`, `gold`, `silver` | "Is this a commercial tier of something, or a technical difference?" | commercial → `Service Offering` · technical → separate `Application Service` |
| `sla`, `uptime`, `99.9`, `24x7` | *(not a node by default)* "That is a promise — should I record it as a Service Commitment?" | → `Service Commitment` + `metadata.availabilityTarget` |

### 4.10 Lexicon entry shape

```js
{ pattern: /\b(postgres|psql|mysql|mariadb|oracle|sql ?server|mssql|mongo|redis)\b/i,
  type: 'Database Instance',
  why: `A specific running database — the classic single point of failure, which is why the next question asks how many there are.`,
  followUp: 'resilience' }        // forces a Resilience row even if batching is skipped
```

Traps use the same shape with `ask` instead of `type`.

---

## 5. Coverage check — question → feature lit up

| Question | Metadata / structure written | Feature it makes work |
|---|---|---|
| Anchor | `Application Service`, `environment` | failure simulation origin |
| Environments | multiple `Application Service` | Instantiates lesson; per-env blast isolation |
| Ownership | `Business Application` + `Instantiates` | revenue spine (half) |
| Capability | 1..n `Business Capability` + a `Provides` each | revenue spine (complete); "why this node matters" |
| Consumers | `Business Service`, `Service Offering`, `Service Commitment` | Sell/Consume layer; second impact path |
| Infrastructure | infra chain | blast radius, cascade depth, lineage |
| **Resilience** | **`redundancy`** | **`isResilient`, amber absorb, Coach SPOF, What-If** |
| **Money** | **`revenueAmount` on Capability** | **revenue-at-risk ticker, Dashboard rollup** |
| Review | — | the payoff |

**Resilience** and **Money** are the two rows that are currently always empty on user-built
models. If the
interview shipped with only those two questions it would still be worth building.

---

## 6. LLM front door — BUILT (`interviewParse.js`)

Strictly additive; the interview works with no API key.

- `POST /api/interview/parse` registered from `interviewParse.js`, `ANTHROPIC_API_KEY` from env
  only. The SDK is `require`d lazily, so a missing dependency degrades to 501 rather than
  taking the server down.
- Single `client.messages.create` call, `model: 'claude-haiku-4-5'`, `output_config.format` with
  a JSON schema whose `type` enum is `Object.keys(nodeTypes)` — generated at request time so the
  model cannot invent a class. No `thinking`, and **no `output_config.effort`** (Haiku 4.5 errors
  on it); extraction against a fixed enum does not need either.
- Required per item: `sourcePhrase`, `label`, `type`, `why`, `ambiguous`, `candidates`, `count`,
  `redundancy`. `redundancy` carries an explicit `'unknown'` member so an unstated one stays a
  **Resilience** question instead of being inferred.
- **Deviation from the original draft: no `label` enum, and the LLM emits no edges.** It extracts
  *things* only. Relationships are still built deterministically in `buildDraft()`, because the
  spine must use `IMPACT_REVERSE_LABELS` or the cascade silently dies (§2.3) — that invariant is
  not something a model gets a vote on.
- The enum makes an invented class impossible, but the model still controls free text and array
  lengths, so `sanitize()` re-checks every field server-side before it reaches the client.
- The CSDM primer + class table are cached with `cache_control`. **Haiku 4.5's minimum cacheable
  prefix is 4096 tokens** — below that this silently does nothing, which is why the endpoint logs
  `cache read`/`write` per call. Check that log before assuming caching is working.
- The response **pre-fills the interview**; the user still walks **Review**. The LLM never
  authors a rule.
- **Ambiguity still belongs to the user.** `ambiguous: true` (or an unknown class) routes back
  into the §4.9 traps via `pickTrap()` in `interview.js`, which prefers the hand-written trap
  whose options overlap the model's `candidates`, then the head noun. The model's `candidates`
  only build a question when no trap matches. An LLM that confidently resolves "app servers"
  deletes the best teaching moment in the interview, so it is not allowed to.
- No key, no SDK, a non-2xx, or malformed JSON → the client falls back to §4 verbatim and says
  which parser ran.

---

## 7. Open issues

1. ~~**`Load Balancer` has no `redundancy` metadata field**~~ — **fixed**: `Load Balancer` now
   carries the standard `redundancy` select in `shared/csdmSchema.js`. `Storage Volume` still
   does not, and is the same kind of gap (mirrored volumes / replicated datastores are real).
2. ~~`CLAUDE.md` says "~35 `nodeTypes`"~~ — **fixed**, it now says 50.
3. Should **Consumers** create a `Business Service --Provides--> Business Capability` edge *and* the
   `Business Application --Provides--> Business Capability` edge? Both are legal and both carry
   impact. Two paths to the same Capability may double-count nothing (it is a `Set`) but will
   make the cascade animation busier. Recommend: create both, they are both true.
4. Interview answers should probably persist to `metadata.interviewAnswers` on the anchor so the
   interview can be re-opened and amended rather than re-run.
