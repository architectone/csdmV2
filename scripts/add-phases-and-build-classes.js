/*
 * One-off schema edit (run once, then delete or keep for reference):
 *   1. Application Service --Depends on--> Application Service   (CSDM: Service Instance --Depends on/sends Data To--> Service Instance)
 *   3. `phase` (Crawl/Walk/Run/Fly) on every node type
 *   5. Dynamic CI Group + SDLC Component classes and their four CSDM relationship rows
 *
 * shared/csdmSchema.js is a minified one-liner of the form
 *   <prefix>const schema={...JSON...};schema.visuals=...<suffix>
 * so we slice the JSON out, mutate it, and put it back untouched around the edges.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'shared', 'csdmSchema.js');
const text = fs.readFileSync(FILE, 'utf8');

const START = 'const schema=';
const END = ';schema.visuals=';
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a < 0 || b < 0) throw new Error('Could not locate the schema literal — did the file shape change?');

const prefix = text.slice(0, a + START.length);
const suffix = text.slice(b);
const schema = JSON.parse(text.slice(a + START.length, b));

/* ------------------------------------------------------------------ *
 * 5. New classes
 * ------------------------------------------------------------------ */
const OWNER = { key: 'owner', label: 'Owner / Support Group', type: 'text' };
const DESC = { key: 'description', label: 'Description', type: 'textarea' };

schema.nodeTypes['Dynamic CI Group'] = {
  domain: 'Service Delivery',
  prefix: 'dyncigrp',
  color: '#f5a623',
  level: 5,
  description: 'Dynamic CI Group — a query-defined collection of configuration items (all web servers in Detroit, all Oracle databases in Boston). It is an operational CI: it can be named in the CI field of an incident, problem or change, which is how a whole class of hardware gets one support group. A group cannot contain other groups. ServiceNow class: cmdb_ci_query_based_service.',
  metadataFields: [
    DESC,
    OWNER,
    { key: 'groupQuery', label: 'CMDB Group Query', type: 'text' },
    { key: 'memberClass', label: 'Member CI Class', type: 'text' },
    { key: 'operationalStatus', label: 'Operational Status', type: 'select', options: ['Operational', 'Non-Operational', 'Retired'] }
  ]
};

schema.nodeTypes['SDLC Component'] = {
  domain: 'Build & Integration',
  prefix: 'sdlccomp',
  color: '#8b5cf6',
  level: 3,
  description: 'SDLC Component — a software part of a larger Business Application or digital product: a microservice, an API, a config file, a security configuration. Optional in CSDM; populated by DevOps Change Velocity. NOT an operational CI — it cannot be used in Incident, Problem or Change. ServiceNow class: cmdb_sdlc_component.',
  metadataFields: [
    DESC,
    OWNER,
    { key: 'componentType', label: 'Component Type', type: 'select', options: ['Application (microservice, API)', 'Infrastructure (config, security)'] },
    { key: 'repository', label: 'Repository / Pipeline', type: 'text' },
    { key: 'lifecycleStage', label: 'Lifecycle Stage', type: 'select', options: ['Planned', 'In Build', 'Active', 'Retiring', 'Retired'] }
  ]
};

/* ------------------------------------------------------------------ *
 * 3. Maturity phase on every class
 *
 * Phases follow the deck's own per-table tags:
 *   Business Application / Service Instance / Technology Mgmt Service = "Crawl/Walk"
 *   Business Services and Offerings                                    = "(Run)"     (slide 57 title)
 *   Service Portfolio                                                  = "(Fly)"     (slide 62 title)
 *   Information Object requires Enterprise Architecture; SDLC Component is "OPTIONAL";
 *   the extended Service Instance types are "a second phase of data gathering".
 * ------------------------------------------------------------------ */
