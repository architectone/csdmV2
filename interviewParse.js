/* Interview Mode LLM front door — INTERVIEW_MODE_SPEC.md §6.
   Strictly additive: the interview must work with no API key. No key, or no SDK
   installed, and this answers 501 { unavailable: true } so the client silently
   falls back to the lexicon in public/interviewLexicon.js.

   The LLM extracts THINGS from prose. It does not assign classes it invented and
   it does not author relationships: the `type` enum is generated from the schema
   on every request, and edges are still built deterministically in interview.js
   (only IMPACT_REVERSE_LABELS propagate failure, and that invariant is not
   something a model gets a vote on). */
const schema = require('./shared/csdmSchema');

const MODEL = 'claude-haiku-4-5';
const REDUNDANCY = ['unknown', 'Single instance', 'Redundant pair', 'HA cluster', 'Auto-scaling'];
const MAX_INPUT = 4000;
const MAX_ITEMS = 40;

let client = null;
/* Held in memory only, and deliberately never written to disk or echoed back to the
   browser — a key in csdmData.json or localStorage would outlive the session that
   needed it. Restarting the server clears it. */
let runtimeApiKey = null;

function sdkInstalled() {
  try {
    require('@anthropic-ai/sdk');
    return true;
  } catch (err) {
    return false;
  }
}

function currentKey() {
  return runtimeApiKey || process.env.ANTHROPIC_API_KEY || '';
}

function keySource() {
  if (runtimeApiKey) return 'runtime';
  if (process.env.ANTHROPIC_API_KEY) return 'env';
  return null;
}

/* Lazily required so a missing dependency degrades to 501 instead of killing the server. */
function getClient() {
  if (client) return client;
  const apiKey = currentKey();
  if (!apiKey) return null;
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey });
  } catch (err) {
    return null;
  }
  return client;
}

/* Status the UI can render without ever seeing the key itself. */
function configState() {
  const key = currentKey();
  return {
    sdkInstalled: sdkInstalled(),
    apiKeyConfigured: !!key,
    source: keySource(),
    /* Enough to recognise which key is loaded, not enough to use it. */
    hint: key ? `…${key.slice(-4)}` : '',
    llmAvailable: !!key && sdkInstalled(),
    model: MODEL
  };
}

/* The API's own message is the useful part, but the common failures deserve a
   sentence that says what to do about them — "400 invalid_request_error" does not
   tell you to go buy credits. */
function explainKeyError(err) {
  const raw = String((err && err.message) || '').trim();
  const status = err && err.status;
  if (/credit balance/i.test(raw)) return `The key works, but the account has no API credits. Add credits at console.anthropic.com under Billing — API credits are separate from a Claude.ai subscription.`;
  if (status === 401) return `That key was rejected. Check it was copied whole (they start with sk-ant-) and has not been revoked.`;
  if (status === 403) return `That key is valid but not permitted to use ${MODEL}. ${raw}`;
  if (status === 404) return `The API does not recognise the model ${MODEL}. ${raw}`;
  if (status === 429) return `Rate limited before the key could be checked — try again in a moment.`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(raw)) return `Could not reach api.anthropic.com from this machine — check the network or a proxy.`;
  return raw ? `${status ? `${status}: ` : ''}${raw}` : `The key could not be verified.`;
}

/* A key that is merely present is not a key that works. One minimal call surfaces a
   typo or a revoked key here, rather than three stages later in the interview. */
async function verifyKey() {
  const anthropic = getClient();
  if (!anthropic) throw new Error(`The Anthropic SDK is not installed. Run: npm install @anthropic-ai/sdk`);
  await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }]
  });
}

function classNames() {
  return Object.keys(schema.nodeTypes).sort();
}

/* One line per class so the model picks from what this schema actually has,
   including the level it sits at — that is what decides nesting downstream. */
function classTable() {
  return classNames()
    .map(name => {
      const t = schema.nodeTypes[name];
      const desc = String(t.description || '').replace(/\s+/g, ' ').trim();
      return `- ${name} | ${t.domain} | level ${t.level} | ${desc}`;
    })
    .join('\n');
}

