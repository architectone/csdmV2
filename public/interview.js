/* Interview Mode — Anchor / Environments / Ownership / Capability / Consumers /
   Infrastructure / Resilience / Money / Review. See INTERVIEW_MODE_SPEC.md.
   Prose uses template literals only (apostrophes in single-quoted strings have broken app.js). */
(function () {
  const ENVS = ['Production', 'Staging', 'Test', 'Development', 'Disaster Recovery'];
  const PERIODS = ['per hour', 'per day', 'per month', 'per year'];
  const REVERSE = new Set(['Depends on', 'Runs on', 'Uses', 'Instantiates', 'Offers']);
  /* Classes where "runs on" reads better than "depends on". These form the hosting spine:
     Application Service -> cluster -> VM -> Physical Host -> Rack -> Data Center -> Region. */
  const HOSTING = new Set(['Physical Host', 'VM', 'Compute Node', 'Compute Cluster', 'Kubernetes Cluster',
    'Virtualization Cluster', 'Rack', 'Data Center', 'Availability Zone', 'Cloud Region', 'Infrastructure CI']);
  /* The container hierarchy nests under the cluster, so it rides the spine too. */
  const RUNTIME = new Set(['Namespace', 'Workload', 'Pod', 'Container', 'Container Image']);
  /* Everything else is a dependency of the SERVICE, not of the box the service runs on.
     Hanging a database off a VM is actively wrong: a redundant VM pair would then "absorb"
     a database outage, and the cascade would never reach the business at all. */
  /* `rank` is REDUNDANCY_SCOPE_RANK in app.js. A node absorbs a failure only when its rank is
     at least the origin's FAILURE_DOMAIN_RANK (Physical Host 1, Rack 2, Data Center 3, AZ 4,
     Cloud Region 5) — so the wording has to name the precondition, not just the ceiling. A pair
     of VMs in ONE rack does not survive that rack; rank 2 is a claim that the pair is split
     across two. Nothing reaches 5, deliberately. */
  const REDUNDANCY = [
    { v: 'Single instance', rank: 0, label: `There is only one of it`, survives: `nothing — anything under it takes it down` },
    { v: 'Redundant pair', rank: 2, label: `A second one on standby, in a different rack`, survives: `losing a host or a rack — but not a data centre` },
    { v: 'HA cluster', rank: 4, label: `A cluster that keeps serving when a member dies, spread across zones`, survives: `losing a host, rack, data centre or zone — but not a region` },
    { v: 'Auto-scaling', rank: 4, label: `It replaces lost capacity by itself, across zones`, survives: `losing a host, rack, data centre or zone — but not a region` }
  ];
  let S = null;
  /* Last known server answer. The stage bodies render synchronously, so the status has
     to be already in hand — every fetch writes it here and re-renders whatever is open. */
  let llmConfig = { llmAvailable: false, apiKeyConfigured: false, source: null, hint: '', model: '' };

  /* ---------- helpers ---------- */
  function esc(v) { return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
  function schema() { return window.CSDM_SCHEMA; }
  function lex() { return window.CSDM_LEXICON; }
  function model() { return typeof currentModelData !== 'undefined' ? currentModelData : { nodes: [], edges: [] }; }
  function newId(type) { return `${schema().nodeTypes[type].prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`; }
  function levelOf(type) { const t = schema().nodeTypes[type]; return t && typeof t.level === 'number' ? t.level : 99; }
  function ruleText(f, t, l) { const r = schema().getAllowedRelationship(f, t, l); return r ? r.explanation : ''; }
  function snClass(t) { return typeof serviceNowClass === 'function' ? serviceNowClass(t) : ''; }
  function snRel(l) { return typeof serviceNowRel === 'function' ? serviceNowRel(l) : ''; }
  function existing(type) { return model().nodes.filter(n => n.type === type); }
  const norm = v => String(v ?? '').trim().toLowerCase();
  function findExisting(type, label) { const k = norm(label); return model().nodes.find(n => n.type === type && norm(n.label) === k) || null; }
  function edgeExists(f, t, l) { return model().edges.some(e => e.from === f && e.to === t && (e.label || e.relationship) === l); }
  function dedupe(list) { const seen = new Set(), out = []; list.forEach(v => { const k = norm(v); if (v && !seen.has(k)) { seen.add(k); out.push(v); } }); return out; }
  function mkey(type, label) { return `${type}|${norm(label)}`; }
  /* A quantified term becomes ONE CI carrying a redundancy value, so its name has to read as
     one thing — a node called "VMs" sitting next to one called "VM" is the same machine twice
     with no way for the user to tell them apart. Only applied to quantified terms, and never
     to a label that is already a class name. */
  function singular(v) {
    const s = String(v ?? '').trim();
    if (!/s$/i.test(s) || /(?:ss|us|is|as)$/i.test(s)) return s;
    return /ies$/i.test(s) ? s.replace(/ies$/i, 'y') : s.replace(/s$/i, '');
  }
  function hasField(type, key) { try { return (schema().getMetadataFields(type) || []).some(f => f.key === key); } catch (e) { return false; } }
  function canRedundancy(type) { return typeof supportsRedundancy === 'function' ? supportsRedundancy(type) : hasField(type, 'redundancy'); }
  function money(v) { return typeof formatMoney === 'function' ? formatMoney(v) : `$${Number(v || 0).toFixed(2)}`; }

  /* ---------- CSDM adoption phase scope ----------
     app.js owns the scope (Learn menu ▸ CSDM Phase); the interview only reads it. Each guard
     defaults to permissive so this module still runs if app.js is ever loaded without it.
     The scope decides which STAGES are asked at all — a shop at Crawl is never asked about
     business capabilities or service commitments, because those classes are not in play yet
     and a question you cannot use the answer to is a question that teaches the wrong thing. */
  function inScope(type) { return typeof inPhaseScope === 'function' ? inPhaseScope(type) : true; }
  function scopeIsAll() { return typeof phaseScopeIsAll === 'function' ? phaseScopeIsAll() : true; }
  function scopeLabel() { return typeof phaseScopeLabel === 'function' ? phaseScopeLabel() : `all phases`; }
  function phaseOf(type) { return typeof classPhase === 'function' ? classPhase(type) : ''; }
  function phaseNote(types, intro) { return typeof outOfPhaseNote === 'function' ? outOfPhaseNote(types, intro) : ''; }
  function scopedInfraTypes() { try { return schema().infrastructureTypes().filter(inScope); } catch (e) { return []; } }
  /* The scope can be changed from the Learn menu while the interview is open. Re-read it,
     re-drop whatever no longer fits, and re-render — silently keeping a Run-phase claim in a
     Crawl-scoped draft would put a class on the canvas the builders had just refused to offer. */
  function onPhaseScopeChange() {
    if (!S) return;
    dropOutOfPhaseTerms();
    S.draft = null;
    if (S.i < STAGES.length && hiddenStage(STAGES[S.i])) S.i = nextIndex(S.i);
    if (!document.getElementById('modal-backdrop').classList.contains('hidden')) renderStage();
  }
  /* A term the parser resolved to an out-of-scope class. Dropped, never re-pointed at a class
     the user did not name — and said out loud on the next screen, exactly like dropSelfTerms.
     REVERSIBLE, and that matters: the note tells the user to widen the scope, so widening it has
     to bring the term back by itself. Making them retype a sentence the parser already read
     correctly would punish them for following the instruction. Only a term WE dropped for phase
     comes back — `selfDrop` and a user-chosen SKIP both stay exactly where the user left them. */
  function dropOutOfPhaseTerms() {
    (S.answers.infra || []).forEach(t => {
      const w = `${t.label || t.term} [${t.type}]`;
      if (t.phaseDrop && t.type && !t.selfDrop && inScope(t.type)) {
        t.skip = false; t.phaseDrop = false;
        S.notes.phaseDropped = (S.notes.phaseDropped || []).filter(x => x !== w);
        S.notes.phaseDroppedNew = (S.notes.phaseDroppedNew || []).filter(x => x !== w);
        S.notes.phaseRestoredNew = S.notes.phaseRestoredNew || [];
        if (!S.notes.phaseRestoredNew.includes(w)) S.notes.phaseRestoredNew.push(w);
        return;
      }
      if (t.skip || !t.type || inScope(t.type)) return;
      t.skip = true; t.phaseDrop = true;
      S.notes.phaseDropped = S.notes.phaseDropped || []; S.notes.phaseDroppedNew = S.notes.phaseDroppedNew || [];
      S.notes.phaseRestoredNew = (S.notes.phaseRestoredNew || []).filter(x => x !== w);
      if (!S.notes.phaseDropped.includes(w)) { S.notes.phaseDropped.push(w); S.notes.phaseDroppedNew.push(w); }
    });
  }

  /* Pick a label that (a) is legal and (b) propagates failure from child up to parent.
     Only IMPACT_REVERSE_LABELS do that — `Contains` would silently break the cascade. */
  function pickLabel(parentType, childType) {
    const valid = schema().getValidRelationshipLabels(parentType, childType) || [];
    const order = HOSTING.has(childType) ? ['Runs on', 'Depends on', 'Uses'] : ['Depends on', 'Uses', 'Runs on'];
    return order.find(l => valid.includes(l)) || valid.find(l => REVERSE.has(l)) || null;
  }

  /* ---------- infrastructure term resolution ---------- */
  /* One free-text answer names several things — `scan` returns one finding per thing, so a
     whole sentence resolves rather than collapsing onto whichever class matched first. */
  function parseInfra(text) {
    const self = [S.answers.anchor, S.answers.ownership].filter(Boolean).map(norm);
    /* runsOn/dependsOn come from the words the splitter broke on — the same fields the LLM
       fills, so buildDraft() treats a stated pairing identically whichever parser produced it. */
    const hints = m => ({ runsOn: m.runsOn || '', dependsOn: m.dependsOn || [] });
    const out = lex().scan(text).map(m => {
      if (m.kind === 'class') return Object.assign({ term: m.term, label: m.label, type: m.type, why: m.why, phrase: m.phrase, generic: m.generic, count: m.count }, hints(m));
      if (m.kind === 'trap') return Object.assign({ term: m.term, label: m.label, type: '', why: m.trap.why, trapKey: m.trap.key, ask: m.trap.ask, options: m.trap.options, phrase: m.phrase, generic: m.generic, count: m.count }, hints(m));
      return Object.assign({ term: m.term, label: m.label, type: '', why: `I did not recognise this word, so you tell me what it is.`, unknown: true, generic: false, count: m.count }, hints(m));
    /* The service being described is not a dependency of itself. */
    }).filter(t => !self.includes(norm(t.label)) && !self.includes(norm(t.term)));
    return out.slice(0, 40);
  }
  /* Two fragments can land on the same class with the same generic label — "two app servers"
     and "a VM" both become VM. Merging them would lose a machine the user described; keeping
     both would put two identically-named nodes on the canvas. So the second one falls back to
     the user's own words instead. */
  function normalizeInfra() {
    const seen = new Map(), key = t => `${t.type || t.trapKey || 'u'}|${norm(t.label)}`;
    const free = (t, l) => l && !seen.has(`${t.type || t.trapKey || 'u'}|${norm(l)}`);
    /* Fold the plural back to one name FIRST, so "two VMs" and "a VM" collide below and become
       a single CI with a count — rather than surviving as "VMs" and "VM", which is the same
       machine on the canvas twice with only one of them carrying the redundancy answer. */
    (S.answers.infra || []).forEach(t => {
      if (t.skip || !t.label || (t.count || 1) < 2) return;
      if (t.type && schema().nodeTypes[t.label]) return;
      const one = singular(t.label);
      if (one && norm(one) !== norm(t.label)) { t.label = one; if (t.type) t.generic = norm(one) === norm(t.type); }
    });
    (S.answers.infra || []).forEach(t => {
      if (t.skip) return;
      const prev = seen.get(key(t));
      if (!prev) { seen.set(key(t), t); return; }
      /* The same words twice is one thing said twice — keep the larger count. */
      if (norm(prev.term) === norm(t.term)) { prev.count = Math.max(prev.count || 1, t.count || 1); t.skip = true; return; }
      /* Two terms that both fell back to the bare class name are not two distinguishable
         things — "VM" and "VM 2" is a distinction the user never made. Merge them and keep the
         larger count, so the quantity lands in the redundancy field where it belongs. */
      if (prev.generic && t.generic) { prev.count = Math.max(prev.count || 1, t.count || 1); t.skip = true; return; }
      const mine = lex().strip(t.term), theirs = lex().strip(prev.term);
      if (free(t, mine) && norm(mine) !== norm(t.label)) { t.label = mine; t.generic = false; seen.set(key(t), t); return; }
      /* "two app servers" and "a VM" both resolve to VM, and it is the earlier one that has
         the distinctive words — so rename that one rather than dropping this one. */
      if (free(prev, theirs) && norm(theirs) !== norm(prev.label)) { seen.delete(key(prev)); prev.label = theirs; prev.generic = false; seen.set(key(prev), prev); seen.set(key(t), t); return; }
      for (let i = 2; i < 20; i++) { const l = `${t.label} ${i}`; if (free(t, l)) { t.label = l; seen.set(key(t), t); return; } }
      t.skip = true;
    });
    /* Infrastructure is now asked after the service is named, so the self-reference runs the
       other way: the anchor is already known when the parse happens. Hooked here rather than at
       each call site so no future parse path can skip it — a service that depends on itself is
       a silently wrong cascade. dropSelfTerms is idempotent. */
    dropSelfTerms();
    dropOutOfPhaseTerms();
  }
  function pendingInfra() { return (S.answers.infra || []).filter(t => !t.type && !t.skip); }
  /* "two VMs" pre-selects `Redundant pair` — quantity belongs in the redundancy field. */
  function seedRedundancy() {
    const r = S.answers.redundancy = S.answers.redundancy || {};
    (S.answers.infra || []).forEach(t => {
      if (!t.type || t.skip || !canRedundancy(t.type)) return;
      const k = mkey(t.type, t.label);
      if (r[k]) return;
      /* Only when the user said it outright — an inferred answer here would be a
         guess dressed up as their own words, and the whole Resilience stage rests on it. */
      if (t.redundancy && t.redundancy !== 'unknown') { r[k] = t.redundancy; return; }
      if ((t.count || 1) > 1) r[k] = (t.count || 2) > 2 ? 'HA cluster' : 'Redundant pair';
    });
  }

  /* ---------- LLM front door (INTERVIEW_MODE_SPEC.md §6) ---------- */
  /* Strictly additive. The server answers 501 with no API key, and every failure
     path lands on the lexicon, so the interview works offline exactly as before. */
  function parseWithLLM(text) {
    return fetch('/api/interview/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, anchor: S.answers.anchor || '', app: S.answers.ownership || '' })
    }).then(r => r.json().catch(() => ({})).then(body => {
      if (r.status === 501) { const e = new Error(body.error || 'unavailable'); e.unavailable = true; throw e; }
      if (!r.ok) throw new Error(body.error || `The parser returned ${r.status}.`);
      if (!Array.isArray(body.items)) throw new Error(`The parser returned nothing usable.`);
      return body;
    }));
  }

  /* ---------- capture ---------- */
  /* The whole point is the pairing: `input` is exactly what was typed, `terms` is what the
     parser made of it, `built` is what buildDraft() produced, and `expected` is what the user
     says it should have been. Diffing those is how the draft builder gets tuned — guessing
     from a description of the output never works. */
  function readExpected() { const el = document.getElementById('iv-expected'); if (el) S.expected = el.value || ''; }
  function captureRecord(phase, d, extra) {
    const a = S.answers;
    const name = id => { const n = d.nodes.concat(d.reusedNodes).find(x => x.id === id); return n ? `${n.label} [${n.type}]` : id; };
    return Object.assign({
      phase,
      parser: S.parseSource || (llmConfig.llmAvailable ? { llm: true, model: llmConfig.model, note: 'not yet run' } : { llm: false, note: 'built-in vocabulary' }),
      input: {
        infrastructure: a.infraText || '',
        anchor: a.anchor || '', application: a.ownership || '', owner: a.owner || '',
        environments: a.environments || [],
        capabilities: (a.capabilities || []).filter(c => String(c).trim()),
        capParent: a.capParent || null, consumers: a.consumers || null,
        redundancy: a.redundancy || {}, revenue: a.revenue || {}, cost: a.cost || {}
      },
      skipped: Object.keys(S.skipped || {}),
      selfDropped: S.notes.selfDropped || [],
      terms: (a.infra || []).map(t => ({
        term: t.term, phrase: t.phrase || '', label: t.label, type: t.type || null,
        trapKey: t.trapKey || null, unknown: !!t.unknown, skipped: !!t.skip, selfDropped: !!t.selfDrop,
        count: t.count || 1, runsOn: t.runsOn || '', dependsOn: t.dependsOn || [], why: t.why
      })),
      built: {
        newNodes: d.nodes.map(n => `${n.label} [${n.type}]`),
        reusedNodes: d.reusedNodes.map(n => `${n.label} [${n.type}]`),
        edges: d.edges.map(e => `${name(e.from)} --${e.label}--> ${name(e.to)}`),
        unconnected: d.claims.filter(c => c.orphan).map(c => c.toLabel)
      },
      expected: S.expected || ''
    }, extra || {});
  }
  function capture(phase, d, extra) {
    return fetch('/api/interview/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(captureRecord(phase, d, extra))
    }).then(r => r.json()).catch(err => ({ success: false, error: err.message }));
  }
  function saveComparison() {
    readExpected();
    const btn = document.getElementById('iv-save-cmp');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    capture('review', S.draft || buildDraft()).then(r => {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = r && r.success ? `Saved ${r.file}` : `Could not save — ${(r && r.error) || 'unknown error'}`;
    });
  }

  /* Several traps can match one phrase ("app servers" hits `app`, `server` AND `appserver`).
     The model's own candidate list says which question it was actually unsure about, so that
     wins. Failing that the LONGEST match wins, matching how the lexicon resolves overlaps in
     rawMatches() — scoring by m.index instead let the bare `server` inside "app server" win,
     which is how the Application tier became unreachable. */
  function pickTrap(term, candidates) {
    const t = String(term || ''), cands = candidates || [];
    let best = null, bestScore = -1;
    (lex().traps || []).forEach(tr => {
      const m = t.match(tr.pattern);
      if (!m) return;
      const overlap = (tr.options || []).filter(o => o.type && cands.includes(o.type)).length;
      const score = overlap * 1000 + m[0].length * 10 + m.index;
      if (score > bestScore) { bestScore = score; best = tr; }
    });
    return best;
  }

  /* The model proposes; the traps still fire. An ambiguous term is handed back to
     the user as a question rather than resolved silently — that question is the
     most valuable moment in the interview, so the LLM never gets to skip it. */
  function fromLLM(items) {
    const self = [S.answers.anchor, S.answers.ownership].filter(Boolean).map(norm);
    return items.map(it => {
      const term = it.sourcePhrase || it.label;
      const known = it.type && schema().nodeTypes[it.type];
      if (known && !it.ambiguous) {
        const label = it.label || it.type;
        return { term, label, type: it.type, why: it.why || `The model chose ${it.type}.`, phrase: it.sourcePhrase, generic: norm(label) === norm(it.type), count: it.count || 1, redundancy: it.redundancy, runsOn: it.runsOn || '', dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [] };
      }
      /* Prefer the hand-written trap: its wording is the teaching, not a paraphrase. */
      const trap = pickTrap(term, it.candidates);
      if (trap) return { term, label: '', type: '', why: trap.why, trapKey: trap.key, ask: trap.ask, options: trap.options, phrase: it.sourcePhrase, generic: true, count: it.count || 1, redundancy: it.redundancy, runsOn: it.runsOn || '', dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [] };
      const cands = (it.candidates || []).filter(c => schema().nodeTypes[c]);
      if (cands.length > 1) return { term, label: '', type: '', why: it.why || `These words map to more than one class, so I will not guess.`, trapKey: `llm:${norm(term)}`, ask: `Which of these is “${term}”?`, options: cands.map(c => ({ label: c, type: c })), phrase: it.sourcePhrase, generic: true, count: it.count || 1, redundancy: it.redundancy, runsOn: it.runsOn || '', dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [] };
      return { term, label: it.label || '', type: '', why: it.why || `I did not recognise this word, so you tell me what it is.`, unknown: true, phrase: it.sourcePhrase, generic: false, count: it.count || 1, redundancy: it.redundancy, runsOn: it.runsOn || '', dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [] };
    }).filter(t => !self.includes(norm(t.label)) && !self.includes(norm(t.term))).slice(0, 40);
  }

  /* Which parser is in play — shown before the answer is read as a promise, and after
     it as a fact, because a fallback that happens silently is a fallback you debug twice. */
  function parserBadge() {
    if (S.parseSource) {
      return S.parseSource.llm
        ? `<div class="iv-source iv-source-llm"><span class="iv-led"></span>Read by <strong>${esc(S.parseSource.model)}</strong>${S.parseSource.note ? ` — ${esc(S.parseSource.note)}` : ''}</div>`
        : `<div class="iv-source iv-source-lex"><span class="iv-led"></span>Read with the <strong>built-in vocabulary</strong> — ${esc(S.parseSource.note)}</div>`;
    }
    return llmConfig.llmAvailable
      ? `<div class="iv-source iv-source-llm"><span class="iv-led"></span>Your answer will be read by <strong>${esc(llmConfig.model || 'the model')}</strong>. Change this under <strong>Parser</strong> in the status bar.</div>`
      : `<div class="iv-source iv-source-lex"><span class="iv-led"></span>Your answer will be read with the <strong>built-in vocabulary</strong>. Add an API key under <strong>Parser</strong> in the status bar to use the model instead.</div>`;
  }

  function runParse(text) {
    S.parsing = true;
    renderStage();
    parseWithLLM(text).then(body => {
      S.answers.infra = fromLLM(body.items);
      const u = body.usage || {};
      S.parseSource = { llm: true, model: body.model || 'the model', note: u.cacheRead ? `${u.cacheRead} cached tokens reused` : '' };
    }).catch(err => {
      S.answers.infra = parseInfra(text);
      S.parseSource = { llm: false, note: err && err.unavailable ? `no API key is configured` : `the model call failed: ${err.message}` };
    }).then(() => {
      S.parsing = false;
      S.parsedText = text;
      normalizeInfra();
      seedRedundancy();
      if (pendingInfra().length) renderStage();
      else { S.i++; renderStage(); }
    });
  }

  /* A sentence like “the billing portal runs on two app servers” can make the service a
     dependency of itself. Whatever is named as the anchor or the application gets pulled back
     out of the term list — and said out loud, because a silent drop is a silent guess.
     Runs from normalizeInfra (the parse already knows the anchor) and from the anchor and
     ownership reads (in case either is renamed after the infrastructure stage). */
  function dropSelfTerms() {
    const self = [S.answers.anchor, S.answers.ownership].filter(Boolean).map(norm);
    if (!self.length) return;
    (S.answers.infra || []).forEach(t => {
      if (t.skip || !(self.includes(norm(t.label)) || self.includes(norm(t.term)))) return;
      t.skip = true; t.selfDrop = true;
      const w = t.term || t.label;
      S.notes.selfDropped = S.notes.selfDropped || []; S.notes.selfDroppedNew = S.notes.selfDroppedNew || [];
      if (!S.notes.selfDropped.includes(w)) { S.notes.selfDropped.push(w); S.notes.selfDroppedNew.push(w); }
    });
  }

  /* ---------- stages ---------- */
  /* Definition order below is NOT question order — see ORDER after the array. */
  const STAGE_DEFS = [
    {
      id: 'anchor', title: `What breaks?`, skippable: true,
      /* No Application Service class in scope means nothing to name here. */
      hidden: () => !inScope('Application Service'),
      lead: () => { const n = (S.answers.infra || []).filter(t => t.type && !t.skip).length;
        return n ? `You have given me ${n} thing${n === 1 ? '' : 's'}. Not one of them is what somebody rings you about — so name that now.` : `Outages start here, not at the top of a diagram. One question:`; },
      ask: `What is the one thing that, if it broke right now, someone would call you about?`,
      hint: `Use whatever you actually call it — “the billing portal”, “Charles River”, “the claims system”.`,
      clear: () => { S.answers.anchor = ''; },
      cost: () => `There will be no <strong>Application Service</strong> — the only layer failure simulation can start from. Whatever infrastructure you name later lands on the canvas with nothing above it to carry a failure upward, so blast radius, revenue-at-risk and Impact Analysis all have no starting point.`,
      body: () => `<div class="field full"><label>Name it</label><input id="iv-anchor" placeholder="e.g. Billing Portal" value="${esc(S.answers.anchor || '')}" list="iv-anchor-list">
        <datalist id="iv-anchor-list">${existing('Application Service').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist></div>
        <div class="path-step-help">Whatever you name here becomes an <strong>Application Service</strong> — the layer that actually runs and can fail. It is the only layer failure simulation can start from, which is why everything you just listed has to hang off it.</div>`,
      read: () => { const v = (document.getElementById('iv-anchor').value || '').trim(); if (!v) return `Give it a name so we have something to hang the model on.`; S.answers.anchor = v; dropSelfTerms(); }
    },
    {
      id: 'environments', title: `How many copies of it are running?`, skippable: true,
      /* Nothing to copy if there is no service — the question would be meaningless. */
      hidden: () => !!S.skipped.anchor || !inScope('Application Service'),
      lead: () => `You said <strong>${esc(S.answers.anchor)}</strong>.`,
      ask: `Does it run in more than one place?`,
      hint: `Tick every environment that exists today. Production is assumed.`,
      clear: () => { S.answers.environments = ['Production']; },
      cost: () => `Production only. Staging, test and DR will not be in the model, so an outage in one cannot be told apart from an outage in another — which is the entire reason they are separate Application Services.`,
      body: () => `<div class="form-grid">${ENVS.map((e, i) => `<div class="field"><label><input type="checkbox" class="iv-env" value="${esc(e)}" ${(S.answers.environments || ['Production']).includes(e) ? 'checked' : ''} ${i === 0 ? 'disabled' : ''}> ${esc(e)}</label></div>`).join('')}</div>
        <div class="path-step-help">Each environment becomes its <strong>own Application Service</strong> — not a copy of one. That is deliberate: when staging falls over, production must not look degraded.</div>`,
      read: () => { S.answers.environments = [...document.querySelectorAll('.iv-env')].filter(c => c.checked || c.disabled).map(c => c.value); if (!S.answers.environments.length) S.answers.environments = ['Production']; }
    },
    {
      id: 'ownership', title: `Who owns and funds it?`, skippable: true,
      hidden: () => !inScope('Business Application'),
      lead: () => { const n = (S.answers.environments || ['Production']).length;
        return S.answers.anchor ? `${esc(S.answers.anchor)} is running in ${n} place${n > 1 ? 's' : ''}. Now the part people get wrong most often.` : `Now the part people get wrong most often.`; },
      ask: `What is this called on a budget line or a roadmap? Who supports it?`,
      hint: `Often the same word you just used — but sometimes the vendor or product name.`,
      clear: () => { S.answers.ownership = ''; S.answers.owner = ''; },
      cost: () => `No <strong>Business Application</strong>. The chain from your infrastructure stops dead at the running service and never reaches a business activity, so revenue-at-risk stays ${esc(money(0))}/hour however much money you enter afterwards, and Impact Analysis can only ever report technical blast radius.`,
      body: () => `<div class="form-grid"><div class="field full"><label>Product / application name</label><input id="iv-app" placeholder="e.g. Billing Platform" value="${esc(S.answers.ownership || '')}" list="iv-app-list">
        <datalist id="iv-app-list">${existing('Business Application').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist></div>
        <div class="field full"><label>Support group (optional)</label><input id="iv-owner" placeholder="e.g. Revenue Systems Team" value="${esc(S.answers.owner || '')}"></div></div>
        <div class="path-step-help">This is the <strong>Business Application</strong> — the thing you fund, own, and put on a roadmap. There is exactly <em>one</em>. ${S.answers.anchor ? `The running copies from the last question are Application Services; there are ${(S.answers.environments || ['Production']).length}. One <em>Instantiates</em> the others.` : `You skipped the running service, so there are no Application Services for it to instantiate — this will sit on the canvas on its own.`}<br><span class="ps-rule">Rule:</span> ${esc(ruleText('Business Application', 'Application Service', 'Instantiates'))}</div>`,
      read: () => { const v = (document.getElementById('iv-app').value || '').trim(); if (!v) return `Name the funded product, even if it matches what you typed earlier.`; S.answers.ownership = v; S.answers.owner = (document.getElementById('iv-owner').value || '').trim(); dropSelfTerms(); }
    },
    {
      id: 'capability', title: `What would the business be unable to do?`, skippable: true,
      /* Business Capability is a Walk class. At Crawl scope there is nowhere to put the answer. */
      hidden: () => !inScope('Business Capability'),
      lead: () => `The question that makes the money work.`,
      ask: `If ${'${app}'} were down all day, what could the business no longer do?`,
      hint: `Name activities, not systems. Add a row for everything that would stop.`,
      clear: () => { S.answers.capabilities = []; S.answers.capParent = null; },
      cost: () => `No <strong>Business Capability</strong> — and that is the only class in CSDM that can carry a revenue figure. Revenue-at-risk will read ${esc(money(0))}/hour whatever else you fill in, the money question after this will have nothing to ask about, and cost impact in Impact Analysis will have infrastructure cost with no business value to weigh it against.`,
      body: () => {
        const caps = S.answers.capabilities && S.answers.capabilities.length ? S.answers.capabilities : [''];
        return `<div id="iv-cap-rows">${caps.map((c, i) => `<div class="field full"><label>Business activity${caps.length > 1 ? ` ${i + 1}` : ''}</label>
            <div class="iv-row"><input class="iv-cap" placeholder="e.g. Customer Billing" value="${esc(c)}" list="iv-cap-list" onchange="CSDM_IV.refreshCaps()">
            ${caps.length > 1 ? `<button type="button" class="iv-x" title="Remove" onclick="CSDM_IV.delCap(${i})">&times;</button>` : ''}</div></div>`).join('')}</div>
          <datalist id="iv-cap-list">${existing('Business Capability').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist>
          <div class="iv-addrow"><button type="button" class="inline-action" onclick="CSDM_IV.addCap()">+ Add another activity</button></div>
          <div class="path-step-help">Each row becomes a <strong>Business Capability</strong> — a timeless noun for <em>what the business does</em>, never how. It outlives the application under it, and it is the <strong>only</strong> class that carries a revenue figure. One application can provide several.<br><span class="ps-rule">Rule:</span> ${esc(ruleText('Business Application', 'Business Capability', 'Provides'))}</div>
          ${caps.filter(c => c.trim()).length > 1 ? (() => { const p = S.answers.capParent || { name: '', children: [] };
            return `<div class="path-step"><span class="path-step-title">Do any of these roll up into one bigger activity?</span>
              <div class="path-step-help">Optional, but it changes where the money goes. If they roll up, a revenue figure on both the parent and a child would be <strong>counted twice</strong> — a failure that reaches the parent also reaches the child, because <em>Contains</em> propagates downward. Naming the parent here means the next stage can stop you doing that.</div>
              <div class="field full"><label>Parent activity (optional)</label><input id="iv-capparent" placeholder="e.g. Revenue Operations" value="${esc(p.name || '')}"></div>
              <div class="form-grid">${caps.filter(c => c.trim()).map(c => `<div class="field"><label><input type="checkbox" class="iv-capchild" value="${esc(c)}" ${(p.children || []).includes(c) ? 'checked' : ''}> ${esc(c)}</label></div>`).join('')}</div></div>`; })() : ''}`;
      },
      read: () => {
        const v = dedupe([...document.querySelectorAll('.iv-cap')].map(i => (i.value || '').trim()));
        if (!v.length) return `Name at least one business activity — this is what makes revenue-at-risk possible.`;
        S.answers.capabilities = v;
        const pn = document.getElementById('iv-capparent');
        if (pn) {
          const name = (pn.value || '').trim(), children = [...document.querySelectorAll('.iv-capchild')].filter(c => c.checked).map(c => c.value);
          if (name && children.length < 2) return `Tick at least two activities that roll up into “${name}” — or clear the parent name.`;
          if (name && v.some(c => norm(c) === norm(name))) return `“${name}” is already one of the activities above. A capability cannot contain itself.`;
          S.answers.capParent = name ? { name, children } : null;
        } else S.answers.capParent = null;
      }
    },
    {
      id: 'consumers', title: `Who consumes it, and what did you promise?`, skippable: true,
      /* The whole Sell/Consume layer is Run. Nothing here can be built below that. */
      hidden: () => !inScope('Business Service'),
      lead: () => `The commercial layer. Skip it if nobody outside your team consumes this.`,
      ask: `Who consumes ${'${app}'} — and what was promised?`,
      hint: `All optional. Leave the consumer blank to skip this whole layer.`,
      clear: () => { S.answers.consumers = null; },
      cost: () => `No <strong>Business Service</strong>, <strong>Service Offering</strong> or <strong>Service Commitment</strong>. An outage can be reported as broken infrastructure but never as a broken promise, and the second path by which a failure becomes a business consequence — the offering that <em>Depends on</em> the running service — will not exist.`,
      body: () => {
        const c = S.answers.consumers || {}, tiers = c.tiers && c.tiers.length ? c.tiers : [''];
        return `<div class="form-grid"><div class="field"><label>Who consumes it</label>
            <select id="iv-consumer"><option value="">— skip this layer —</option>
              ${['Internal', 'External', 'Internal & External'].map(o => `<option ${c.consumerType === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
          <div class="field"><label>Service name (optional)</label><input id="iv-bizsvc" placeholder="e.g. ${esc(S.answers.anchor || 'Billing')} Service" value="${esc(c.serviceName || '')}" list="iv-bizsvc-list">
            <datalist id="iv-bizsvc-list">${existing('Business Service').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist></div></div>
          <div class="path-step-help">A <strong>Business Service</strong> is the consumable face of the capability — what a consumer thinks they are buying. It is a commercial artifact, so it can never be failure-simulated directly (it is in <code>NON_OPERATIONAL_TYPES</code>); it goes red only because something underneath it did.</div>
          <div class="path-step"><span class="path-step-title">Is it offered at more than one level?</span>
            <div class="path-step-help">Gold/silver, 24x7 versus business hours, regional tiers. The <strong>Service Offering</strong> is where commitments and price live, and it <em>Depends on</em> the running Application Service — a second path by which a failure becomes a business consequence.</div>
            <div id="iv-tier-rows">${tiers.map((t, i) => `<div class="field full"><div class="iv-row"><input class="iv-tier" placeholder="e.g. Gold — 24x7" value="${esc(t)}">
              ${tiers.length > 1 ? `<button type="button" class="iv-x" title="Remove" onclick="CSDM_IV.delTier(${i})">&times;</button>` : ''}</div></div>`).join('')}</div>
            <div class="iv-addrow"><button type="button" class="inline-action" onclick="CSDM_IV.addTier()">+ Add another tier</button></div></div>
          <div class="path-step"><span class="path-step-title">What did you promise?</span>
            <div class="path-step-help">A promise you can name becomes a <strong>Service Commitment</strong>. Modelling it means the tool can later tell you not just that something broke, but that you broke a promise.</div>
            <div class="form-grid"><div class="field"><label>Availability target</label><input id="iv-avail" placeholder="e.g. 99.9%" value="${esc(c.availability || '')}"></div>
              <div class="field"><label>Support hours</label><select id="iv-hours">${['24x7', 'Business Hours (8x5)', 'Extended Hours (16x5)'].map(o => `<option ${c.supportHours === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div></div></div>`;
      },
      read: () => {
        const consumerType = document.getElementById('iv-consumer').value;
        const tiers = dedupe([...document.querySelectorAll('.iv-tier')].map(i => (i.value || '').trim()));
        S.answers.consumers = consumerType ? {
          consumerType,
          serviceName: (document.getElementById('iv-bizsvc').value || '').trim() || `${S.answers.anchor} Service`,
          tiers, availability: (document.getElementById('iv-avail').value || '').trim(),
          supportHours: document.getElementById('iv-hours').value
        } : null;
      }
    },
    {
      id: 'infrastructure', title: `What is it running on?`, skippable: true,
      hidden: () => !scopedInfraTypes().length,
      lead: () => S.answers.anchor
        ? `Back down the stack. <strong>${esc(S.answers.anchor)}</strong> has to run on something.`
        : `You skipped naming the service, so this is the part you can actually point at. It will land on the canvas — just with nothing above it to carry a failure upward.`,
      ask: () => S.answers.anchor ? `What does <strong>${esc(S.answers.anchor)}</strong> run on, or need to work?` : `What does it all run on?`,
      hint: `List it or just say it in a sentence — commas, new lines, or plain prose like “two app servers that connect to a database on a VM”. I will pull out each thing, sort out the CSDM classes, and show you my reasoning.`,
      clear: () => { S.answers.infra = []; S.answers.infraText = ''; S.parsedText = ''; S.parseSource = ''; },
      cost: () => `Nothing lands underneath the service, so there is <strong>nothing that can fail</strong>. Blast radius is a single node, Coach finds no single points of failure because there are no components to be single, and the Portfolio Dashboard has no cost or resilience to roll up. You can add it later with the Topology builder.`,
      body: () => {
        if (S.parsing) return `<div class="explain-box"><strong>Reading what you wrote…</strong> I am pulling out each thing you named and working out which CSDM class it is. Anything genuinely ambiguous I will hand back to you rather than guess.</div>
          ${llmConfig.llmAvailable ? `<div class="iv-source iv-source-llm"><span class="iv-led"></span>Asking <strong>${esc(llmConfig.model || 'the model')}</strong>… if it fails I fall back to the built-in vocabulary.</div>` : `<div class="iv-source iv-source-lex"><span class="iv-led"></span>Using the <strong>built-in vocabulary</strong>.</div>`}`;
        /* `!t.skip` matters: a term dropped for being out of phase scope (or for naming the
           service itself) must not still be listed as something I recognised and kept. */
        const pend = pendingInfra(), resolved = (S.answers.infra || []).filter(t => t.type && !t.skip);
        if (pend.length) {
          return `<div class="explain-box"><strong>${pend.length} term${pend.length > 1 ? 's need' : ' needs'} a decision from you.</strong> I will not guess these — guessing would teach you something false.</div>
            ${pend.map((t, i) => {
              const idx = S.answers.infra.indexOf(t);
              /* An answer outside the phase scope is not offered — the same rule the Guided Path
                 and Topology builders follow. The dropped options are named underneath so the
                 boundary is visible rather than looking like a gap in the vocabulary. */
              const allOpts = t.options ? t.options : null;
              const opts = allOpts ? allOpts.filter(o => !o.type || inScope(o.type)) : null;
              const pickable = Object.keys(schema().nodeTypes).filter(t2 => typeof isPickableClass !== 'function' || isPickableClass(t2));
              const dropped = allOpts ? allOpts.filter(o => o.type && !inScope(o.type)).map(o => o.type) : pickable;
              return `<div class="path-step"><span class="path-step-title">&ldquo;${esc(t.term)}&rdquo;</span>
                <div class="path-step-help">${esc(t.ask || `I do not have this word in my vocabulary.`)}<br><em>${esc(t.why)}</em></div>
                <select class="iv-resolve" data-idx="${idx}">
                  <option value="">— choose —</option>
                  ${opts ? opts.map(o => `<option value="${esc(o.type || 'SKIP')}">${esc(o.label)}</option>`).join('')
                    : pickable.filter(inScope).sort().map(t2 => `<option value="${esc(t2)}">${esc(`${t2} · ${phaseOf(t2)}`)}</option>`).join('')}
                  <option value="SKIP">Leave this out of the model</option>
                </select>
                ${phaseNote(dropped, opts && !opts.length ? `Every answer to this question is outside your phase scope (${scopeLabel()}), so the only option left is to leave it out:` : `Not offered as an answer at your phase scope (${scopeLabel()}):`)}</div>`;
            }).join('')}
            ${resolved.length ? `<div class="path-step-help">Already resolved: ${resolved.map(t => `<strong>${esc(t.label)}</strong> [${esc(t.type)}]`).join(', ')}.</div>` : ''}
            ${parserBadge()}`;
        }
        return `<div class="field full"><label>Everything it runs on or needs</label>
            <textarea id="iv-infra" placeholder="e.g. two app servers that connect to a postgres database hosted on a VM in us-east-1">${esc(S.answers.infraText || '')}</textarea></div>
          <div class="path-step-help">I will nest these by depth using each class level in the schema, and connect them with <em>Depends on</em> / <em>Runs on</em> rather than <em>Contains</em> — deliberately. Only those labels carry a failure <em>upward</em> to your service; a chain built from <em>Contains</em> looks right on the canvas and produces no cascade at all.${scopeIsAll() ? '' : ` <strong>Your phase scope is ${esc(scopeLabel())}</strong>, so I can only place ${scopedInfraTypes().length} of the ${schema().infrastructureTypes().length} infrastructure classes. Name something outside it and I will tell you what it was and which phase would let it in, rather than quietly swapping it for a class you did not say.`}</div>
          ${parserBadge()}
          ${resolved.length ? `<div class="explain-box">Recognised so far: ${resolved.map(t => `<strong>${esc(t.label)}</strong> <span class="muted">[${esc(t.type)}]</span>`).join(', ')}. Edit the box above to change them.</div>` : ''}`;
      },
      read: () => {
        const pend = pendingInfra();
        if (pend.length) {
          const sel = [...document.querySelectorAll('.iv-resolve')];
          if (sel.some(s => !s.value)) return `Make a call on each term — or choose “Leave this out of the model”.`;
          sel.forEach(s => {
            const t = S.answers.infra[Number(s.dataset.idx)]; if (!t) return;
            if (s.value === 'SKIP') { t.skip = true; return; }
            t.type = s.value;
            /* Keep the user's own words for the name where they said anything at all — a node
               called "App Server" reads better than a second one called "VM", and quoting them
               back is the whole teaching method. Only fall back to the class name when they
               named nothing ("a server" -> Physical Host). */
            if (!t.label || t.generic) {
              const own = lex().strip(t.term || '');
              t.label = own && norm(own) !== norm(s.value) ? own : s.value;
              t.generic = norm(t.label) === norm(s.value);
            }
            t.why = `${t.why} You chose ${s.value}.`;
          });
          normalizeInfra();
          seedRedundancy();
          return null;
        }
        if (S.parsing) return `_stay`;
        const text = (document.getElementById('iv-infra').value || '').trim();
        S.answers.infraText = text;
        if (!text) { S.answers.infra = []; return; }
        /* Coming Back and pressing Next again should not re-bill the same sentence. */
        if (text === S.parsedText && (S.answers.infra || []).length) {
          normalizeInfra(); seedRedundancy();
          if (pendingInfra().length) { renderStage(); return `_stay`; }
          return;
        }
        runParse(text);
        return `_stay`;
      }
    },
    {
      id: 'resilience', title: `What survives what?`, skippable: true,
      lead: () => `This is the single most valuable answer in the whole interview.`,
      ask: `For each of these — what is the biggest loss it survives?`,
      hint: `Without this every node reads as a single point of failure, and the blast radius means nothing.`,
      /* Clear what was answered ON this screen, then put back what the user's own words
         already said. "two app servers" is a statement, not an unanswered question — wiping
         it turned a redundant pair into a single point of failure behind their back. */
      clear: () => { S.answers.redundancy = {}; seedRedundancy(); },
      cost: () => `Every node reads as a <strong>single point of failure</strong>. The cascade paints the whole model red because nothing absorbs anything, Coach reports SPOFs across the board, and the Resilience/What-If toggle has nothing to toggle.`,
      body: () => {
        const d = buildDraft(), rows = d.nodes.concat(d.reusedNodes).filter(n => canRedundancy(n.type));
        /* Only infra classes are worth flagging — an Application Service having no redundancy
           field is expected, not a gap the user can act on. */
        const isInfra = t => { try { return schema().infrastructureTypes().includes(t); } catch (e) { return false; } };
        const skipped = d.nodes.concat(d.reusedNodes).filter(n => !canRedundancy(n.type) && isInfra(n.type));
        if (!rows.length) return `<div class="explain-box explain-bad"><strong>Nothing you have described can carry a redundancy answer.</strong> ${skipped.length ? `These classes have no <code>redundancy</code> field in this schema, so they will always read as single points of failure: ${skipped.map(n => esc(n.type)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.` : `Go back and add some infrastructure first.`}</div>`;
        return `<table class="iv-grid"><thead><tr><th>What</th><th>Biggest loss it survives</th></tr></thead><tbody>
            ${rows.map(n => { const k = mkey(n.type, n.label), cur = (S.answers.redundancy || {})[k] || '';
              return `<tr><td><strong>${esc(n.label)}</strong><br><span class="muted">${esc(n.type)}</span></td>
                <td><select class="iv-red" data-k="${esc(k)}">${REDUNDANCY.map(o => `<option value="${esc(o.v)}" ${cur === o.v ? 'selected' : ''}>${esc(o.label)} &mdash; survives ${esc(o.survives)}${o.rank ? ` (rank ${o.rank})` : ''}</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table>
          <div class="path-step-help">These are not free-text: each one <em>is</em> a scope rank in the cascade engine. A failure origin also has a rank — one machine (host, VM, container) 1, Rack 2, Data Center 3, Availability Zone 4, Cloud Region 5 — and a node absorbs the failure only when its own rank is <strong>at least</strong> the origin&rsquo;s. So a <em>standby pair</em> (rank 2) absorbs a rack, but a data centre at rank 3 goes straight through it. Note what rank 2 is actually claiming: that the second one is in a <strong>different rack</strong>. Two servers in the same rack are a pair that does not survive the rack.
          <br>This only applies to failures with a <em>scope</em>. When something you depend on dies outright — a database, a load balancer — no amount of redundancy on your side helps, because every copy of you was behind it. Redundancy saves you from losing part of yourself, never from losing what you need.
          <br>Nothing here reaches rank 5, so nothing absorbs a <strong>whole cloud region</strong> — which we will come back to at the end.</div>
          ${skipped.length ? `<div class="explain-box"><strong>${skipped.length} item${skipped.length > 1 ? 's have' : ' has'} no redundancy field in this schema</strong> and will always read as a single point of failure: ${skipped.map(n => `${esc(n.label)} [${esc(n.type)}]`).join(', ')}. That is a gap in the schema, not in your answer.</div>` : ''}`;
      },
      read: () => { const r = S.answers.redundancy = S.answers.redundancy || {}; [...document.querySelectorAll('.iv-red')].forEach(s => { r[s.dataset.k] = s.value; }); }
    },
    {
      id: 'money', title: `What is it worth?`, skippable: true,
      lead: () => `Last stage. This is what turns a red icon into a number someone cares about.`,
      ask: `Roughly what is an hour of downtime worth?`,
      hint: `A yearly revenue figure is fine — the tool divides it down. Leave blank to skip.`,
      clear: () => { S.answers.revenue = {}; S.answers.cost = {}; },
      cost: () => `Revenue-at-risk ticks ${esc(money(0))}/hour and the cost columns in Impact Analysis and the Portfolio Dashboard stay empty. The cascade still runs — it just cannot tell you what it costs.`,
      body: () => {
        const rev = S.answers.revenue || {}, parent = S.answers.capParent;
        /* The parent gets its own row — otherwise the double-count guard has nothing to catch. */
        const caps = (S.answers.capabilities || []).filter(c => String(c).trim());
        if (parent && parent.name) caps.unshift(parent.name);
        const d = buildDraft(), costRows = d.nodes.concat(d.reusedNodes).filter(n => hasField(n.type, 'monthlyCost'));
        /* No capability means no revenue field exists anywhere in the schema to write to —
           so say that, rather than render an empty table that looks like a bug. */
        /* No capability means no revenue field exists anywhere to write to — but WHY there is
           none changes the advice. "Go Back to the business-activity question" is wrong when the
           phase scope is the reason that question was never asked. */
        const revTable = !caps.length
          ? (!inScope('Business Capability')
            ? `<div class="explain-box explain-bad"><strong>There is nothing here that can hold a revenue figure.</strong> <code>revenueAmount</code> exists on exactly one class — <strong>Business Capability</strong> — and that is a <strong>${esc(phaseOf('Business Capability'))}</strong>-phase class, outside your scope of ${esc(scopeLabel())}. So revenue-at-risk will read ${esc(money(0))}/hour, and it cannot be otherwise at this phase. That is the honest answer: money is a ${esc(phaseOf('Business Capability'))} capability of the model, not a Crawl one. Monthly cost below still works.</div>`
            : `<div class="explain-box explain-bad"><strong>There is nothing here that can hold a revenue figure.</strong> <code>revenueAmount</code> exists on exactly one class — <strong>Business Capability</strong> — and you have not named one, so revenue-at-risk can only ever read ${esc(money(0))}/hour. Go Back to the business-activity question if you want that number to work.</div>`)
          : `<table class="iv-grid"><thead><tr><th>Business activity</th><th>Revenue</th><th>Period</th></tr></thead><tbody>
            ${caps.map(c => { const k = mkey('Business Capability', c), v = rev[k] || {}, ex = findExisting('Business Capability', c);
              const already = ex && ex.metadata && ex.metadata.revenueAmount;
              const isParent = parent && parent.name && norm(c) === norm(parent.name);
              return `<tr class="${isParent ? 'iv-parentrow' : ''}"><td><strong>${esc(c)}</strong>${isParent ? ` <span class="iv-tag">parent of ${esc((parent.children || []).length)}</span>` : ''}${already ? `<br><span class="muted">already set to ${esc(ex.metadata.revenueAmount)} ${esc(ex.metadata.revenuePeriod || '')} — changing this edits your existing model</span>` : ''}</td>
                <td><input class="iv-rev" data-k="${esc(k)}" placeholder="e.g. 12000000" value="${esc(v.amount || (already || ''))}"></td>
                <td><select class="iv-per" data-k="${esc(k)}">${PERIODS.map(p => `<option ${(v.period || (ex && ex.metadata && ex.metadata.revenuePeriod) || 'per year') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table>
          <div class="path-step-help">Revenue attaches to the <strong>Business Capability</strong>, not to a server — because that is the level at which money is actually earned. <code>affectedRevenuePerHour</code> sums every capability a failure reaches.</div>`;
        return `${revTable}
          ${parent && parent.name ? `<div class="explain-box"><strong>${esc(parent.name)} contains ${esc((parent.children || []).join(' and '))}.</strong> Put a figure on the parent <em>or</em> on the children — not both. A failure that reaches ${esc(parent.name)} also reaches everything inside it, so two levels of figures would be summed twice.</div>` : ''}
          ${costRows.length ? `<div class="path-step"><span class="path-step-title">Monthly cost, if you know it (optional)</span>
            <div class="path-step-help">Feeds the cost view in Impact Analysis and the Portfolio Dashboard rollup.</div>
            <table class="iv-grid"><tbody>${costRows.map(n => { const k = mkey(n.type, n.label);
              return `<tr><td><strong>${esc(n.label)}</strong> <span class="muted">${esc(n.type)}</span></td><td><input class="iv-cost" data-k="${esc(k)}" placeholder="USD / month" value="${esc((S.answers.cost || {})[k] || '')}"></td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
      },
      read: () => {
        const rev = S.answers.revenue = S.answers.revenue || {}, cost = S.answers.cost = S.answers.cost || {};
        [...document.querySelectorAll('.iv-rev')].forEach(i => { const k = i.dataset.k; rev[k] = rev[k] || {}; rev[k].amount = (i.value || '').trim(); });
        [...document.querySelectorAll('.iv-per')].forEach(s => { const k = s.dataset.k; rev[k] = rev[k] || {}; rev[k].period = s.value; });
        [...document.querySelectorAll('.iv-cost')].forEach(i => { cost[i.dataset.k] = (i.value || '').trim(); });
        /* Double-count guard: a figure on a parent AND on any of its children. */
        const p = S.answers.capParent;
        if (p && p.name && (p.children || []).length) {
          const num = k => Number(String((rev[k] || {}).amount || '').replace(/[^0-9.]/g, '')) || 0;
          const parentHas = num(mkey('Business Capability', p.name)) > 0;
          const kids = p.children.filter(c => num(mkey('Business Capability', c)) > 0);
          if (parentHas && kids.length)
            return `A failure that reaches “${p.name}” also reaches ${kids.join(' and ')}, so both figures would be counted twice. Put the money on one level — clear the figure on “${p.name}”, or clear the ones on its children.`;
        }
      }
    }
  ];

  /* The question order. Infrastructure leads: people can describe what they have long
     before they can name a capability, and starting there means the first screen asks
     for something they already know. Everything after it is skippable — `skip()` states
     the price of each omission rather than letting it pass quietly. */
  /* Question order. Top-down, the way CSDM itself reads: name the service, then who owns it,
     what business ability it serves, who consumes it, and only then what it runs on. Every
     stage is skippable, so a person who does not know the infrastructure just passes it by
     and still ends up with a business-layer model. Re-sequence here and nowhere else —
     STAGE_DEFS is definition order, and both leads and asks branch on what is already known. */
  const ORDER = ['anchor', 'environments', 'ownership', 'capability', 'consumers', 'infrastructure', 'resilience', 'money'];
  const STAGES = ORDER.map(id => STAGE_DEFS.find(s => s.id === id));

  function hiddenStage(s) { return !!(s && typeof s.hidden === 'function' && s.hidden()); }
  function nextIndex(i) { let j = i + 1; while (j < STAGES.length && hiddenStage(STAGES[j])) j++; return j; }
  function prevIndex(i) { let j = i - 1; while (j > 0 && hiddenStage(STAGES[j])) j--; return Math.max(j, 0); }
  function isLast(i) { return nextIndex(i) >= STAGES.length; }

  /* What is actually missing, however it went missing. Pressing Next on an empty stage
     costs exactly what the Skip button costs, so both have to be reported the same way. */
  function gaps() {
    const a = S.answers;
    const miss = {
      infrastructure: !(a.infra || []).some(t => t.type && !t.skip),
      anchor: !a.anchor,
      environments: false,
      ownership: !a.ownership,
      capability: !(a.capabilities || []).some(c => String(c).trim()),
      consumers: !(a.consumers && a.consumers.consumerType),
      resilience: !Object.keys(a.redundancy || {}).some(k => a.redundancy[k] && a.redundancy[k] !== 'Single instance'),
      money: !Object.keys(a.revenue || {}).some(k => String((a.revenue[k] || {}).amount || '').trim())
    };
    return STAGES.filter(s => miss[s.id] && !hiddenStage(s));
  }

  function skipSummary(intro) {
    const g = gaps();
    if (!g.length) return '';
    return `<div class="explain-box explain-bad"><strong>${intro}</strong>
      <ul class="iv-gaps">${g.map(s => `<li><strong>${esc(s.title)}</strong> &mdash; ${typeof s.cost === 'function' ? s.cost() : s.cost}</li>`).join('')}</ul></div>`;
  }

  /* ---------- draft ---------- */
  function buildDraft() {
    const a = S.answers, claims = [], nodes = [], edges = [], reusedNodes = [], metaUpdates = [];
    const red = a.redundancy || {}, rev = a.revenue || {}, cost = a.cost || {};

    function meta(type, label, base) {
      const k = mkey(type, label), m = Object.assign({}, base);
      if (canRedundancy(type) && red[k]) m.redundancy = red[k];
      if (hasField(type, 'monthlyCost') && cost[k]) m.monthlyCost = cost[k];
      if (type === 'Business Capability' && rev[k] && rev[k].amount) { m.revenueAmount = rev[k].amount; m.revenuePeriod = rev[k].period || 'per year'; }
      return m;
    }
    function resolve(type, label, base, newClaim, reusedClaim) {
      const ex = findExisting(type, label), id = ex ? ex.id : newId(type), m = meta(type, label, base);
      if (ex) {
        reusedNodes.push(ex);
        /* Metadata we would change on a node that already exists is its own claim. */
        ['redundancy', 'monthlyCost', 'revenueAmount', 'revenuePeriod'].forEach(key => {
          if (m[key] !== undefined && String((ex.metadata || {})[key] ?? '') !== String(m[key]))
            metaUpdates.push({ id, label, type, key, value: m[key], old: (ex.metadata || {})[key] || null });
        });
      } else nodes.push({ id, label, type, metadata: m });
      claims.push(Object.assign({ kind: 'node', ref: id, label, type, isNew: !ex, reused: !!ex, meta: m }, ex ? reusedClaim : newClaim));
      return id;
    }
    function link(from, to, fromType, toType, label, fromLabel, toLabel, why) {
      if (!label) { claims.push({ kind: 'edge', ref: `${from}|${to}|none`, orphan: true, fromType, toType, fromLabel, toLabel, label: '', why }); return; }
      /* A stated pairing can land on the same edge the stack already implied. Say it once. */
      if (claims.some(c => c.kind === 'edge' && c.ref === `${from}|${to}|${label}`)) return;
      /* Never point two impact-propagating labels at each other. Both directions between the
         same pair is a mutual dependency: each node then takes the other down, the blast radius
         doubles, and whichever one carries redundancy absorbs the other's outage. Whatever was
         claimed first wins, and passes are ordered so a fact the user stated outranks a guess. */
      if (REVERSE.has(label) && claims.some(c => c.kind === 'edge' && !c.orphan && c.from === to && c.to === from && REVERSE.has(c.label))) return;
      const already = edgeExists(from, to, label);
      if (!already) edges.push({ from, to, label });
      claims.push({ kind: 'edge', ref: `${from}|${to}|${label}`, label, from, to, fromType, toType, fromLabel, toLabel, why, already });
    }

    /* Every layer below is optional now — a skipped stage simply contributes nothing, and
       the edges that would have crossed it are guarded rather than emitted against null.
       The `inScope` guards are deliberately redundant with the stage `hidden` flags: the scope
       can be changed from the Learn menu mid-interview, and stale answers must not become nodes
       of a class the builders had already stopped offering. */
    const appId = a.ownership && inScope('Business Application') ? resolve('Business Application', a.ownership, { description: a.ownership, owner: a.owner || '' },
      { asked: `what this is called on a budget line`, why: `The product you fund and own. Exactly one of these, however many copies are running.` },
      { why: `Already in your model, so I am reusing it rather than minting a second one with the same name.` }) : null;

    /* Optional capability parent, created before the children so Contains reads downward. */
    let parentId = null;
    const cp = a.capParent;
    if (cp && cp.name && (cp.children || []).length > 1 && inScope('Business Capability')) {
      parentId = resolve('Business Capability', cp.name, { description: cp.name },
        { why: `You said these roll up into one bigger activity, so this is the parent Business Capability.` },
        { why: `Already in your model — reusing it as the parent.` });
      if (appId) link(appId, parentId, 'Business Application', 'Business Capability', 'Provides', a.ownership, cp.name,
        `The application provides the parent activity too.`);
    }

    const capIds = (inScope('Business Capability') ? (a.capabilities || []) : []).filter(c => String(c).trim()).map(label => {
      const id = resolve('Business Capability', label, { description: label },
        { asked: `what the business could no longer do`, why: `What the business does, independent of the software doing it. The only class that can carry a revenue figure.` },
        { why: `Already in your model, so I am reusing it. Two applications providing the same capability is exactly how a shared business consequence gets modelled.` });
      if (appId) link(appId, id, 'Business Application', 'Business Capability', 'Provides', a.ownership, label,
        `Without this edge, an outage can only ever be reported as a red icon — never as a business consequence.`);
      if (parentId && (cp.children || []).includes(label))
        link(parentId, id, 'Business Capability', 'Business Capability', 'Contains', cp.name, label,
          `A sub-activity of ${cp.name}. Contains propagates downward, which is why a revenue figure belongs on one level only.`);
      return id;
    });

    /* Application Services, one per environment. */
    const n = (a.environments || ['Production']).length;
    let prodId = null, prodLabel = '';
    if (a.anchor && inScope('Application Service')) (a.environments || ['Production']).forEach(env => {
      const isProd = env === 'Production', label = isProd ? a.anchor : `${a.anchor} (${env})`;
      const id = resolve('Application Service', label, { description: label, owner: a.owner || '', environment: env, operationalStatus: 'Operational' },
        { phrase: a.anchor, asked: isProd ? `what someone would call you about` : '', why: isProd ? `The running instance — the layer that can actually fail, and where simulation starts.` : `A separate service, so an outage here cannot make Production look degraded.` },
        { why: `Already in your model, so I am reusing it rather than creating a second ${env} copy.` });
      if (appId) link(appId, id, 'Business Application', 'Application Service', 'Instantiates', a.ownership, label,
        `One funded application, ${n} running instance${n > 1 ? 's' : ''}.`);
      if (isProd || !prodId) { prodId = id; prodLabel = label; }
    });

    /* Sell/Consume layer: Business Service -> Service Offering -> the running service. */
    const cs = a.consumers;
    if (cs && cs.consumerType && inScope('Business Service')) {
      const bsId = resolve('Business Service', cs.serviceName, { description: cs.serviceName, owner: a.owner || '', consumerType: cs.consumerType },
        { why: `The consumable face of the capability — what a ${cs.consumerType.toLowerCase()} consumer thinks they are buying. It cannot be failure-simulated directly; it goes red only because something under it did.` },
        { why: `Already in your model, so I am reusing it as the consumable face.` });
      capIds.forEach((capId, i) => link(bsId, capId, 'Business Service', 'Business Capability', 'Provides', cs.serviceName, a.capabilities[i],
        `The service is how this capability is actually consumed.`));
      const tiers = (cs.tiers || []).filter(Boolean);
      if (inScope('Service Offering')) (tiers.length ? tiers : [`${cs.serviceName} Offering`]).forEach(tier => {
        const offId = resolve('Service Offering', tier, { description: tier, owner: a.owner || '', availabilityTarget: cs.availability || '', supportHours: cs.supportHours || '' },
          { why: `Where the commitment and the price live. The same Business Service can be offered several ways.` },
          { why: `Already in your model, so I am reusing this offering.` });
        link(bsId, offId, 'Business Service', 'Service Offering', 'Offers', cs.serviceName, tier, `One service, ${tiers.length || 1} way${(tiers.length || 1) > 1 ? 's' : ''} of buying it.`);
        if (prodId) link(offId, prodId, 'Service Offering', 'Application Service', 'Depends on', tier, prodLabel,
          `This is the second path by which a failure becomes a business consequence — the offering depends on the thing that actually runs.`);
        if (cs.availability && inScope('Service Commitment')) {
          const cmLabel = `${tier}: ${cs.availability}`;
          const cmId = resolve('Service Commitment', cmLabel, { description: `${cs.availability} availability, ${cs.supportHours}` },
            { why: `A promise you can name. Modelling it means an outage can be reported as a broken commitment, not just a red icon.` },
            { why: `Already in your model, so I am reusing this commitment.` });
          link(offId, cmId, 'Service Offering', 'Service Commitment', 'Contains', tier, cmLabel,
            `The commitment belongs to the offering, not to the service — different tiers promise different things.`);
        }
      });
    }

    /* ---- Infrastructure ----
       `level` is depth from the BUSINESS, not hosting order. Database Instance is level 8
       and VM is level 6, yet the database sits on the VM. Deriving hosting parentage from
       level is therefore wrong for every data, storage, network and security class — that
       is why a database never landed on the box it runs on.

       So hosting classes stack on each other by level, and everything else gets TWO edges:
         Application Service --Depends on--> Database Instance   (a DB outage reaches the business)
         Database Instance   --Runs on-->    VM                  (a VM outage reaches the DB)
       Only the first carries a failure up; only the second carries one down. Emitting just
       one of them — what this did before — leaves a database that survives losing its own
       host. csdmData.json has both edges; now so does the interview. */
    const isHost = ty => HOSTING.has(ty) || RUNTIME.has(ty);
    const svc = prodId ? { id: prodId, type: 'Application Service', label: prodLabel } : null;
    const placed = [];

    /* Pass 1 — every node first, so a pairing can name something declared later in the
       sentence ("a database instance that runs on a VM" names the VM second). */
    (a.infra || []).filter(t => t.type && !t.skip && inScope(t.type)).slice()
      .sort((x, y) => levelOf(x.type) - levelOf(y.type))
      .forEach(t => {
        const generic = norm(t.label) === norm(t.type);
        /* Only promise a redundancy value when one can actually be written. Saying it anyway on
           a class with no redundancy field left the card claiming a resilience answer that was
           never stored, and the node then read as a single point of failure with no explanation. */
        const qty = (t.count || 1) < 2 ? ``
          : canRedundancy(t.type)
            ? ` You said there is more than one — so I made it one CI with a redundancy value rather than two nodes. That is what lets the cascade absorb losing one of them; two separate nodes could not.`
            : ` You said there is more than one, but ${t.type} has no redundancy field in this schema, so there is nowhere to record that. It will read as a single point of failure — a gap in the schema, not in your answer.`;
        const id = resolve(t.type, t.label, { description: t.label, environment: 'Production' },
          { phrase: t.phrase && norm(t.phrase) !== norm(t.label) ? t.term : '', generic, why: t.why + qty },
          { why: `Already in your model, so I am reusing it. ${t.why}` });
        placed.push({ id, type: t.type, label: t.label, level: levelOf(t.type), host: isHost(t.type), t });
      });

    /* A pairing is matched back by the user's own words, whichever of them we kept. */
    const findPlaced = phrase => {
      const k = norm(phrase);
      return k ? placed.find(p => norm(p.t.phrase) === k || norm(p.t.term) === k || norm(p.t.label) === k) || null : null;
    };
    /* EVERY node in the deepest hosting layer above `lvl`, not just one: two VMs in a rack
       are both in the rack, and taking whichever was placed first stranded the other. */
    const hostsAbove = (lvl, childType) => {
      const c = placed.filter(p => p.host && p.level < lvl && pickLabel(p.type, childType));
      if (!c.length) return [];
      const deepest = Math.max(...c.map(p => p.level));
      return c.filter(p => p.level === deepest);
    };
    /* The box a non-hosting thing sits on. Prefer what the user said; otherwise only take
       the shallowest hosting layer when it holds exactly one node — with three VMs on the
       table, which one the database runs on is a fact we do not have. */
    /* The user joined these two outright ("app servers that connect to a database"). That is a
       peer relationship, and calling it hosting inverts the cascade: the database would then
       "run on" the app servers, so the pair's redundancy absorbs the database's own outage and
       the two nodes end up killing each other. A stated pairing is never a host guess. */
    const pairedWith = (q, p) => (q.t.dependsOn || []).some(ph => findPlaced(ph) === p);
    const hostFor = p => {
      const hinted = findPlaced(p.t.runsOn);
      if (hinted && hinted !== p && hinted.host && pickLabel(p.type, hinted.type)) return hinted;
      const c = placed.filter(q => q.host && pickLabel(p.type, q.type) && !pairedWith(q, p) && !pairedWith(p, q));
      if (!c.length) return null;
      const top = Math.min(...c.map(q => q.level));
      const at = c.filter(q => q.level === top);
      return at.length === 1 ? at[0] : null;
    };
    const wire = (from, to, label, why) => {
      if (label) link(from.id, to.id, from.type, to.type, label, from.label, to.label, why);
      return !!label;
    };
    const spineWhy = (from, label, to) =>
      `${from} ${String(label).toLowerCase()} ${to}. This direction is what carries a ${to} failure up to your service — ${label} propagates to the source, Contains would not.`;

    const orphan = p => link(prodId, p.id, 'Application Service', p.type, null, prodLabel, p.label,
      prodId ? `A ${p.type} cannot attach directly to an Application Service in this schema, and nothing you listed sits between them. Add something that lives in it — then this will connect.`
        : `You skipped naming the service, so there is nothing above ${p.label} for a failure to travel up to. It will sit on the canvas as an island until you connect it.`);

    /* Pass 2 — structure. */
    placed.forEach(p => {
      if (p.host) {
        /* Hosting stacks on hosting. Falling back to the service is deferred to pass 4:
           a tier named later in the sentence may yet connect this box. */
        hostsAbove(p.level, p.type).forEach(q => wire(q, p, pickLabel(q.type, p.type), spineWhy(q.label, pickLabel(q.type, p.type), p.label)));
        return;
      }
      let wired = svc ? wire(svc, p, pickLabel('Application Service', p.type),
        `${prodLabel} needs ${p.label} to work. This is the edge that carries a ${p.label} outage up to the business — without it a failure here reaches nothing.`) : false;
      const h = hostFor(p);
      if (h) wired = wire(p, h, pickLabel(p.type, h.type),
        `${p.label} runs on ${h.label}${p.t.runsOn ? ` — you said so` : ``}. This is the second edge and it points the other way on purpose: it is what makes losing ${h.label} take ${p.label} down with it.`) || wired;
      if (!wired) orphan(p);
    });

    /* Pass 3 — pairings the user stated outright ("an app server that connects to a database").
       They said WHICH things are joined; the label is still ours to choose, so nothing but an
       impact-propagating label can reach the graph. */
    placed.forEach(p => (p.t.dependsOn || []).forEach(phrase => {
      const q = findPlaced(phrase);
      if (!q || q === p) return;
      wire(p, q, pickLabel(p.type, q.type),
        `You said ${p.label} connects to ${q.label}, so this is your relationship rather than one I inferred from the stack.`);
    }));

    /* Pass 4 — boxes nothing else reached. Figure 16 of the CSDM 5 white paper runs the chain
       Application Service --[Depends on]--> Application --[Runs On]--> Infrastructure CI, with
       no direct edge from the service to infrastructure. The shortcut is legal here (real
       Service Mapping does associate CIs to the service) but it is not what CSDM prescribes.

       Suppressing it for ANY inbound edge was wrong: a Database Instance running on a VM is
       not that tier, so the service ended up not touching the box it runs on. Two conditions
       now — the box must be the top of its hosting stack, and not already carried by an
       Application. */
    const edgeTo = (id, pred) => claims.some(c => c.kind === 'edge' && !c.orphan && c.to === id && pred(c));
    const hostInbound = id => edgeTo(id, c => isHost(c.fromType));
    const appCarried = id => edgeTo(id, c => c.fromType === 'Application');
    placed.filter(p => p.host && !hostInbound(p.id) && !appCarried(p.id)).forEach(p => {
      const l = svc ? pickLabel('Application Service', p.type) : null;
      if (l) wire(svc, p, l, `${prodLabel} runs on ${p.label} and nothing you named sits between them. CSDM 5 would normally put an Application in that gap — name one and this edge moves down a level.`);
    });
    /* Anything left touching nothing at all. An existing orphan claim counts, so a node that
       already failed to connect in pass 2 is not reported twice. */
    placed.filter(p => !claims.some(c => c.kind === 'edge' && (c.to === p.id || c.from === p.id))).forEach(orphan);

    return { nodes, edges, claims, reusedNodes, metaUpdates, capIds, prodId, parentId };
  }

  /* ---------- review ---------- */
  function claimCard(c, i) {
    if (c.orphan) return `<div class="path-step iv-invalid"><span class="iv-nocheck"><strong>${esc(c.toLabel)}</strong> <span class="iv-tag">not connected</span></span>
      <div class="path-step-help">${esc(c.why)}</div></div>`;
    const valid = c.kind === 'edge' ? !!schema().getAllowedRelationship(c.fromType, c.toType, c.label) : true;
    const head = c.kind === 'node'
      ? `<strong>${esc(c.label)}</strong> <span class="muted">&rarr; ${esc(c.type)}</span>`
      : `<strong>${esc(c.fromLabel)}</strong> <span class="muted">--${esc(c.label)}--&gt;</span> <strong>${esc(c.toLabel)}</strong>`;
    const sn = c.kind === 'node' ? snClass(c.type) : snRel(c.label);
    const rule = c.kind === 'edge' ? ruleText(c.fromType, c.toType, c.label) : '';
    const tag = (c.already ? `<span class="iv-tag">already in your model</span>` : c.reused ? `<span class="iv-tag iv-tag-reuse">reusing what you have</span>` : '')
      + (c.generic ? `<span class="iv-tag">unnamed — rename later</span>` : '');
    const facts = [];
    if (c.meta && c.meta.redundancy) { const o = REDUNDANCY.find(x => x.v === c.meta.redundancy); facts.push(`resilience: <strong>${esc(c.meta.redundancy)}</strong> — survives ${esc(o ? o.survives : '')}`); }
    if (c.meta && c.meta.revenueAmount) facts.push(`revenue: <strong>${esc(c.meta.revenueAmount)} ${esc(c.meta.revenuePeriod || '')}</strong>`);
    if (c.meta && c.meta.monthlyCost) facts.push(`cost: <strong>${esc(c.meta.monthlyCost)}/month</strong>`);
    const control = c.already ? `<span class="iv-nocheck">${head} ${tag}</span>`
      : `<label class="iv-claim-head"><input type="checkbox" class="iv-claim" data-i="${i}" checked> ${head} ${tag}</label>`;
    return `<div class="path-step ${valid ? '' : 'iv-invalid'} ${c.already ? 'iv-already' : ''} ${c.reused ? 'iv-reused' : ''}">${control}
      ${c.phrase && norm(c.phrase) !== norm(c.label) ? `<div class="muted iv-phrase">from your words: &ldquo;${esc(c.phrase)}&rdquo;</div>` : ''}
      ${c.asked ? `<div class="muted iv-phrase">you answered this when I asked: ${esc(c.asked)}</div>` : ''}
      <div class="path-step-help">${esc(c.why)}
        ${facts.length ? `<br>${facts.join(' &middot; ')}` : ''}
        ${rule ? `<br><span class="ps-rule">CSDM rule:</span> ${esc(rule)}` : ''}
        ${sn ? `<br><span class="ps-rule">ServiceNow:</span> ${esc(sn)}` : ''}
        ${valid ? '' : `<br><strong>Your own rules reject this.</strong> Valid labels between these classes: ${esc((schema().getValidRelationshipLabels(c.fromType, c.toType) || []).join(', ') || 'none')}.`}
      </div></div>`;
  }

  function renderReview() {
    const d = S.draft = buildDraft();
    const nodeC = d.claims.filter(c => c.kind === 'node'), edgeC = d.claims.filter(c => c.kind === 'edge' && !c.orphan), orphanC = d.claims.filter(c => c.orphan);
    const newN = nodeC.filter(c => c.isNew).length, reN = nodeC.length - newN, newE = edgeC.filter(c => !c.already).length;
    setTitle(`Review the proposal`);
    body(`<p class="muted">Nothing has touched the canvas yet. Every claim below is mine to justify and yours to reject.</p>
      ${skipSummary(`You left ${gaps().length} question${gaps().length > 1 ? 's' : ''} unanswered. That is allowed — this is what it costs you.`)}
      ${scopeIsAll() ? '' : `<div class="explain-box"><strong>Built at ${esc(scopeLabel())} scope.</strong> Everything below is a class that phase actually uses. Whole layers of CSDM are missing from this proposal on purpose, and that is what a model at this phase looks like — widen the scope with the <strong>Phase</strong> chips in the status bar and run this again to see what the next phase adds.</div>`}
      ${(S.notes.phaseDropped || []).length ? `<div class="explain-box">I left ${S.notes.phaseDropped.map(w => esc(w)).join(', ')} out — recognised correctly, but outside your ${esc(scopeLabel())} phase scope.</div>` : ''}
      ${(S.notes.selfDropped || []).length ? `<div class="explain-box">I left ${S.notes.selfDropped.map(w => `&ldquo;${esc(w)}&rdquo;`).join(', ')} out of the infrastructure below — you named ${(S.notes.selfDropped || []).length > 1 ? 'those' : 'that'} as the service or the application itself, and neither can depend on itself.</div>` : ''}
      ${reN ? `<div class="explain-box"><strong>${reN} of these already exist</strong> in your model, so I am pointing at them instead of creating duplicates.</div>` : ''}
      ${d.metaUpdates.length ? `<div class="explain-box explain-bad"><strong>${d.metaUpdates.length} change${d.metaUpdates.length > 1 ? 's' : ''} to nodes you already have.</strong> ${d.metaUpdates.map(u => `${esc(u.label)}: ${esc(u.key)} ${u.old ? `${esc(u.old)} &rarr; ` : `&rarr; `}${esc(u.value)}`).join('; ')}. Untick that node to leave it alone.</div>` : ''}
      <h3 class="iv-h">Things I think you have (${newN} new${reN ? `, ${reN} reused` : ''})</h3>
      ${nodeC.map(c => claimCard(c, d.claims.indexOf(c))).join('')}
      <h3 class="iv-h">How I think they connect (${newE} new${edgeC.length - newE ? `, ${edgeC.length - newE} already there` : ''})</h3>
      ${edgeC.map(c => claimCard(c, d.claims.indexOf(c))).join('')}
      ${orphanC.length ? `<h3 class="iv-h">Could not connect (${orphanC.length})</h3>${orphanC.map(c => claimCard(c, -1)).join('')}` : ''}
      <div class="explain-box"><strong>Why the labels matter.</strong> Every edge above uses <em>Depends on</em>, <em>Runs on</em>, <em>Uses</em>, <em>Instantiates</em> or <em>Provides</em> — never <em>Contains</em> for the dependency spine. Only those carry a failure from the thing that broke up to the business activity that suffers. It is the difference between a diagram and a model.</div>
      <div class="path-step"><span class="path-step-title">Did I build what you meant?</span>
        <div class="path-step-help">Say what you expected, in your own words — “the database should run on the VM”, “the app server should not be a VM”. It is saved next to your exact input and my exact output, so the two can be compared and the builder corrected. Nothing here changes the model.</div>
        <textarea id="iv-expected" placeholder="What should this have looked like?">${esc(S.expected || '')}</textarea></div>
      <div class="actions"><button class="secondary" onclick="CSDM_IV.back()">Back</button>
        <button class="secondary" id="iv-save-cmp" onclick="CSDM_IV.saveComparison()">Save comparison</button>
        <button onclick="CSDM_IV.commit()">Add these to the model</button></div>`);
  }

  function commit() {
    readExpected();
    const keep = new Set([...document.querySelectorAll('.iv-claim')].filter(c => c.checked).map(c => Number(c.dataset.i)));
    const d = S.draft, keptNodes = [], keptEdges = [], live = new Set(), updates = [];
    let dropped = 0;
    d.claims.forEach((c, i) => {
      if (c.kind !== 'node') return;
      if (!keep.has(i)) { dropped++; return; }
      live.add(c.ref);
      if (c.isNew) keptNodes.push(d.nodes.find(n => n.id === c.ref));
    });
    d.metaUpdates.forEach(u => { if (live.has(u.id)) updates.push(u); });
    d.claims.forEach((c, i) => {
      if (c.kind !== 'edge' || c.already || c.orphan) return;
      if (!keep.has(i) || !live.has(c.from) || !live.has(c.to)) return;
      if (!schema().getAllowedRelationship(c.fromType, c.toType, c.label)) return;
      keptEdges.push(d.edges.find(e => e.from === c.from && e.to === c.to && e.label === c.label));
    });
    if (!keptNodes.length && !keptEdges.length && !updates.length)
      return alert(!live.size ? `Every claim was rejected, so there is nothing to add.` : `Everything you described is already in the model — nothing new to add.`);

    const ok = markChange(`Interview: ${S.answers.anchor || S.answers.ownership || 'model'}`, () => {
      currentModelData.nodes.push(...keptNodes.filter(Boolean));
      currentModelData.edges.push(...keptEdges.filter(Boolean));
      updates.forEach(u => { const n = getNode(u.id); if (n) { n.metadata = n.metadata || {}; n.metadata[u.key] = u.value; } });
      if (typeof ensurePositions === 'function') ensurePositions();
    });
    if (!ok) return alert(`Nothing changed.`);
    const v = window.CSDM_VALIDATOR && window.CSDM_VALIDATOR.validateGraph ? window.CSDM_VALIDATOR.validateGraph(currentModelData) : null;
    capture('commit', d, {
      committed: {
        nodes: keptNodes.filter(Boolean).map(n => `${n.label} [${n.type}]`),
        edges: keptEdges.filter(Boolean).length,
        rejected: dropped,
        validatorErrors: v ? (v.errors || []).length : null
      }
    });
    renderDone(keptNodes, keptEdges, updates, dropped, v, [...live]);
  }

  /* A blast radius of 30 nodes is a wall of text. Name what the business loses, count the rest. */
  function chainText(reached, bizHit, cascade) {
    if (!reached.length) return cascade && cascade.contained
      ? `nothing — it is redundant, so its own failure is absorbed at source`
      : `nothing — everything above it absorbed the hit`;
    const head = (bizHit.length ? bizHit : reached).slice(0, 4)
      .map(n => `<strong>${esc(n.label)}</strong> <span class="muted">[${esc(n.type)}]</span>`).join(`, `);
    const rest = reached.length - Math.min((bizHit.length ? bizHit : reached).length, 4);
    return `${head}${rest > 0 ? ` &mdash; and ${rest} more node${rest === 1 ? '' : 's'} in between` : ''}`;
  }

  function renderDone(nodes, edges, updates, dropped, validation, liveIds) {
    const live = liveIds.map(id => getNode(id)).filter(Boolean);
    const caps = live.filter(n => n.type === 'Business Capability');
    const svc = live.filter(n => n.type === 'Application Service');
    const prod = svc.find(n => (n.metadata || {}).environment === 'Production') || svc[0];
    const spofs = live.filter(n => canRedundancy(n.type) && norm((n.metadata || {}).redundancy) === norm('Single instance'));
    const region = live.find(n => n.type === 'Cloud Region') || live.find(n => n.type === 'Data Center');
    const validLine = validation ? ((validation.errors || []).length ? `<span class="explain-bad">Validator flagged ${validation.errors.length} issue(s).</span>` : `<span class="explain-good">Validator: model is clean.</span>`) : '';

    /* Pick the demo target: worst SPOF by business reach. Region and data centre are held back
       deliberately — they are the closer, and leading with them spoils the escalation. */
    let target = null, best = -1;
    const held = new Set(['Cloud Region', 'Data Center']);
    const pool = spofs.length ? spofs : live.filter(n => typeof isNonOperational !== 'function' || !isNonOperational(n.type));
    const cands = pool.filter(n => !held.has(n.type) || !region);
    cands.forEach(n => { const c = typeof computeCascade === 'function' ? computeCascade(n.id) : null; if (!c || c.contained) return; const hits = [...c.affected].filter(i => (getNode(i) || {}).type === 'Business Capability').length * 100 + c.affected.size; if (hits > best) { best = hits; target = n; } });
    if (!target) target = prod;

    const tc = target && typeof computeCascade === 'function' ? computeCascade(target.id) : null;
    const reached = tc ? [...tc.affected].map(id => getNode(id)).filter(Boolean) : [];
    const absorbed = tc ? [...tc.protectedNodes].map(id => getNode(id)).filter(Boolean) : [];
    const rev = typeof affectedRevenuePerHour === 'function' ? affectedRevenuePerHour(reached) : 0;
    /* Lead with the business consequences, not a 30-node wall of infrastructure. */
    const bizHit = reached.filter(n => n.type === 'Business Capability' || n.type === 'Business Service');
    const chain = chainText(reached, bizHit, tc);

    setTitle(`Your model is live — now feel it`);
    body(`<p>Added <strong>${nodes.length}</strong> node${nodes.length === 1 ? '' : 's'}, <strong>${edges.length}</strong> relationship${edges.length === 1 ? '' : 's'}${updates.length ? `, updated ${updates.length} existing value${updates.length === 1 ? '' : 's'}` : ''}${dropped ? `, skipped ${dropped} you rejected` : ''}. ${validLine}</p>
      ${target ? `<div class="explain-box ${rev > 0 ? 'explain-bad' : ''}"><strong>If ${esc(target.label)} failed right now, the business loses:</strong> ${chain}.
        ${absorbed.length ? `<br><strong>${absorbed.length} node${absorbed.length > 1 ? 's' : ''} would absorb it</strong> and stay amber instead of red: ${absorbed.map(n => esc(n.label)).join(', ')} — because you told me what they survive.` : ''}
        ${rev > 0 ? `<br><span class="impact-flag">Revenue at risk:</span> <strong>${esc(money(rev))}/hour</strong> (${esc(money(rev * 24))}/day).` : `<br>Revenue at risk reads ${esc(money(0))} — no capability it reaches carries a figure yet.`}</div>` : ''}
      ${spofs.length ? `<div class="explain-box"><strong>${spofs.length} single point${spofs.length > 1 ? 's' : ''} of failure</strong> you told me about: ${spofs.map(n => esc(n.label)).join(', ')}. Coach will list ${spofs.length > 1 ? 'them' : 'it'} too — but now with a reason, because the redundancy answers are real.</div>` : ''}
      ${skipSummary(`This is why parts of the numbers above read thin — and why Impact Analysis and cost impact will too.`)}
      <div class="actions">
        ${target ? `<button onclick="closeDialog();simulateFailure('${esc(target.id)}')">Fail ${esc(target.label)}</button>` : ''}
        ${region && (!target || region.id !== target.id) ? `<button onclick="CSDM_IV.regionCloser('${esc(region.id)}')">Now lose the whole ${esc(region.type === 'Cloud Region' ? 'region' : 'data centre')}</button>` : ''}
        <button class="secondary" onclick="closeDialog();openDashboardDialog()">Dashboard</button>
        <button class="secondary" onclick="closeDialog()">Close</button></div>`);
    if (prod && typeof showNodeInspector === 'function') { selectedNodeId = prod.id; showNodeInspector(prod.id); }
  }

  /* The closer: nothing in REDUNDANCY_SCOPE_RANK reaches a Cloud Region (rank 5). */
  function regionCloser(id) {
    const n = getNode(id); if (!n) return;
    const c = typeof computeCascade === 'function' ? computeCascade(id) : null;
    const reached = c ? [...c.affected].map(i => getNode(i)).filter(Boolean) : [];
    const absorbed = c ? [...c.protectedNodes].map(i => getNode(i)).filter(Boolean) : [];
    const rev = typeof affectedRevenuePerHour === 'function' ? affectedRevenuePerHour(reached) : 0;
    const isRegion = n.type === 'Cloud Region';
    setTitle(`Losing ${n.label}`);
    body(`<div class="explain-box explain-bad"><strong>${reached.length} of your nodes go down. ${absorbed.length} absorb it.</strong>
        ${rev > 0 ? `Revenue at risk: <strong>${esc(money(rev))}/hour</strong>.` : ``}</div>
      <div class="path-step"><span class="path-step-title">Why so little survived</span><div class="path-step-help">
        A failure origin has a <em>scope rank</em>: one machine (host, VM, container) 1, Rack 2, Data Center 3, Availability Zone 4, Cloud Region 5. A node absorbs a failure only when its redundancy rank is at least the origin rank — and the ranks available to you are <em>Redundant pair</em> 2 and <em>HA cluster</em> / <em>Auto-scaling</em> 4. A component that is not a scope at all — a database, a load balancer — has no rank, and nothing downstream absorbs its loss: every copy of everything above it was behind it.
        ${isRegion ? `<br><strong>Nothing you can tick reaches 5.</strong> No redundancy option in this schema survives losing a whole region. The only fix is a second region in the model — which is precisely the point.` : `<br>A <em>standby pair</em> ranks 2 and cannot absorb a data centre loss at rank 3. Only an HA cluster or auto-scaling can.`}
      </div></div>
      <div class="actions"><button class="secondary" onclick="closeDialog()">Close</button>
        <button onclick="closeDialog();simulateFailure('${esc(id)}')">Show me on the canvas</button></div>`);
  }

  /* ---------- chrome ---------- */
  function setTitle(t) { document.getElementById('modal-title').textContent = t; }
  function body(html) { document.getElementById('modal-body').innerHTML = html; document.getElementById('modal-backdrop').classList.remove('hidden'); }

  function renderStage() {
    if (S.i >= STAGES.length) return renderReview();
    /* The phase scope can hide the stage we are sitting on — at start, or because it was
       changed from the Learn menu mid-interview. Step over it rather than rendering it. */
    if (hiddenStage(STAGES[S.i])) { const j = nextIndex(S.i); if (j !== S.i) { S.i = j; return renderStage(); } }
    const st = STAGES[S.i], lead = typeof st.lead === 'function' ? st.lead() : st.lead;
    const askText = String(typeof st.ask === 'function' ? st.ask() : st.ask)
      .replace('${app}', `<strong>${esc(S.answers.ownership || S.answers.anchor || 'it')}</strong>`)
      .replace('${anchor}', `<strong>${esc(S.answers.anchor || 'it')}</strong>`);
    /* Shown once, on the stage right after the drop happened. */
    const dropped = (S.notes.selfDroppedNew || []).slice();
    S.notes.selfDroppedNew = [];
    const phaseDropped = (S.notes.phaseDroppedNew || []).slice();
    S.notes.phaseDroppedNew = [];
    const phaseRestored = (S.notes.phaseRestoredNew || []).slice();
    S.notes.phaseRestoredNew = [];
    /* Which questions the scope removed, and what each one would have been for. Rendered from
       the stage's own `cost()` so a phase-hidden question reads exactly like a skipped one —
       the hole in the model is the same hole either way. */
    const hiddenByPhase = STAGES.filter(s => hiddenStage(s) && s.id !== 'environments');
    setTitle(st.title);
    body(`<div class="iv-progress">${STAGES.map((s, i) => hiddenStage(s) ? '' : `<span class="iv-dot ${i === S.i ? 'on' : S.skipped[s.id] ? 'skipped' : i < S.i ? 'done' : ''}">${esc(s.id)}</span>`).join('')}<span class="iv-dot">review</span></div>
      ${scopeIsAll() ? '' : `<div class="explain-box"><strong>Phase scope: ${esc(scopeLabel())}.</strong> ${hiddenByPhase.length ? `${hiddenByPhase.length} question${hiddenByPhase.length > 1 ? 's are' : ' is'} not being asked, because the class${hiddenByPhase.length > 1 ? 'es' : ''} the answer would go into ${hiddenByPhase.length > 1 ? 'are' : 'is'} outside it:<ul class="iv-gaps">${hiddenByPhase.map(s => `<li><strong>${esc(s.title)}</strong> &mdash; ${typeof s.cost === 'function' ? s.cost() : s.cost}</li>`).join('')}</ul>` : `Every question still applies at this scope.`}Change it with the <strong>Phase</strong> chips in the status bar.</div>`}
      ${phaseDropped.length ? `<div class="explain-box"><strong>Held back as outside your phase scope: ${phaseDropped.map(w => esc(w)).join(', ')}.</strong> I recognised ${phaseDropped.length > 1 ? 'those' : 'that'} correctly — the class just is not in play at ${esc(scopeLabel())}. I will not substitute a class you did not say. Tick the phase it belongs to with the <strong>Phase</strong> chips in the status bar and ${phaseDropped.length > 1 ? 'they come' : 'it comes'} straight back; you do not have to type it again.</div>` : ''}
      ${phaseRestored.length ? `<div class="explain-box"><strong>Back in: ${phaseRestored.map(w => esc(w)).join(', ')}.</strong> You widened the phase scope, so ${phaseRestored.length > 1 ? 'these are' : 'this is'} in play again from what you already told me.</div>` : ''}
      <p class="muted">${lead}</p>
      <p class="iv-ask">${askText}</p>
      <p class="muted iv-hint">${st.hint}</p>
      ${dropped.length ? `<div class="explain-box"><strong>Taken back out of your infrastructure list: ${dropped.map(w => `&ldquo;${esc(w)}&rdquo;`).join(', ')}.</strong> You have just named that as the thing itself, and a service cannot be a dependency of itself. Say so on this screen if I have that wrong.</div>` : ''}
      ${st.body()}
      <div id="iv-err" class="explain-box explain-bad hidden"></div>
      <div class="actions">${S.i ? `<button class="secondary" onclick="CSDM_IV.back()">Back</button>` : `<button class="secondary" onclick="closeDialog()">Cancel</button>`}
        ${st.skippable ? `<button class="secondary" onclick="CSDM_IV.skip()">Skip this</button>` : ''}
        <button onclick="CSDM_IV.next()">${isLast(S.i) ? 'See the proposal' : 'Next'}</button></div>`);
    setTimeout(() => { const f = document.querySelector('#modal-body input:not([type=checkbox]):not([disabled]), #modal-body textarea'); if (f) f.focus(); }, 60);
  }

  /* Skipping is allowed anywhere, but never quietly. The cost is stated as the features
     that stop working, because a model with a hole in it is the lesson — the same hole
     turns up again in Impact Analysis and the cost rollup, and it should be recognised. */
  function skip() {
    const st = STAGES[S.i];
    setTitle(`Skip: ${st.title}`);
    body(`<div class="explain-box explain-bad"><strong>Skip this and here is what stops working.</strong><br>${typeof st.cost === 'function' ? st.cost() : st.cost}</div>
      <p class="muted">You can come Back to it any time before the review, and every field here can also be filled in later from the Inspector on the canvas.</p>
      <div class="actions"><button class="secondary" onclick="CSDM_IV.skipConfirm()">Skip it anyway</button>
        <button onclick="CSDM_IV.redraw()">Go back and answer it</button></div>`);
  }
  function skipConfirm() {
    const st = STAGES[S.i];
    S.skipped[st.id] = true;
    if (typeof st.clear === 'function') st.clear();
    S.draft = null;
    S.i = nextIndex(S.i);
    renderStage();
  }

  function next() {
    const st = STAGES[S.i], err = st.read();
    if (err === `_stay`) return;
    if (err) { const e = document.getElementById('iv-err'); e.textContent = err; e.classList.remove('hidden'); return; }
    delete S.skipped[st.id];
    if (st.id === 'infrastructure' && pendingInfra().length) return renderStage();
    S.i = nextIndex(S.i); renderStage();
  }
  /* Coming back to a skipped stage un-skips it: the answer box is there to be used. */
  function back() {
    if (S.i >= STAGES.length) { S.i = STAGES.length - 1; while (S.i > 0 && hiddenStage(STAGES[S.i])) S.i--; }
    else if (S.i > 0) S.i = prevIndex(S.i);
    delete S.skipped[STAGES[S.i].id];
    S.draft = null; renderStage();
  }
  function readCapsLoose() { const v = [...document.querySelectorAll('.iv-cap')].map(i => (i.value || '').trim()); S.answers.capabilities = v.length ? v : ['']; }
  /* Keep whatever is on screen when a tier row is added or removed mid-edit. */
  function readTiersLoose() {
    const c = S.answers.consumers = S.answers.consumers || {};
    c.consumerType = (document.getElementById('iv-consumer') || {}).value || c.consumerType || '';
    c.serviceName = (document.getElementById('iv-bizsvc') || {}).value || c.serviceName || '';
    c.availability = (document.getElementById('iv-avail') || {}).value || c.availability || '';
    c.supportHours = (document.getElementById('iv-hours') || {}).value || c.supportHours || '';
    const v = [...document.querySelectorAll('.iv-tier')].map(i => (i.value || '').trim());
    c.tiers = v.length ? v : [''];
  }

  function start() {
    if (!window.CSDM_SCHEMA) return alert(`Schema not loaded yet — try again in a moment.`);
    if (!window.CSDM_LEXICON) return alert(`Lexicon not loaded — check that interviewLexicon.js is included.`);
    S = { i: 0, answers: { environments: ['Production'], capabilities: [''], infra: [], redundancy: {}, revenue: {}, cost: {} }, skipped: {}, notes: {}, draft: null, parsing: false, parsedText: '', parseSource: '' };
    if (typeof closeBarMenus === 'function') closeBarMenus();
    /* A key may have been added or dropped since the page loaded, and the infrastructure
       stage promises which parser it will use before it uses it. */
    loadLLMConfig().then(() => { if (S && STAGES[S.i].id === 'infrastructure') renderStage(); });
    renderStage();
  }

  /* ---------- parser configuration (status bar) ---------- */
  /* The key is posted to the server and held there in memory. It is never put in
     localStorage: this is a sandbox people open on shared screens. */
  function loadLLMConfig() {
    return fetch('/api/interview/config')
      .then(r => r.json())
      .then(cfg => { llmConfig = cfg; paintParserButton(); return cfg; })
      .catch(() => llmConfig);
  }

  function postLLMKey(apiKey) {
    return fetch('/api/interview/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    }).then(r => r.json().catch(() => ({ success: false, error: `The server returned ${r.status}.` })))
      .then(body => { if (body.config) { llmConfig = body.config; paintParserButton(); } return body; })
      .catch(err => ({ success: false, error: err.message }));
  }

  /* The button itself is the indicator — you can see whether a key is loaded without
     opening anything, because that is the thing you forget. */
  function paintParserButton() {
    const btn = document.getElementById('iv-parser-btn');
    if (!btn) return;
    const on = !!llmConfig.llmAvailable;
    btn.classList.toggle('iv-parser-on', on);
    btn.classList.toggle('iv-parser-off', !on);
    btn.innerHTML = `<span class="iv-led"></span>Parser: ${on ? 'LLM' : 'Built-in'} &#9662;`;
    btn.title = on
      ? `Interview Mode will send infrastructure answers to ${llmConfig.model || 'the model'}.`
      : `Interview Mode will use the built-in lexicon. Click to add an API key.`;
    const panel = document.getElementById('iv-parser-panel');
    if (panel && !panel.classList.contains('hidden')) paintParserPanel();
  }

  function paintParserPanel() {
    const el = document.getElementById('iv-parser-state');
    if (!el) return;
    if (!llmConfig.sdkInstalled) {
      el.className = 'explain-box explain-bad';
      el.innerHTML = `<strong>The Anthropic SDK is not installed.</strong> Run <code>npm install @anthropic-ai/sdk</code> and restart the server. Until then the interview uses its built-in vocabulary.`;
      return;
    }
    if (llmConfig.apiKeyConfigured) {
      el.className = 'explain-box explain-good';
      el.innerHTML = `<strong>A key is loaded${llmConfig.hint ? ` (${esc(llmConfig.hint)})` : ''}.</strong> ${llmConfig.source === 'env' ? `It came from the <code>ANTHROPIC_API_KEY</code> environment variable.` : `It is held in server memory and is lost when the server restarts.`} Infrastructure answers go to <strong>${esc(llmConfig.model || 'the model')}</strong>.`;
      return;
    }
    el.className = 'explain-box';
    el.innerHTML = `<strong>No key — the interview uses its built-in vocabulary.</strong> That is a supported way to run this: the lexicon knows the common words and asks you about the ambiguous ones. A key mainly buys you looser phrasing.`;
  }

  function buildParserMenu() {
    const learnBtn = document.getElementById('learn-menu-btn');
    if (!learnBtn || document.getElementById('iv-parser-btn')) return;
    const wrap = document.createElement('div');
    wrap.className = 'menu-wrap';
    wrap.innerHTML = `<button id="iv-parser-btn" class="iv-parser-off" onclick="CSDM_IV.toggleParser()"><span class="iv-led"></span>Parser &#9662;</button>
      <div id="iv-parser-panel" class="bar-menu hidden">
        <div id="iv-parser-state" class="explain-box"></div>
        <div class="field full"><label>Anthropic API key</label>
          <input id="iv-apikey" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false"></div>
        <div class="path-step-help" style="margin-left:0">Create one at <strong>console.anthropic.com</strong> &rarr; API Keys. It is sent to this local server and kept in memory only — never written to disk, never returned to the browser.</div>
        <div id="iv-parser-msg" class="muted"></div>
        <div class="bar-menu-actions">
          <button onclick="CSDM_IV.saveKey()">Save &amp; test</button>
          <button onclick="CSDM_IV.clearKey()">Clear key</button>
        </div>
      </div>`;
    learnBtn.parentElement.insertAdjacentElement('afterend', wrap);
    paintParserButton();
  }

  /* Re-reads the server on every open: another tab, or a restart, may have changed it. */
  function toggleParser() {
    const panel = document.getElementById('iv-parser-panel');
    const opening = panel && panel.classList.contains('hidden');
    if (typeof toggleBarMenu === 'function') toggleBarMenu('iv-parser-panel');
    if (!opening) return;
    msg('');
    paintParserPanel();
    loadLLMConfig().then(paintParserPanel);
    const input = document.getElementById('iv-apikey');
    if (input) setTimeout(() => input.focus(), 40);
  }

  /* Failures render as a block, not an inline span — the previous version put the
     reason in small text between the input and the buttons, where it was missed. */
  function msg(text, cls) {
    const el = document.getElementById('iv-parser-msg');
    if (!el) return;
    el.className = text ? `iv-parser-msg ${cls || 'iv-msg-info'}` : '';
    el.innerHTML = text || '';
  }

  function saveKey() {
    const input = document.getElementById('iv-apikey');
    const key = (input.value || '').trim();
    if (!key) return msg(`Paste a key first.`, 'iv-msg-bad');
    msg(`Testing the key against the API…`, 'iv-msg-info');
    postLLMKey(key).then(body => {
      if (body.success) {
        input.value = '';
        msg(`&#10003; ${esc(body.message)}`, 'iv-msg-good');
        paintParserPanel();
        if (S) renderStage();
      } else {
        msg(`<strong>The key was not accepted.</strong><br>${esc(body.error || 'That did not work.')}`, 'iv-msg-bad');
      }
    });
  }

  function clearKey() {
    msg(`Clearing…`);
    postLLMKey('').then(body => {
      const input = document.getElementById('iv-apikey');
      if (input) input.value = '';
      msg(llmConfig.apiKeyConfigured ? `Cleared the key you typed — the environment variable is still set.` : `Cleared. Back to the built-in vocabulary.`, 'muted');
      paintParserPanel();
      if (S) renderStage();
    });
  }

  window.CSDM_IV = {
    start, next, back, commit, regionCloser, skip, skipConfirm, redraw: renderStage, saveComparison,
    addCap: () => { readCapsLoose(); S.answers.capabilities.push(''); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-cap'); if (r.length) r[r.length - 1].focus(); }, 60); },
    /* Re-render on change so the hierarchy question appears as soon as a second activity is named. */
    refreshCaps: () => { const active = document.activeElement, i = [...document.querySelectorAll('.iv-cap')].indexOf(active); readCapsLoose(); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-cap'); if (i >= 0 && r[i]) r[i].focus(); }, 40); },
    delCap: i => { readCapsLoose(); S.answers.capabilities.splice(i, 1); if (!S.answers.capabilities.length) S.answers.capabilities = ['']; renderStage(); },
    addTier: () => { readTiersLoose(); S.answers.consumers.tiers.push(''); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-tier'); if (r.length) r[r.length - 1].focus(); }, 60); },
    delTier: i => { readTiersLoose(); S.answers.consumers.tiers.splice(i, 1); if (!S.answers.consumers.tiers.length) S.answers.consumers.tiers = ['']; renderStage(); },
    saveKey, clearKey, toggleParser, reloadConfig: loadLLMConfig, onPhaseScopeChange,
    _state: () => S, _draft: () => buildDraft(), _config: () => llmConfig, _inScope: inScope
  };
  window.CSDM_START_INTERVIEW = start;

  function addLaunchers() {
    const learn = document.querySelector('#learn-menu-panel .bar-menu-actions');
    if (learn && !document.getElementById('iv-launch')) {
      const b = document.createElement('button');
      b.id = 'iv-launch'; b.textContent = 'Interview: describe your environment'; b.onclick = start;
      learn.insertBefore(b, learn.firstChild);
    }
    const canvas = document.getElementById('canvas-menu');
    if (canvas && !document.getElementById('iv-launch-canvas')) {
      const b = document.createElement('button');
      b.id = 'iv-launch-canvas'; b.textContent = 'Interview: describe your environment';
      b.onclick = () => { if (typeof hideMenus === 'function') hideMenus(); start(); };
      canvas.insertBefore(b, canvas.firstChild);
    }
    buildParserMenu();
    loadLLMConfig();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLaunchers); else addLaunchers();
})();
