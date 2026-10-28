const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('./index.html', 'utf8');
const app = fs.readFileSync('./app.js', 'utf8');
const css = fs.readFileSync('./style.css', 'utf8');
const section = (id, nextId) => {
  const start = html.indexOf(`id="view-${id}"`);
  const end = nextId ? html.indexOf(`id="view-${nextId}"`, start) : html.length;
  assert.notEqual(start, -1, `missing view-${id}`);
  return html.slice(start, end === -1 ? html.length : end);
};

test('frontend copy contains no oracle wording or em dash', () => {
  for (const [name, source] of [['index.html', html], ['app.js', app], ['style.css', css]]) {
    assert.ok(!/oracle/i.test(source), `${name} contains prohibited wording`);
    assert.equal(source.includes('\u2014'), false, `${name} contains an em dash`);
  }
});

test('Home describes the solution and has one model-selection action', () => {
  const home = section('home', 'models');
  assert.match(home, /AI-Powered Electricity Theft Triage for Smart Grids/);
  assert.match(home, /estimate(?:s)? unexplained energy/i);
  assert.match(home, /href="#\/models"[^>]*>[^<]*(?:model|scoring)/i);
  assert.ok(!/btn-guided|Try the guided demo|Backend status|home-facts|honest-strip|Synthetic data\. Not field-validated/.test(home));
  assert.ok(!/fact-config|Config hash|model_sha256/.test(home));
});

test('all model cards show IDs with semantic labels and repository-based notes', () => {
  const models = section('models', 'results');
  const expected = [
    ['M0', 'Physics residual baseline', 'DT unexplained energy'],
    ['M1', 'Unsupervised anomaly detector', 'Calibration uses inspection outcomes'],
    ['M2', 'History-based model', 'own-history'],
    ['M3', 'Context-aware model', 'peer, and voltage context'],
    ['M4', 'Temporal graph model', 'topology'],
  ];
  for (const [id, label, note] of expected) {
    assert.match(models, new RegExp(`${id}[^<]{0,50}${label}`, 'i'), `${id} missing semantic label`);
    assert.match(models, new RegExp(note, 'i'), `${id} missing supporting note`);
  }
  assert.match(app, /modelDisplayName/);
});

test('Results removes the explanation tab and target-meter interaction', () => {
  const results = section('results', 'how');
  assert.ok(!/tab-expl|pane-expl|data-tab="explanation"|id="meter"|explanation target/i.test(results));
  assert.match(results, /Ranked meters/);
  assert.match(results, /Transformers/);
  assert.match(results, /Energy balance/);
  assert.match(results, /Compare models/);
  assert.match(results, /reason/i);
  assert.ok(!/drawExplanation|expl-chart|Target meter set|explDirty|data-tab.*explanation/.test(app));
});

test('How it works diagrams describe the scoring flow and API routes', () => {
  const how = section('how', 'evidence');
  for (const term of [
    'Stored AMI and DT readings', 'Causal imputation', 'Power-flow',
    'Own history', 'DT/peer context', 'Temporal sequence',
    'Calibration', 'Ranked meter', 'DT unexplained-energy balance',
    '4-way loss attribution', 'Work-order routing', 'Audit log',
    'GET /health', 'POST /score', '/ies/manifest', '/docs', 'FastAPI'
  ]) assert.ok(how.toLowerCase().includes(term.toLowerCase()), `diagram is missing ${term}`);
});

test('Evidence distinguishes only the benchmark, Track A, and Track B', () => {
  const evidence = section('evidence', 'about');
  assert.match(evidence, /Track A/);
  assert.match(evidence, /Track B/);
  assert.ok(!/Track C|Track D/.test(evidence));
  assert.ok(!/ready for.*validation|What we need next|Risks we measured/i.test(evidence));
  assert.match(evidence, /47\.3%/);
  assert.match(evidence, /0\.644/);
});

test('Governance presents accurate prototype disclosures', () => {
  const governance = section('about', 'team');
  assert.match(html, />Governance<|>Data &amp; governance</);
  assert.match(governance, /Synthetic.*demo/i);
  assert.match(governance, /decision.support/i);
  assert.match(governance, /no automated enforcement/i);
  assert.match(governance, /configuration hash/i);
  assert.match(governance, /SHA-256/i);
  assert.match(governance, /does not display or export these values/i);
  assert.match(governance, /ephemeral/i);
  assert.match(governance, /utility.control/i);
  assert.match(governance, /graph model.*(?:did not|no).*(?:advantage|outperform)/i);
});