/* Built per request from Object.keys(nodeTypes), so the model cannot invent a class. */
function outputSchema() {
  const classes = classNames();
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct thing named in the text. Empty if nothing was named.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourcePhrase', 'label', 'type', 'why', 'ambiguous', 'candidates', 'count', 'redundancy'],
          properties: {
            sourcePhrase: { type: 'string', description: 'The exact words from the user text that named this thing. Must appear verbatim in the input.' },
            label: { type: 'string', description: 'The name to give the node. Use the proper name if the user gave one (e.g. "Rack A1", "pgh-core-k8s"); otherwise repeat the class name.' },
            type: { type: 'string', enum: classes.concat(['unknown']), description: 'The CSDM class. Use "unknown" only when no class fits.' },
            why: { type: 'string', description: 'One sentence explaining why this class, written to teach the reader something about CSDM. No preamble.' },
            ambiguous: { type: 'boolean', description: 'True when the words genuinely map to more than one class and guessing would teach the user something false.' },
            candidates: { type: 'array', description: 'When ambiguous, the classes it could be. Empty otherwise.', items: { type: 'string', enum: classes } },
            count: { type: 'integer', enum: [1, 2, 3], description: 'How many the user said there were. 1 if unstated, 2 for a pair, 3 for three or more.' },
            redundancy: { type: 'string', enum: REDUNDANCY, description: 'Only when the user stated it outright. "unknown" otherwise — never infer it.' }
          }
        }
      }
    }
  };
}

function systemPrompt() {
  return `You read how an engineer describes their environment in plain English and pull out the individual things they named, mapping each onto a class in this CSDM schema.

You are the front door to a LEARNING TOOL. Two rules matter more than coverage:

1. NEVER GUESS AN AMBIGUOUS WORD. Words like "service", "app", "cluster", "server", "database", "instance", and "environment" map to several classes. When the surrounding words do not settle it, set ambiguous to true and list the candidates — the tool will ask the user, and that question is the most valuable moment in the interview. A confident wrong answer teaches a falsehood.
2. A SPECIFIC WORD BEATS AN AMBIGUOUS ONE. "vsphere cluster" is a Virtualization Cluster, not an ambiguous "cluster". "postgres" is a Database Instance, not an ambiguous "database". Only fall back to ambiguous when the ambiguous word is the sole signal.

Further rules:
- One entry per thing. "two app servers that connect to a database on a VM" is THREE entries, not one.
- Quantity is not a node count. "two app servers" is ONE entry with count 2 — the tool records that as a redundancy value, which is what lets a failure be absorbed. Never emit two entries for it.
- The thing being described is not a dependency of itself. If the user's own application or service is the subject of the sentence, skip it.
- Only set redundancy when the user said it outright ("a standby pair", "an HA cluster"). Otherwise "unknown" — the tool asks about resilience later, and that question is worth asking.
- sourcePhrase must be the user's own words, copied verbatim from the input.
- "Environment" (prod, staging, dev) is not a class in CSDM — it is a property of an Application Service. Skip those words entirely.
- Do not invent things the user did not name. No entry for something merely implied.

Classes available in this schema (name | domain | level | description):
${classTable()}`;
}

function userPrompt(text, context) {
  const who = [];
  if (context.anchor) who.push(`Their running service is called "${context.anchor}".`);
  if (context.app) who.push(`The funded application is called "${context.app}".`);
  return `${who.join(' ')}${who.length ? '\n\n' : ''}They were asked what that service runs on, or needs in order to work. They answered:

<answer>
${text}
</answer>

Pull out each thing they named.`;
}

