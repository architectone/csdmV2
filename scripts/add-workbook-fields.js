/*
 * Schema edits derived from the CSDM Data Modeling Workbook (Instructions tab):
 *   Step 5 — "For each Service Offering (both Technical and Business), identify:
 *             Support Group: Who handles Tier 1 incidents and requests for this offering?
 *             Approval Group: Who approves requests related to this offering?"
 *             Our Technical Service Offering already had both; the Business one did not.
 *   Tab 1  — "The Service Portfolio organizes services into a two-level hierarchy...
 *             Level 1 (L1): Three broad categories... Level 2 (L2): Functional groupings"
 *             plus "Services are NOT nested inside each other — hierarchy exists at the
 *             Portfolio level", which is why the nesting rule goes on Portfolio and
 *             deliberately NOT on Business Service.
 *
 * Same slice-mutate-restore approach as add-phases-and-build-classes.js. Idempotent.
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

const addField = (cls, field, afterKey) => {
  const fields = schema.nodeTypes[cls].metadataFields;
  if (fields.some(f => f.key === field.key)) return false;
  const i = fields.findIndex(f => f.key === afterKey);
  fields.splice(i < 0 ? fields.length : i + 1, 0, field);
  return true;
};

/* Item 2 — the offering is the record that carries assignment. Without a support group on it,
   nothing on the consumer side knows who to page. Labels mirror Technical Service Offering. */
const f1 = addField('Service Offering', { key: 'supportGroup', label: 'Support Group (Incident)', type: 'text' }, 'supportHours');
const f2 = addField('Service Offering', { key: 'approvalGroup', label: 'Business Approval Group (Change)', type: 'text' }, 'supportGroup');

/* Item 4 — the workbook's L1 categories, verbatim. */
const f3 = addField('Service Portfolio', {
  key: 'portfolioCategory', label: 'Portfolio Category (L1)', type: 'select',
  options: ['Workplace', 'Business (Industry Specific)', 'Shared Services']
}, 'owner');

let rules = 0;
const rule = {
  fromType: 'Service Portfolio', toType: 'Service Portfolio', label: 'Contains',
  explanation: 'A Level 1 portfolio category (Workplace, Business, Shared Services) contains the Level 2 functional groupings beneath it. CSDM puts the hierarchy here on purpose: business services themselves are flat and never nest inside one another, so the portfolio is the only place depth is allowed. ServiceNow relationship: Contains / Contained by.'
};
if (!schema.relationshipRules.find(r => r.fromType === rule.fromType && r.toType === rule.toType && r.label === rule.label)) {
  schema.relationshipRules.push(rule); rules++;
}

fs.writeFileSync(FILE, prefix + JSON.stringify(schema) + suffix);
console.log(`Service Offering supportGroup added: ${f1}, approvalGroup added: ${f2}`);
console.log(`Service Portfolio portfolioCategory added: ${f3}`);
console.log(`Portfolio nesting rule added: ${rules}  (total rules ${schema.relationshipRules.length})`);
