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
      { pattern: /\b(f5|haproxy|albs?|nlbs?|elbs?|load ?balancers?|lbs?)\b/i, type: 'Load Balancer', why: `Distributes traffic. Note this schema has no redundancy field for it, so it will always read as a single point of failure.` },
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

  /* Quantifiers are captured before stripping: "two VMs" is one CI with a redundancy of
     `Redundant pair`, not two nodes. Recording quantity as redundancy is what lets the
     cascade absorb one of them failing. */
  const QUANTIFIER = /^(two|2|three|3|four|4|several|many|multiple|a (?:couple|pair) of|redundant|clustered|paired)\b/i;
  const ARTICLES = /^(a|an|the|our|some|its|his|her|their|two|3|three|4|four|several|many|multiple|couple of|pair of|redundant|clustered|paired)\s+/i;
  function countOf(t) { const m = String(t || '').trim().match(QUANTIFIER); if (!m) return 1; const w = m[1].toLowerCase(); return /^(two|2|a couple of|a pair of|paired|redundant)$/.test(w) ? 2 : 3; }
  function strip(t) { let s = String(t || '').trim(); let prev; do { prev = s; s = s.replace(ARTICLES, ''); } while (s !== prev); return s.trim(); }

  /* If the fragment is just the generic word ("a load balancer"), label it with the class name.
     If it carries a proper name ("Rack A1", "pgh-core-k8s"), keep the user's own words. */
  function labelFor(term, phrase, type) {
    const s = strip(term);
    if (!s) return type;
    if (s.toLowerCase() === String(phrase || '').toLowerCase()) return type;
    return s;
  }

  /* Class match runs FIRST: a specific word disambiguates an otherwise-trapped one
     ("vsphere cluster" is a Virtualization Cluster, not an ambiguous "cluster").
     Traps fire only when the ambiguous word is the sole signal. */
  function match(term) {
    const t = String(term || '').trim();
    if (!t) return null;
    const count = countOf(t);
    for (const e of flat) {
      const m = t.match(e.pattern);
      if (m) return { kind: 'class', type: e.type, why: e.why, group: e.group, term: t, phrase: m[0], label: labelFor(t, m[0], e.type), count };
    }
    for (const tr of traps) if (tr.pattern.test(t)) return { kind: 'trap', trap: tr, term: t, label: strip(t), count };
    return { kind: 'unknown', term: t, label: strip(t), count };
  }

  function split(text) {
    return String(text || '')
      .split(/[,;\n]|\band\b|\+|\/(?![^\s]*\d)/i)
      .map(s => s.replace(/^[\s\-•*]+|[\s.]+$/g, '').trim())
      .filter(Boolean);
  }

  root.CSDM_LEXICON = { traps, groups, flat, match, split, strip, labelFor };
})(typeof self !== 'undefined' ? self : this);