async function parseInterviewText(text, context) {
  if (!currentKey()) {
    const err = new Error(`No API key is configured, so the parser is unavailable.`);
    err.status = 501;
    err.unavailable = true;
    throw err;
  }
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error(`The Anthropic SDK is not installed. Run: npm install @anthropic-ai/sdk`);
    err.status = 501;
    err.unavailable = true;
    throw err;
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: 'text',
        text: systemPrompt(),
        /* The primer and class table are byte-identical across requests, so they
           cache. Haiku 4.5 has a 4096-token minimum cacheable prefix — below that
           this silently does nothing, which is why the hit is logged below. */
        cache_control: { type: 'ephemeral' }
      }
    ],
    output_config: { format: { type: 'json_schema', schema: outputSchema() } },
    messages: [{ role: 'user', content: userPrompt(text, context) }]
  });

  if (response.stop_reason === 'refusal') {
    const err = new Error(`The model declined to answer.`);
    err.status = 502;
    throw err;
  }
  if (response.stop_reason === 'max_tokens') {
    const err = new Error(`The answer was cut off before it was valid JSON.`);
    err.status = 502;
    throw err;
  }

  const block = (response.content || []).find(b => b.type === 'text');
  if (!block) {
    const err = new Error(`The model returned no content.`);
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch (e) {
    const err = new Error(`The model returned text that was not valid JSON.`);
    err.status = 502;
    throw err;
  }

  const usage = response.usage || {};
  return {
    source: 'llm',
    model: response.model || MODEL,
    items: sanitize(parsed.items),
    usage: {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0
    }
  };
}

/* The enum makes an invented class impossible, but the model still controls
   free-text fields and array lengths — so everything is re-checked here rather
   than trusted into the client. */
function sanitize(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_ITEMS).map(raw => {
    const it = raw && typeof raw === 'object' ? raw : {};
    const str = (v, max) => String(v == null ? '' : v).slice(0, max).trim();
    const type = schema.nodeTypes[it.type] ? it.type : '';
    const candidates = (Array.isArray(it.candidates) ? it.candidates : [])
      .filter(c => schema.nodeTypes[c])
      .filter((c, i, a) => a.indexOf(c) === i)
      .slice(0, 6);
    const count = [1, 2, 3].includes(it.count) ? it.count : 1;
    return {
      sourcePhrase: str(it.sourcePhrase, 200),
      label: str(it.label, 120),
      type,
      why: str(it.why, 400),
      ambiguous: !!it.ambiguous || !type,
      candidates,
      count,
      redundancy: REDUNDANCY.includes(it.redundancy) ? it.redundancy : 'unknown'
    };
  }).filter(it => it.sourcePhrase || it.label);
}

function register(app) {
  app.post('/api/interview/parse', async (req, res) => {
    const body = req.body || {};
    const text = String(body.text || '').slice(0, MAX_INPUT).trim();
    if (!text) return res.status(400).json({ error: 'No text to parse.' });

    try {
      const result = await parseInterviewText(text, {
        anchor: String(body.anchor || '').slice(0, 120),
        app: String(body.app || '').slice(0, 120)
      });
      if (result.usage) {
        console.log(`[interview] ${result.items.length} item(s) | in ${result.usage.input} out ${result.usage.output} | cache read ${result.usage.cacheRead} write ${result.usage.cacheWrite}`);
      }
      res.json(result);
    } catch (err) {
      if (err.unavailable) return res.status(501).json({ unavailable: true, error: err.message });
      console.error('[interview] parse failed:', err.message);
      res.status(err.status || 502).json({ error: err.message });
    }
  });

  app.get('/api/interview/config', (req, res) => res.json(configState()));

  app.post('/api/interview/config', async (req, res) => {
    const body = req.body || {};
    const apiKey = String(body.apiKey || '').trim();

    if (!apiKey) {
      runtimeApiKey = null;
      client = null;
      return res.json({ success: true, message: `Key cleared.`, config: configState() });
    }

    const previous = runtimeApiKey;
    runtimeApiKey = apiKey;
    client = null;

    try {
      await verifyKey();
      console.log(`[interview] API key set via UI — LLM parsing is on.`);
      res.json({ success: true, message: `Key accepted — the parser will use ${MODEL}.`, config: configState() });
    } catch (err) {
      /* A key that fails its own test never becomes the configured key. */
      runtimeApiKey = previous;
      client = null;
      /* Logged in full because the browser only gets the sentence, and the
         useful part of an Anthropic error is usually the raw message. */
      console.error(`[interview] key verification failed — status ${err.status || '?'} — ${err.message}`);
      res.status(400).json({ success: false, error: explainKeyError(err), config: configState() });
    }
  });
}

module.exports = { register, parseInterviewText, outputSchema, MODEL };