const PHASES = {
  Crawl: [
    // The minimum that makes day-one ITSM work: a service you can name on a ticket,
    // the application it realizes, and the boxes it resolves down onto.
    'Business Application', 'Application Service', 'Application',
    'Infrastructure CI', 'Compute Cluster', 'Virtualization Cluster', 'Compute Node',
    'VM', 'Physical Host', 'Database Instance', 'Storage Volume', 'Load Balancer', 'Data Center'
  ],
  Walk: [
    // Provider-side structure and the infrastructure detail that makes alerts route
    // themselves: technology management services, groups, and the deeper CI classes.
    'Business Capability', 'Technical Service', 'Technical Service Offering', 'Dynamic CI Group',
    'Data Service Instance', 'Network Service Instance', 'Connection Service Instance',
    'Operational Process Service Instance', 'Facility Service Instance',
    'Kubernetes Cluster', 'Namespace', 'Workload', 'Pod', 'Container', 'Container Image',
    'Ingress', 'Network Segment', 'Subnet', 'DNS Record',
    'Certificate', 'Key Vault', 'Secret',
    'Cloud Region', 'Availability Zone', 'Rack',
    'UPS', 'PDU', 'Generator', 'CRAC Unit', 'Chiller'
  ],
  Run: [
    // The consumer side: what the business sells or offers, and what it promised.
    'Business Service', 'Service Offering', 'Service Commitment',
    'Service Catalog', 'Catalog Item', 'Subscription'
  ],
  Fly: [
    // Portfolio and governance artifacts — they need a licensed product to be worth much.
    'Service Portfolio', 'Information Object', 'SDLC Component'
  ]
};

const assigned = new Set();
Object.entries(PHASES).forEach(([phase, types]) => {
  types.forEach(t => {
    if (!schema.nodeTypes[t]) throw new Error(`Phase list names an unknown class: ${t}`);
    if (assigned.has(t)) throw new Error(`Class listed in two phases: ${t}`);
    schema.nodeTypes[t].phase = phase;
    assigned.add(t);
  });
});
const unphased = Object.keys(schema.nodeTypes).filter(t => !assigned.has(t));
if (unphased.length) throw new Error(`Classes with no phase: ${unphased.join(', ')}`);

/* ------------------------------------------------------------------ *
 * 1 + 5. Relationship rules
 * ------------------------------------------------------------------ */
const infra = Object.keys(schema.nodeTypes).filter(t => (schema.nodeTypes[t].domain || '').startsWith('Infrastructure'));

const newRules = [
  {
    fromType: 'Application Service', toType: 'Application Service', label: 'Depends on',
    explanation: 'One deployed service instance depends on another — checkout calling identity, or a portal calling a payments service. CSDM models this as Service Instance -- Depends on / sends Data To --> Service Instance, and it is how an outage in one service reaches the business through another. ServiceNow relationship: Depends on / Used by.'
  },
  {
    fromType: 'Business Application', toType: 'SDLC Component', label: 'Contains',
    explanation: 'The logical application in the portfolio is built from individually developed components — microservices, APIs, config. CSDM: Business Application -- Contains --> SDLC Component. ServiceNow relationship: Contains / Contained by.'
  },
  {
    fromType: 'SDLC Component', toType: 'Application Service', label: 'Contains',
    explanation: 'A deployed instance of an SDLC Component of type Application is a Service Instance. This records which development effort produced the running stack. ServiceNow relationship: Contains / Contained by.'
  },
  {
    fromType: 'Technical Service Offering', toType: 'Dynamic CI Group', label: 'Contains',
    explanation: 'A technology management offering can be scoped to a query-defined group of CIs rather than to individually mapped ones — every switch in a region, every Oracle host. CSDM: Technical Service Offering -- Contains --> Dynamic CI Group. ServiceNow relationship: Contains / Contained by.'
  }
];

infra.forEach(t => newRules.push({
  fromType: 'Dynamic CI Group', toType: t, label: 'Uses',
  explanation: `The group's CMDB query resolves to ${t} members. CSDM shows this as a related list rather than a stored relationship, so the membership is recomputed, never hand-maintained. ServiceNow relationship: Uses / Used by.`
}));

let added = 0, skipped = 0;
newRules.forEach(r => {
  const dup = schema.relationshipRules.find(x => x.fromType === r.fromType && x.toType === r.toType && x.label === r.label);
  if (dup) { skipped++; return; }
  schema.relationshipRules.push(r);
  added++;
});

fs.writeFileSync(FILE, prefix + JSON.stringify(schema) + suffix);
console.log(`classes: ${Object.keys(schema.nodeTypes).length}  rules: ${schema.relationshipRules.length} (+${added}, ${skipped} already present)`);
Object.entries(PHASES).forEach(([p, t]) => console.log(`  ${p}: ${t.length} classes`));
