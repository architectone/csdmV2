/* Interview Mode — Anchor / Environments / Ownership / Capability / Infrastructure /
   Resilience / Money / Review. See INTERVIEW_MODE_SPEC.md.
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
  const REDUNDANCY = [
    { v: 'Single instance', label: `There is only one of it`, survives: `nothing — a single point of failure` },
    { v: 'Redundant pair', label: `There is a second one standing by`, survives: `up to losing a rack` },
    { v: 'HA cluster', label: `A cluster that tolerates losing a member`, survives: `up to losing an availability zone` },
    { v: 'Auto-scaling', label: `It scales itself out automatically`, survives: `up to losing an availability zone` }
  ];
  let S = null;

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
  function hasField(type, key) { try { return (schema().getMetadataFields(type) || []).some(f => f.key === key); } catch (e) { return false; } }
  function canRedundancy(type) { return typeof supportsRedundancy === 'function' ? supportsRedundancy(type) : hasField(type, 'redundancy'); }
  function money(v) { return typeof formatMoney === 'function' ? formatMoney(v) : `$${Number(v || 0).toFixed(2)}`; }

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
    const out = lex().scan(text).map(m => {
      if (m.kind === 'class') return { term: m.term, label: m.label, type: m.type, why: m.why, phrase: m.phrase, generic: m.generic, count: m.count };
      if (m.kind === 'trap') return { term: m.term, label: m.label, type: '', why: m.trap.why, trapKey: m.trap.key, ask: m.trap.ask, options: m.trap.options, phrase: m.phrase, generic: m.generic, count: m.count };
      return { term: m.term, label: m.label, type: '', why: `I did not recognise this word, so you tell me what it is.`, unknown: true, generic: false, count: m.count };
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
    (S.answers.infra || []).forEach(t => {
      if (t.skip) return;
      const prev = seen.get(key(t));
      if (!prev) { seen.set(key(t), t); return; }
      /* The same words twice is one thing said twice — keep the larger count. */
      if (norm(prev.term) === norm(t.term)) { prev.count = Math.max(prev.count || 1, t.count || 1); t.skip = true; return; }
      const mine = lex().strip(t.term), theirs = lex().strip(prev.term);
      if (free(t, mine) && norm(mine) !== norm(t.label)) { t.label = mine; t.generic = false; seen.set(key(t), t); return; }
      /* "two app servers" and "a VM" both resolve to VM, and it is the earlier one that has
         the distinctive words — so rename that one rather than dropping this one. */
      if (free(prev, theirs) && norm(theirs) !== norm(prev.label)) { seen.delete(key(prev)); prev.label = theirs; prev.generic = false; seen.set(key(prev), prev); seen.set(key(t), t); return; }
      for (let i = 2; i < 20; i++) { const l = `${t.label} ${i}`; if (free(t, l)) { t.label = l; seen.set(key(t), t); return; } }
      t.skip = true;
    });
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

  /* Several traps can match one phrase ("app servers" hits both `app` and `server`).
     The model's own candidate list says which question it was actually unsure about,
     so that wins; failing that the head noun does, as in the lexicon. */
  function pickTrap(term, candidates) {
    const t = String(term || ''), cands = candidates || [];
    let best = null, bestScore = -1;
    (lex().traps || []).forEach(tr => {
      const m = t.match(tr.pattern);
      if (!m) return;
      const overlap = (tr.options || []).filter(o => o.type && cands.includes(o.type)).length;
      const score = overlap * 1000 + m.index;
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
        return { term, label, type: it.type, why: it.why || `The model chose ${it.type}.`, phrase: it.sourcePhrase, generic: norm(label) === norm(it.type), count: it.count || 1, redundancy: it.redundancy };
      }
      /* Prefer the hand-written trap: its wording is the teaching, not a paraphrase. */
      const trap = pickTrap(term, it.candidates);
      if (trap) return { term, label: '', type: '', why: trap.why, trapKey: trap.key, ask: trap.ask, options: trap.options, phrase: it.sourcePhrase, generic: true, count: it.count || 1, redundancy: it.redundancy };
      const cands = (it.candidates || []).filter(c => schema().nodeTypes[c]);
      if (cands.length > 1) return { term, label: '', type: '', why: it.why || `These words map to more than one class, so I will not guess.`, trapKey: `llm:${norm(term)}`, ask: `Which of these is “${term}”?`, options: cands.map(c => ({ label: c, type: c })), phrase: it.sourcePhrase, generic: true, count: it.count || 1, redundancy: it.redundancy };
      return { term, label: it.label || '', type: '', why: it.why || `I did not recognise this word, so you tell me what it is.`, unknown: true, phrase: it.sourcePhrase, generic: false, count: it.count || 1, redundancy: it.redundancy };
    }).filter(t => !self.includes(norm(t.label)) && !self.includes(norm(t.term))).slice(0, 40);
  }

  function runParse(text) {
    S.parsing = true;
    renderStage();
    parseWithLLM(text).then(body => {
      S.answers.infra = fromLLM(body.items);
      S.parseSource = `read by ${esc(body.model || 'the model')}`;
    }).catch(err => {
      S.answers.infra = parseInfra(text);
      S.parseSource = err && err.unavailable
        ? `read with my built-in vocabulary — no parser API key is configured`
        : `read with my built-in vocabulary — the parser was unavailable`;
    }).then(() => {
      S.parsing = false;
      S.parsedText = text;
      normalizeInfra();
      seedRedundancy();
      if (pendingInfra().length) renderStage();
      else { S.i++; renderStage(); }
    });
  }

  /* ---------- stages ---------- */
  const STAGES = [
    {
      id: 'anchor', title: `What breaks?`,
      lead: `We start where outages start, not at the top of a diagram. One question:`,
      ask: `What is the one thing that, if it broke right now, someone would call you about?`,
      hint: `Use whatever you actually call it — “the billing portal”, “Charles River”, “the claims system”.`,
      body: () => `<div class="field full"><label>Name it</label><input id="iv-anchor" placeholder="e.g. Billing Portal" value="${esc(S.answers.anchor || '')}" list="iv-anchor-list">
        <datalist id="iv-anchor-list">${existing('Application Service').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist></div>
        <div class="path-step-help">Whatever you name here becomes an <strong>Application Service</strong> — the layer that actually runs and can fail. It is the only layer failure simulation can start from, which is why we ask for it first.</div>`,
      read: () => { const v = (document.getElementById('iv-anchor').value || '').trim(); if (!v) return `Give it a name so we have something to hang the model on.`; S.answers.anchor = v; }
    },
    {
      id: 'environments', title: `How many copies of it are running?`,
      lead: () => `You said <strong>${esc(S.answers.anchor)}</strong>.`,
      ask: `Does it run in more than one place?`,
      hint: `Tick every environment that exists today. Production is assumed.`,
      body: () => `<div class="form-grid">${ENVS.map((e, i) => `<div class="field"><label><input type="checkbox" class="iv-env" value="${esc(e)}" ${(S.answers.environments || ['Production']).includes(e) ? 'checked' : ''} ${i === 0 ? 'disabled' : ''}> ${esc(e)}</label></div>`).join('')}</div>
        <div class="path-step-help">Each environment becomes its <strong>own Application Service</strong> — not a copy of one. That is deliberate: when staging falls over, production must not look degraded.</div>`,
      read: () => { S.answers.environments = [...document.querySelectorAll('.iv-env')].filter(c => c.checked || c.disabled).map(c => c.value); if (!S.answers.environments.length) S.answers.environments = ['Production']; }
    },
    {
      id: 'ownership', title: `Who owns and funds it?`,
      lead: () => `${esc(S.answers.anchor)} is running in ${S.answers.environments.length} place${S.answers.environments.length > 1 ? 's' : ''}. Now the part people get wrong most often.`,
      ask: `What is this called on a budget line or a roadmap? Who supports it?`,
      hint: `Often the same word you just used — but sometimes the vendor or product name.`,
      body: () => `<div class="form-grid"><div class="field full"><label>Product / application name</label><input id="iv-app" placeholder="e.g. Billing Platform" value="${esc(S.answers.ownership || '')}" list="iv-app-list">
        <datalist id="iv-app-list">${existing('Business Application').map(n => `<option>${esc(n.label)}</option>`).join('')}</datalist></div>
        <div class="field full"><label>Support group (optional)</label><input id="iv-owner" placeholder="e.g. Revenue Systems Team" value="${esc(S.answers.owner || '')}"></div></div>
        <div class="path-step-help">This is the <strong>Business Application</strong> — the thing you fund, own, and put on a roadmap. There is exactly <em>one</em>. The running copies from the last question are Application Services; there are ${S.answers.environments.length}. One <em>Instantiates</em> the others.<br><span class="ps-rule">Rule:</span> ${esc(ruleText('Business Application', 'Application Service', 'Instantiates'))}</div>`,
      read: () => { const v = (document.getElementById('iv-app').value || '').trim(); if (!v) return `Name the funded product, even if it matches what you typed earlier.`; S.answers.ownership = v; S.answers.owner = (document.getElementById('iv-owner').value || '').trim(); }
    },
    {
      id: 'capability', title: `What would the business be unable to do?`,
      lead: () => `The question that makes the money work.`,
      ask: `If ${'${app}'} were down all day, what could the business no longer do?`,
      hint: `Name activities, not systems. Add a row for everything that would stop.`,
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
      id: 'consumers', title: `Who consumes it, and what did you promise?`,
      lead: () => `The commercial layer. Skip it if nobody outside your team consumes this.`,
      ask: `Who consumes ${'${app}'} — and what was promised?`,
      hint: `All optional. Leave the consumer blank to skip this whole layer.`,
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
      id: 'infrastructure', title: `What does it sit on?`,
      lead: () => `Now down the stack. ${esc(S.answers.anchor)} has to run on something.`,
      ask: `What does ${'${anchor}'} run on, or need to work?`,
      hint: `List it or just say it in a sentence — commas, new lines, or plain prose like “two app servers that connect to a database on a VM”. I will pull out each thing, sort out the CSDM classes, and show you my reasoning.`,
      body: () => {
        if (S.parsing) return `<div class="explain-box"><strong>Reading what you wrote…</strong> I am pulling out each thing you named and working out which CSDM class it is. Anything genuinely ambiguous I will hand back to you rather than guess.</div>`;
        const pend = pendingInfra(), resolved = (S.answers.infra || []).filter(t => t.type);
        if (pend.length) {
          return `<div class="explain-box"><strong>${pend.length} term${pend.length > 1 ? 's need' : ' needs'} a decision from you.</strong> I will not guess these — guessing would teach you something false.</div>
            ${pend.map((t, i) => {
              const idx = S.answers.infra.indexOf(t);
              const opts = t.options ? t.options : null;
              return `<div class="path-step"><span class="path-step-title">&ldquo;${esc(t.term)}&rdquo;</span>
                <div class="path-step-help">${esc(t.ask || `I do not have this word in my vocabulary.`)}<br><em>${esc(t.why)}</em></div>
                <select class="iv-resolve" data-idx="${idx}">
                  <option value="">— choose —</option>
                  ${opts ? opts.map(o => `<option value="${esc(o.type || 'SKIP')}">${esc(o.label)}</option>`).join('')
                    : Object.keys(schema().nodeTypes).filter(t2 => typeof isPickableClass !== 'function' || isPickableClass(t2)).sort().map(t2 => `<option value="${esc(t2)}">${esc(t2)}</option>`).join('')}
                  <option value="SKIP">Leave this out of the model</option>
                </select></div>`;
            }).join('')}
            ${resolved.length ? `<div class="path-step-help">Already resolved: ${resolved.map(t => `<strong>${esc(t.label)}</strong> [${esc(t.type)}]`).join(', ')}.</div>` : ''}`;
        }
        return `<div class="field full"><label>Everything it runs on or needs</label>
            <textarea id="iv-infra" placeholder="e.g. two app servers that connect to a postgres database hosted on a VM in us-east-1">${esc(S.answers.infraText || '')}</textarea></div>
          <div class="path-step-help">I will nest these by depth using each class level in the schema, and connect them with <em>Depends on</em> / <em>Runs on</em> rather than <em>Contains</em> — deliberately. Only those labels carry a failure <em>upward</em> to your service; a chain built from <em>Contains</em> looks right on the canvas and produces no cascade at all.</div>
          ${resolved.length ? `<div class="explain-box">Recognised so far: ${resolved.map(t => `<strong>${esc(t.label)}</strong> <span class="muted">[${esc(t.type)}]</span>`).join(', ')}. Edit the box above to change them.${S.parseSource ? `<br><span class="muted">${S.parseSource}</span>` : ''}</div>` : ''}`;
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
            /* A trapped term never named anything of its own, so the class you picked is the label. */
            if (!t.label || t.generic) { t.label = s.value; t.generic = true; }
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
      id: 'resilience', title: `What survives what?`,
      lead: () => `This is the single most valuable answer in the whole interview.`,
      ask: `For each of these — what is the biggest loss it survives?`,
      hint: `Without this every node reads as a single point of failure, and the blast radius means nothing.`,
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
                <td><select class="iv-red" data-k="${esc(k)}">${REDUNDANCY.map(o => `<option value="${esc(o.v)}" ${cur === o.v ? 'selected' : ''}>${esc(o.label)} &mdash; survives ${esc(o.survives)}</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table>
          <div class="path-step-help">These are not free-text: they map onto the scope ranks the cascade engine uses. A <em>standby pair</em> ranks 2 and absorbs a rack loss; an <em>HA cluster</em> ranks 4 and absorbs an availability zone. Nothing here ranks high enough to absorb a <strong>whole cloud region</strong> — which we will come back to at the end.</div>
          ${skipped.length ? `<div class="explain-box"><strong>${skipped.length} item${skipped.length > 1 ? 's have' : ' has'} no redundancy field in this schema</strong> and will always read as a single point of failure: ${skipped.map(n => `${esc(n.label)} [${esc(n.type)}]`).join(', ')}. That is a gap in the schema, not in your answer.</div>` : ''}`;
      },
      read: () => { const r = S.answers.redundancy = S.answers.redundancy || {}; [...document.querySelectorAll('.iv-red')].forEach(s => { r[s.dataset.k] = s.value; }); }
    },
    {
      id: 'money', title: `What is it worth?`,
      lead: () => `Last stage. This is what turns a red icon into a number someone cares about.`,
      ask: `Roughly what is an hour of downtime worth?`,
      hint: `A yearly revenue figure is fine — the tool divides it down. Leave blank to skip.`,
      body: () => {
        const rev = S.answers.revenue || {}, parent = S.answers.capParent;
        /* The parent gets its own row — otherwise the double-count guard has nothing to catch. */
        const caps = (S.answers.capabilities || []).slice();
        if (parent && parent.name) caps.unshift(parent.name);
        const d = buildDraft(), costRows = d.nodes.concat(d.reusedNodes).filter(n => hasField(n.type, 'monthlyCost'));
        return `<table class="iv-grid"><thead><tr><th>Business activity</th><th>Revenue</th><th>Period</th></tr></thead><tbody>
            ${caps.map(c => { const k = mkey('Business Capability', c), v = rev[k] || {}, ex = findExisting('Business Capability', c);
              const already = ex && ex.metadata && ex.metadata.revenueAmount;
              const isParent = parent && parent.name && norm(c) === norm(parent.name);
              return `<tr class="${isParent ? 'iv-parentrow' : ''}"><td><strong>${esc(c)}</strong>${isParent ? ` <span class="iv-tag">parent of ${esc((parent.children || []).length)}</span>` : ''}${already ? `<br><span class="muted">already set to ${esc(ex.metadata.revenueAmount)} ${esc(ex.metadata.revenuePeriod || '')} — changing this edits your existing model</span>` : ''}</td>
                <td><input class="iv-rev" data-k="${esc(k)}" placeholder="e.g. 12000000" value="${esc(v.amount || (already || ''))}"></td>
                <td><select class="iv-per" data-k="${esc(k)}">${PERIODS.map(p => `<option ${(v.period || (ex && ex.metadata && ex.metadata.revenuePeriod) || 'per year') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table>
          <div class="path-step-help">Revenue attaches to the <strong>Business Capability</strong>, not to a server — because that is the level at which money is actually earned. <code>affectedRevenuePerHour</code> sums every capability a failure reaches.</div>
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
      const already = edgeExists(from, to, label);
      if (!already) edges.push({ from, to, label });
      claims.push({ kind: 'edge', ref: `${from}|${to}|${label}`, label, from, to, fromType, toType, fromLabel, toLabel, why, already });
    }

    const appId = resolve('Business Application', a.ownership, { description: a.ownership, owner: a.owner || '' },
      { asked: `what this is called on a budget line`, why: `The product you fund and own. Exactly one of these, however many copies are running.` },
      { why: `Already in your model, so I am reusing it rather than minting a second one with the same name.` });

    /* Optional capability parent, created before the children so Contains reads downward. */
    let parentId = null;
    const cp = a.capParent;
    if (cp && cp.name && (cp.children || []).length > 1) {
      parentId = resolve('Business Capability', cp.name, { description: cp.name },
        { why: `You said these roll up into one bigger activity, so this is the parent Business Capability.` },
        { why: `Already in your model — reusing it as the parent.` });
      link(appId, parentId, 'Business Application', 'Business Capability', 'Provides', a.ownership, cp.name,
        `The application provides the parent activity too.`);
    }

    const capIds = (a.capabilities || []).map(label => {
      const id = resolve('Business Capability', label, { description: label },
        { asked: `what the business could no longer do`, why: `What the business does, independent of the software doing it. The only class that can carry a revenue figure.` },
        { why: `Already in your model, so I am reusing it. Two applications providing the same capability is exactly how a shared business consequence gets modelled.` });
      link(appId, id, 'Business Application', 'Business Capability', 'Provides', a.ownership, label,
        `Without this edge, an outage can only ever be reported as a red icon — never as a business consequence.`);
      if (parentId && (cp.children || []).includes(label))
        link(parentId, id, 'Business Capability', 'Business Capability', 'Contains', cp.name, label,
          `A sub-activity of ${cp.name}. Contains propagates downward, which is why a revenue figure belongs on one level only.`);
      return id;
    });

    /* Application Services, one per environment. */
    const n = (a.environments || ['Production']).length;
    let prodId = null, prodLabel = '';
    (a.environments || ['Production']).forEach(env => {
      const isProd = env === 'Production', label = isProd ? a.anchor : `${a.anchor} (${env})`;
      const id = resolve('Application Service', label, { description: label, owner: a.owner || '', environment: env, operationalStatus: 'Operational' },
        { phrase: a.anchor, asked: isProd ? `what someone would call you about` : '', why: isProd ? `The running instance — the layer that can actually fail, and where simulation starts.` : `A separate service, so an outage here cannot make Production look degraded.` },
        { why: `Already in your model, so I am reusing it rather than creating a second ${env} copy.` });
      link(appId, id, 'Business Application', 'Application Service', 'Instantiates', a.ownership, label,
        `One funded application, ${n} running instance${n > 1 ? 's' : ''}.`);
      if (isProd || !prodId) { prodId = id; prodLabel = label; }
    });

    /* Sell/Consume layer: Business Service -> Service Offering -> the running service. */
    const cs = a.consumers;
    if (cs && cs.consumerType) {
      const bsId = resolve('Business Service', cs.serviceName, { description: cs.serviceName, owner: a.owner || '', consumerType: cs.consumerType },
        { why: `The consumable face of the capability — what a ${cs.consumerType.toLowerCase()} consumer thinks they are buying. It cannot be failure-simulated directly; it goes red only because something under it did.` },
        { why: `Already in your model, so I am reusing it as the consumable face.` });
      capIds.forEach((capId, i) => link(bsId, capId, 'Business Service', 'Business Capability', 'Provides', cs.serviceName, a.capabilities[i],
        `The service is how this capability is actually consumed.`));
      const tiers = (cs.tiers || []).filter(Boolean);
      (tiers.length ? tiers : [`${cs.serviceName} Offering`]).forEach(tier => {
        const offId = resolve('Service Offering', tier, { description: tier, owner: a.owner || '', availabilityTarget: cs.availability || '', supportHours: cs.supportHours || '' },
          { why: `Where the commitment and the price live. The same Business Service can be offered several ways.` },
          { why: `Already in your model, so I am reusing this offering.` });
        link(bsId, offId, 'Business Service', 'Service Offering', 'Offers', cs.serviceName, tier, `One service, ${tiers.length || 1} way${(tiers.length || 1) > 1 ? 's' : ''} of buying it.`);
        if (prodId) link(offId, prodId, 'Service Offering', 'Application Service', 'Depends on', tier, prodLabel,
          `This is the second path by which a failure becomes a business consequence — the offering depends on the thing that actually runs.`);
        if (cs.availability) {
          const cmLabel = `${tier}: ${cs.availability}`;
          const cmId = resolve('Service Commitment', cmLabel, { description: `${cs.availability} availability, ${cs.supportHours}` },
            { why: `A promise you can name. Modelling it means an outage can be reported as a broken commitment, not just a red icon.` },
            { why: `Already in your model, so I am reusing this commitment.` });
          link(offId, cmId, 'Service Offering', 'Service Commitment', 'Contains', tier, cmLabel,
            `The commitment belongs to the offering, not to the service — different tiers promise different things.`);
        }
      });
    }

    /* Infrastructure: nest by schema level, always with a label that propagates upward.
       Hosting/physical classes nest on the hosting spine; data, network and security leaves
       hang off the deepest hosting ancestor. Without this, a Rack would end up parented to a
       Database Instance purely because the DB happened to be the deepest node placed. */
    const placed = [{ id: prodId, type: 'Application Service', label: prodLabel, level: levelOf('Application Service'), spine: true }];
    const terms = (a.infra || []).filter(t => t.type && !t.skip).slice().sort((x, y) => levelOf(x.type) - levelOf(y.type));
    terms.forEach(t => {
      const lvl = levelOf(t.type);
      const onSpine = HOSTING.has(t.type) || RUNTIME.has(t.type);
      let parent = null, lab = null;
      if (onSpine) {
        /* Hosting and runtime nest down the spine — that is the chain a failure travels. */
        placed.filter(p => p.spine).sort((p, q) => q.level - p.level).some(p => {
          if (p.level >= lvl) return false;
          const l = pickLabel(p.type, t.type);
          if (l) { parent = p; lab = l; return true; }
          return false;
        });
      } else {
        /* Dependency leaves attach to the service that needs them. */
        const l = pickLabel('Application Service', t.type);
        if (l) { parent = placed[0]; lab = l; }
        else placed.filter(p => p.spine).sort((p, q) => q.level - p.level).some(p => {
          if (p.level >= lvl) return false;
          const l2 = pickLabel(p.type, t.type);
          if (l2) { parent = p; lab = l2; return true; }
          return false;
        });
      }
      const generic = norm(t.label) === norm(t.type);
      const qty = (t.count || 1) > 1
        ? ` You said there is more than one — so I made it one CI with a redundancy value rather than two nodes. That is what lets the cascade absorb losing one of them; two separate nodes could not.`
        : ``;
      const id = resolve(t.type, t.label, { description: t.label, environment: 'Production' },
        { phrase: t.phrase && norm(t.phrase) !== norm(t.label) ? t.term : '', generic, why: t.why + qty },
        { why: `Already in your model, so I am reusing it. ${t.why}` });
      placed.push({ id, type: t.type, label: t.label, level: lvl, spine: onSpine });
      if (parent) link(parent.id, id, parent.type, t.type, lab, parent.label, t.label,
        `${parent.label} ${lab.toLowerCase()} ${t.label}. This direction is what carries a ${t.label} failure up to your service — ${lab} propagates to the source, Contains would not.`);
      else link(prodId, id, 'Application Service', t.type, null, prodLabel, t.label,
        `A ${t.type} cannot attach directly to an Application Service in this schema, and nothing you listed sits between them. Add something that lives in it — then this will connect.`);
    });

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
      ${reN ? `<div class="explain-box"><strong>${reN} of these already exist</strong> in your model, so I am pointing at them instead of creating duplicates.</div>` : ''}
      ${d.metaUpdates.length ? `<div class="explain-box explain-bad"><strong>${d.metaUpdates.length} change${d.metaUpdates.length > 1 ? 's' : ''} to nodes you already have.</strong> ${d.metaUpdates.map(u => `${esc(u.label)}: ${esc(u.key)} ${u.old ? `${esc(u.old)} &rarr; ` : `&rarr; `}${esc(u.value)}`).join('; ')}. Untick that node to leave it alone.</div>` : ''}
      <h3 class="iv-h">Things I think you have (${newN} new${reN ? `, ${reN} reused` : ''})</h3>
      ${nodeC.map(c => claimCard(c, d.claims.indexOf(c))).join('')}
      <h3 class="iv-h">How I think they connect (${newE} new${edgeC.length - newE ? `, ${edgeC.length - newE} already there` : ''})</h3>
      ${edgeC.map(c => claimCard(c, d.claims.indexOf(c))).join('')}
      ${orphanC.length ? `<h3 class="iv-h">Could not connect (${orphanC.length})</h3>${orphanC.map(c => claimCard(c, -1)).join('')}` : ''}
      <div class="explain-box"><strong>Why the labels matter.</strong> Every edge above uses <em>Depends on</em>, <em>Runs on</em>, <em>Uses</em>, <em>Instantiates</em> or <em>Provides</em> — never <em>Contains</em> for the dependency spine. Only those carry a failure from the thing that broke up to the business activity that suffers. It is the difference between a diagram and a model.</div>
      <div class="actions"><button class="secondary" onclick="CSDM_IV.back()">Back</button><button onclick="CSDM_IV.commit()">Add these to the model</button></div>`);
  }

  function commit() {
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

    const ok = markChange(`Interview: ${S.answers.anchor}`, () => {
      currentModelData.nodes.push(...keptNodes.filter(Boolean));
      currentModelData.edges.push(...keptEdges.filter(Boolean));
      updates.forEach(u => { const n = getNode(u.id); if (n) { n.metadata = n.metadata || {}; n.metadata[u.key] = u.value; } });
      if (typeof ensurePositions === 'function') ensurePositions();
    });
    if (!ok) return alert(`Nothing changed.`);
    const v = window.CSDM_VALIDATOR && window.CSDM_VALIDATOR.validateGraph ? window.CSDM_VALIDATOR.validateGraph(currentModelData) : null;
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
        A failure origin has a <em>scope rank</em>: Physical Host 1, Rack 2, Data Center 3, Availability Zone 4, Cloud Region 5. A node absorbs a failure only when its redundancy rank is at least the origin rank — and the ranks available to you are <em>Redundant pair</em> 2 and <em>HA cluster</em> / <em>Auto-scaling</em> 4.
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
    const st = STAGES[S.i], lead = typeof st.lead === 'function' ? st.lead() : st.lead;
    const askText = String(st.ask)
      .replace('${app}', `<strong>${esc(S.answers.ownership || S.answers.anchor || 'it')}</strong>`)
      .replace('${anchor}', `<strong>${esc(S.answers.anchor || 'it')}</strong>`);
    setTitle(st.title);
    body(`<div class="iv-progress">${STAGES.map((s, i) => `<span class="iv-dot ${i === S.i ? 'on' : i < S.i ? 'done' : ''}">${esc(s.id)}</span>`).join('')}<span class="iv-dot">review</span></div>
      <p class="muted">${lead}</p>
      <p class="iv-ask">${askText}</p>
      <p class="muted iv-hint">${st.hint}</p>
      ${st.body()}
      <div id="iv-err" class="explain-box explain-bad hidden"></div>
      <div class="actions">${S.i ? `<button class="secondary" onclick="CSDM_IV.back()">Back</button>` : `<button class="secondary" onclick="closeDialog()">Cancel</button>`}
        <button onclick="CSDM_IV.next()">${S.i === STAGES.length - 1 ? 'See the proposal' : 'Next'}</button></div>`);
    setTimeout(() => { const f = document.querySelector('#modal-body input:not([type=checkbox]):not([disabled]), #modal-body textarea'); if (f) f.focus(); }, 60);
  }

  function next() {
    const err = STAGES[S.i].read();
    if (err === `_stay`) return;
    if (err) { const e = document.getElementById('iv-err'); e.textContent = err; e.classList.remove('hidden'); return; }
    if (STAGES[S.i].id === 'infrastructure' && pendingInfra().length) return renderStage();
    S.i++; renderStage();
  }
  function back() { if (S.i >= STAGES.length) S.i = STAGES.length - 1; else if (S.i > 0) S.i--; S.draft = null; renderStage(); }
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
    S = { i: 0, answers: { environments: ['Production'], capabilities: [''], infra: [], redundancy: {}, revenue: {}, cost: {} }, draft: null, parsing: false, parsedText: '', parseSource: '' };
    if (typeof closeBarMenus === 'function') closeBarMenus();
    renderStage();
  }

  window.CSDM_IV = {
    start, next, back, commit, regionCloser,
    addCap: () => { readCapsLoose(); S.answers.capabilities.push(''); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-cap'); if (r.length) r[r.length - 1].focus(); }, 60); },
    /* Re-render on change so the hierarchy question appears as soon as a second activity is named. */
    refreshCaps: () => { const active = document.activeElement, i = [...document.querySelectorAll('.iv-cap')].indexOf(active); readCapsLoose(); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-cap'); if (i >= 0 && r[i]) r[i].focus(); }, 40); },
    delCap: i => { readCapsLoose(); S.answers.capabilities.splice(i, 1); if (!S.answers.capabilities.length) S.answers.capabilities = ['']; renderStage(); },
    addTier: () => { readTiersLoose(); S.answers.consumers.tiers.push(''); renderStage(); setTimeout(() => { const r = document.querySelectorAll('.iv-tier'); if (r.length) r[r.length - 1].focus(); }, 60); },
    delTier: i => { readTiersLoose(); S.answers.consumers.tiers.splice(i, 1); if (!S.answers.consumers.tiers.length) S.answers.consumers.tiers = ['']; renderStage(); },
    _state: () => S, _draft: () => buildDraft()
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLaunchers); else addLaunchers();
})();
