/* Interview Mode lexicon — maps the words people actually use onto CSDM classes,
   and carries the reason WHY each word implies that class. See INTERVIEW_MODE_SPEC.md §4.
   Prose uses template literals only. */
(function (root) {
  /* Ambiguity traps are checked FIRST and always beat a class match. These words are
     genuinely ambiguous in CSDM; guessing would teach a falsehood. */
  const traps = [
    {
      key: 'service', pattern: /\bservices?\b/i,
      ask: `Which kind of “service” do you mean?`,
      why: `“Service” is the single most overloaded word in CSDM — it maps to four different classes.`,
      options: [
        { label: `Something customers buy or subscribe to`, type: 'Business Service' },
        { label: `A running system that can break`, type: 'Application Service' },
        { label: `A capability IT offers to other IT teams`, type: 'Technical Service' },
        { label: `A systemd / Windows service on a box`, type: 'Application' }
      ]
    },
    {
      key: 'app', pattern: /\b(apps?|applications?|systems?|platforms?)\b/i,
      ask: `Do you mean the product you fund, or the copy that is running?`,
      why: `This is the distinction CSDM exists to make, and the one people get wrong most often.`,
      options: [
        { label: `The product we fund and own`, type: 'Business Application' },
        { label: `The copy that is running right now`, type: 'Application Service' },
        { label: `A deployable piece inside it`, type: 'Application' }
      ]
    },
    {
      key: 'cluster', pattern: /\bclusters?\b/i,
      ask: `What kind of cluster?`,
      why: `The cluster type decides what its failure domain is.`,
      options: [
        { label: `Containers (Kubernetes / OpenShift)`, type: 'Kubernetes Cluster' },
        { label: `VMs / hypervisor (vSphere, Hyper-V)`, type: 'Virtualization Cluster' },
        { label: `A general compute pool`, type: 'Compute Cluster' }
      ]
    },
    {
      key: 'server', pattern: /\b(servers?|boxes|box|hosts?|machines?)\b/i,
      ask: `Physical or virtual?`,
      why: `Physical and virtual sit at different levels — and only one of them can lose a power feed.`,
      options: [
        { label: `Physical hardware`, type: 'Physical Host' },
        { label: `A virtual machine`, type: 'VM' },
        { label: `A member of a cluster`, type: 'Compute Node' }
      ]
    },
    {
      key: 'database', pattern: /\b(databases?|dbs?)\b/i,
      ask: `The database itself, or the database service your team offers?`,
      why: `CSDM 5 lets you model “the database service we offer” separately from the instance running it.`,
      options: [
        { label: `The running instance`, type: 'Database Instance' },
        { label: `The service we offer around it`, type: 'Data Service Instance' }
      ]
    },
    {
      key: 'environment', pattern: /\b(environments?|prod|production|staging|stage|dev|development|uat|qa)\b/i,
      ask: `Environment is not a class in CSDM — it is a property of an Application Service.`,
      why: `Recording it as a property rather than a node is why one environment failing cannot make another look degraded.`,
      options: [{ label: `Understood — skip this term`, type: null }]
    },
    {
      key: 'instance', pattern: /\binstances?\b/i,
      ask: `Instance of what?`,
      why: `“Instance” names a level, not a thing.`,
      options: [
        { label: `A virtual machine`, type: 'VM' },
        { label: `A database`, type: 'Database Instance' },
        { label: `A running application`, type: 'Application Service' }
      ]
    }
  ];

  /* Class groups. Longest match wins; every entry carries its own teaching line. */
  const groups = [
    { name: 'Compute & orchestration', entries: [
      { pattern: /\b(k8s|kubernetes|eks|aks|gke|openshift)\b/i, type: 'Kubernetes Cluster', why: `A managed container platform — the cluster is the failure domain, not the individual pod.` },
      { pattern: /\b(vsphere|esxi?|vcenter|hyper-?v)\b/i, type: 'Virtualization Cluster', why: `A hypervisor cluster: it can move guests between hosts, so it survives losing one host.` },
      { pattern: /\b(hpc|slurm|compute pool)\b/i, type: 'Compute Cluster', why: `A pool of machines treated as one resource.` },
      { pattern: /\b(node pool|worker nodes?|compute nodes?)\b/i, type: 'Compute Node', why: `One member of a cluster — a member, not the pool itself.` }
    ]},
    { name: 'Runtime', entries: [
      { pattern: /\b(vms?|virtual machines?|ec2|guests?)\b/i, type: 'VM', why: `A guest machine: it runs on something, and that host is a separate failure domain.` },
      { pattern: /\b(namespaces?)\b/i, type: 'Namespace', why: `A logical partition inside a cluster.` },
      { pattern: /\b(deployments?|statefulsets?|daemonsets?|workloads?)\b/i, type: 'Workload', why: `The declared desired state, not the running copy.` },
      { pattern: /\b(pods?)\b/i, type: 'Pod', why: `The smallest schedulable unit — usually replaceable, so rarely the real risk.` },
      { pattern: /\b(containers?)\b/i, type: 'Container', why: `A running process from an image.` },
      { pattern: /\b(container images?|docker images?|images?)\b/i, type: 'Container Image', why: `A build artifact — it cannot fail at runtime, so it is a design CI.` }
    ]},
    { name: 'Data & storage', entries: [
      { pattern: /\b(postgres(ql)?|psql|mysql|mariadb|oracle|sql ?server|mssql|mongo(db)?|redis|db2|rds|aurora|cosmos)\b/i, type: 'Database Instance', why: `A specific running database — the classic single point of failure, which is why we ask next how many there are.` },
      { pattern: /\b(san|nas|volumes?|ebs|datastores?|luns?|pvcs?|persistent volumes?)\b/i, type: 'Storage Volume', why: `Block or file storage attached to something else.` },
      { pattern: /\b(data service|database service|db platform)\b/i, type: 'Data Service Instance', why: `A service wrapper around storage — the database service you offer, distinct from the instance.` }
    ]},
    { name: 'Network', entries: [
      { pattern: /\b(f5|haproxy|albs?|nlbs?|elbs?|load ?balancers?|lbs?)\b/i, type: 'Load Balancer', why: `Distributes traffic — and it is usually the redundant thing sitting in front of everything else, so what it survives is worth answering carefully.` },
      { pattern: /\b(ingress(es)?|ingress controllers?|api gateways?)\b/i, type: 'Ingress', why: `The cluster front door for inbound traffic.` },
      { pattern: /\b(vlans?|network segments?|vpcs?)\b/i, type: 'Network Segment', why: `A broadcast or routing boundary.` },
      { pattern: /\b(subnets?|cidrs?)\b/i, type: 'Subnet', why: `An address range inside a segment.` },
      { pattern: /\b(dns|cnames?|a records?|route ?53|dns records?)\b/i, type: 'DNS Record', why: `A name pointing at an address — cheap to model and a surprisingly common outage cause.` },
      { pattern: /\b(network service|connectivity service)\b/i, type: 'Network Service Instance', why: `The service wrapper around network plumbing.` }
    ]},
    { name: 'Security', entries: [
      { pattern: /\b(certs?|certificates?|tls|ssl)\b/i, type: 'Certificate', why: `Expires on a date — a scheduled outage waiting to happen.` },
      { pattern: /\b(key ?vaults?|kms|hsm|vaults?)\b/i, type: 'Key Vault', why: `Holds secrets; everything that reads from it depends on it.` },
      { pattern: /\b(secrets?|credentials?|api keys?)\b/i, type: 'Secret', why: `An individual stored credential.` }
    ]},
    { name: 'Cloud & physical', entries: [
      { pattern: /\b(cloud regions?|regions?|us-east-?\d?|us-west-?\d?|eu-west-?\d?|eu-central-?\d?|ap-southeast-?\d?)\b/i, type: 'Cloud Region', why: `The largest failure domain in this model — and nothing in the redundancy list survives losing one.` },
      { pattern: /\b(azs?|availability zones?)\b/i, type: 'Availability Zone', why: `An isolated site inside a region.` },
      { pattern: /\b(data ?cent(er|re)s?|dcs?|colos?|sddc)\b/i, type: 'Data Center', why: `A physical site. A standby pair does not survive losing one.` },
      { pattern: /\b(racks?|cabinets?)\b/i, type: 'Rack', why: `A physical enclosure — everything in it shares power and cooling.` },
      { pattern: /\b(blades?|bare ?metal|physical hosts?|hypervisor hosts?)\b/i, type: 'Physical Host', why: `A physical machine; the smallest physical failure domain.` }
    ]},
    { name: 'Facility', entries: [
      { pattern: /\b(ups|batter(y|ies))\b/i, type: 'UPS', why: `Backup power — the thing that makes a power cut survivable.` },
      { pattern: /\b(pdus?|power strips?|power distribution)\b/i, type: 'PDU', why: `Distributes power within a rack.` },
      { pattern: /\b(generators?|gensets?|diesel)\b/i, type: 'Generator', why: `Long-run backup power.` },
      { pattern: /\b(cracs?|cooling|air handlers?)\b/i, type: 'CRAC Unit', why: `Cooling; without it the room shuts itself down.` },
      { pattern: /\b(chillers?)\b/i, type: 'Chiller', why: `Supplies chilled water to the cooling units.` },
      { pattern: /\b(facility service|power service|cooling service)\b/i, type: 'Facility Service Instance', why: `The service wrapper that lets a host depend on “power and cooling” as one thing.` }
    ]}
  ];

  const flat = [];
  groups.forEach(g => g.entries.forEach(e => flat.push(Object.assign({ group: g.name }, e))));
  /* Longest pattern source first, so `kubernetes cluster` beats `cluster`. */
  flat.sort((a, b) => b.pattern.source.length - a.pattern.source.length);

  /* ---------- fragmenting prose ---------- */
  /* Nobody answers in a tidy list. `the application has two app servers that connect to a
     database that is hosted on a VM` is ONE sentence naming THREE things; splitting only on
     commas and `and` collapsed the whole sentence into a single node. So we also split on the
     connectives that mean "…and now a different thing": possession, relative clauses, hosting
     verbs, and prepositions. Verbs that double as infrastructure nouns (`host`, `hosts`) are
     deliberately absent — splitting on those would eat the noun the user just named. */
  const VERB = `(?:hosted|hosting|running|runs|sitting|sits|living|lives|deployed|installed|located|stored|served|serving|backed|fronted|fronting|attached|mounted|provisioned|managed|connects|connected|connecting|connect|talks|talking|talk|depends|depending|depend|uses|using|requires|require|needs)`;
  const PREP = `(?:on|onto|to|in|into|inside|within|at|by|from|with|behind|under|across|via|through|over)`;
  const BARE = `(?:on|onto|in|inside|within|behind|underneath|under|via|through|with|across)`;
  const HAS = `(?:has|have|had|contains|contain|includes|include|comprises|comprise|consists\\s+of|consist\\s+of|is\\s+made\\s+up\\s+of|made\\s+up\\s+of)`;
  const SPLIT = new RegExp([
    `[,;\\n+]`,
    `\\s+&\\s+`,
    `\\s+(?:and|plus|also|then)\\s+`,
    `\\s+${HAS}\\s+`,
    `\\s+(?:that|which|who)\\s+(?:is|are|was|were)?\\s*${VERB}(?:\\s+${PREP})?\\s+`,
    `\\s+(?:is|are|was|were)\\s+${VERB}(?:\\s+${PREP})?\\s+`,
    `\\s+${VERB}(?:\\s+${PREP})?\\s+`,
    `\\s+(?:in\\s+front\\s+of|on\\s+top\\s+of|part\\s+of|backed\\s+up\\s+by)\\s+`,
    `\\s+${BARE}\\s+`,
    `\\s*/(?![^\\s]*\\d)`
  ].join('|'), 'gi');
  /* A fragment that only says "the thing we are describing" is the subject of the sentence,
     not a dependency of it — the anchor is already an Application Service. */
  const SELF = /^(?:the|our|my|this|that|a|an|its|their|it|we|they|there|apps?|applications?|services?|systems?|platforms?|stacks?|solutions?|setups?|things?|everything|all|also|too)$/i;
  /* Words that carry no naming information, used to decide whether a fragment named something
     of its own ("Rack A1") or only used the generic class word ("a load balancer"). */
  const STOP = /^(?:a|an|the|our|my|its|their|this|that|some|of|for|with|in|on|at|is|are|and|to|s|two|2|three|3|four|4|five|5|six|6|several|many|multiple|couple|pair|redundant|clustered|paired|new|old|main|primary)$/i;

  /* Quantifiers are captured before stripping: "two VMs" is one CI with a redundancy of
     `Redundant pair`, not two nodes. Recording quantity as redundancy is what lets the
     cascade absorb one of them failing. */
  const QUANTIFIER = /^(two|2|three|3|four|4|several|many|multiple|a (?:couple|pair) of|redundant|clustered|paired)\b/i;
  const QUANT_BEFORE = /(?:^|\s)(two|2|three|3|four|4|five|5|six|6|several|many|multiple|a\s+couple\s+of|a\s+pair\s+of|couple\s+of|pair\s+of|redundant|clustered|paired)\s*$/i;
  const ARTICLES = /^(a|an|the|our|some|its|his|her|their|two|3|three|4|four|several|many|multiple|couple of|pair of|redundant|clustered|paired)\s+/i;
  function rank(w) { return /^(two|2|a couple of|a pair of|couple of|pair of|paired|redundant)$/.test(w) ? 2 : 3; }
  function countOf(t) { const m = String(t || '').trim().match(QUANTIFIER); if (!m) return 1; return rank(m[1].toLowerCase()); }
  /* The quantifier sits just before the noun, not at the start of the sentence — "the app has
     two app servers" must still count 2. */
  function countBefore(prefix) { const m = String(prefix || '').match(QUANT_BEFORE); return m ? rank(m[1].toLowerCase().replace(/\s+/g, ' ')) : 1; }
  function strip(t) { let s = String(t || '').trim(); let prev; do { prev = s; s = s.replace(ARTICLES, ''); } while (s !== prev); return s.trim(); }

  /* If the fragment is just the generic word ("a load balancer"), label it with the class name.
     If it carries a proper name ("Rack A1", "pgh-core-k8s"), keep the user's own words. */
  function labelFor(term, phrase, type) {
    const s = strip(term);
    if (!s) return type;
    if (s.toLowerCase() === String(phrase || '').toLowerCase()) return type;
    return s;
  }

  function split(text) {
    return (' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ')
      .split(SPLIT)
      .map(s => String(s || '').replace(/^[\s\-•*]+|[\s.]+$/g, '').trim())
      .filter(s => s && !s.split(/[\s\-]+/).every(w => !w || SELF.test(w)));
  }

  /* ---------- resolving one fragment ---------- */
  /* Every pattern is scanned across the whole fragment, not just the first hit, so a fragment
     the splitter failed to break still yields every thing named in it. */
  function rawMatches(frag) {
    const out = [];
    function push(pattern, extra) {
      const re = new RegExp(pattern.source, 'gi');
      let m;
      while ((m = re.exec(frag)) !== null) {
        if (m[0]) out.push(Object.assign({ start: m.index, end: m.index + m[0].length, phrase: m[0] }, extra));
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    }
    flat.forEach(e => push(e.pattern, { kind: 'class', entry: e }));
    traps.forEach(tr => push(tr.pattern, { kind: 'trap', trap: tr }));
    /* Longest span wins, so `container image` beats the `image` and `container` inside it. */
    out.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    out.forEach(m => { if (!kept.some(k => m.start < k.end && k.start < m.end)) kept.push(m); });
    return kept.sort((a, b) => a.start - b.start);
  }

  /* Touching matches are one compound noun — `app server`, `vsphere cluster`, `kubernetes
     cluster` name a single thing, not two. */
  function chunk(frag, ms) {
    const out = [];
    ms.forEach(m => {
      const g = out[out.length - 1];
      if (g && /^[\s\-]*$/.test(frag.slice(g.end, m.start))) { g.end = m.end; g.parts.push(m); }
      else out.push({ start: m.start, end: m.end, parts: [m] });
    });
    return out;
  }

  /* Inside a compound noun a class beats a trap — `vsphere cluster` is a Virtualization
     Cluster, not an ambiguous "cluster". With no class, the head noun (rightmost) wins:
     in `app servers` the "app" is a modifier and "servers" is the thing. */
  function winner(g) {
    const cls = g.parts.filter(p => p.kind === 'class');
    if (cls.length) return cls.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    return g.parts[g.parts.length - 1];
  }

  /* True when the fragment used only lexicon words — nothing left over to name a node with. */
  function isGeneric(frag, ms) {
    let rest = '', last = 0;
    ms.forEach(m => { rest += frag.slice(last, m.start) + ' '; last = m.end; });
    rest += frag.slice(last);
    return !rest.split(/[\s\-]+/).some(w => { const c = w.replace(/[^a-z0-9-]/gi, ''); return c && !STOP.test(c); });
  }

  /* One pass over free text -> an ordered list of findings, one per thing named. */
  function scan(text) {
    const out = [];
    split(text).forEach(frag => {
      const ms = rawMatches(frag);
      if (!ms.length) { out.push({ kind: 'unknown', term: frag, phrase: '', label: strip(frag), generic: false, count: countOf(frag) }); return; }
      const gs = chunk(frag, ms), generic = isGeneric(frag, ms), single = gs.length === 1;
      gs.forEach(g => {
        const w = winner(g), phrase = frag.slice(g.start, g.end);
        const label = generic ? '' : strip(single ? frag : phrase);
        const count = countBefore(frag.slice(0, g.start));
        if (w.kind === 'class') out.push({ kind: 'class', type: w.entry.type, why: w.entry.why, group: w.entry.group, term: frag, phrase, label: label || w.entry.type, generic, count });
        else out.push({ kind: 'trap', trap: w.trap, term: frag, phrase, label, generic, count });
      });
    });
    return out;
  }

  /* Kept for callers that hand in a single already-split term. */
  function match(term) { const r = scan(term); return r.length ? r[0] : null; }

  root.CSDM_LEXICON = { traps, groups, flat, scan, match, split, strip, labelFor, countOf };
})(typeof self !== 'undefined' ? self : this);
