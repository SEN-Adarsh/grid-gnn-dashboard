/* ============ Grid-GNN - Rodic competition UI ============
   API contract is unchanged: same POST fields, same response reads.
   All request/response handling mirrors the original app.js. */

const params0 = new URLSearchParams(location.search);
// explicit ?api= wins; otherwise default to the local API when served locally
const API_BASE = params0.get('api') ||
  (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8001' : 'https://grid-gnn-api.onrender.com');
const $ = id => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined) ? '-' : Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODEL_IDS = ['M0', 'M1', 'M2', 'M3', 'M4'];
const MODEL_LABELS = {
  M0: 'Physics residual baseline',
  M1: 'Unsupervised anomaly detector',
  M2: 'History-based model',
  M3: 'Context-aware model',
  M4: 'Temporal graph model',
};
const modelDisplayName = id => MODEL_LABELS[id] ? `${id} - ${MODEL_LABELS[id]}` : (id || 'Scoring method');

/* ---------- app state ---------- */
const state = {
  model: null,            // selected model (set from /health availability)
  scenario: 'theft',
  recommended: null,
  window: null,           // {min,max} from /health
  health: null,
  search: '',
  chartDirty: false,
  sampleMode: false,      // frontend-only preview with a labelled sample response
};
let lastResponse = null;
let sortKey = 'rank', sortDir = 1, flagOnly = false;

/* ---------- status dot + messages ---------- */
function setDot(stateName, label) {
  const dot = $('status-dot');
  dot.className = 'dot ' + ({ ok: 'dot-ok', waking: 'dot-waking', down: 'dot-down' }[stateName] || 'dot-idle');
  dot.setAttribute('aria-label', 'Backend status: ' + label);
  $('status-label').textContent = label;
}
function setStatus(msg, err = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (err ? ' err' : '');
}
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.remove(), 2600);
}

/* ---------- fetch: cold-start retries + 60s timeout (unchanged behaviour) ---------- */
async function fetchWithRetry(url, opts = {}, attempts = 6, onAttempt = null) {
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await fetch(url, { ...opts, signal: ac.signal });
      if (r.status === 502 || r.status === 503) throw new Error('backend waking');
      return r;
    } catch (e) {
      if (e.name === 'AbortError') {           // host reachable, app slow → treat as waking
        e = new Error('backend waking');
      } else if (e instanceof TypeError) {     // connection refused / DNS → nothing is listening
        throw new Error('No scoring service is reachable at ' + API_BASE + '.');
      }
      if (i === attempts - 1) throw e;
      const msg = `The scoring service is responding slowly. Retrying request ${i + 1} of ${attempts}...`;
      setDot('waking', 'waking…');
      if (onAttempt) onAttempt(msg);
      await new Promise(res => setTimeout(res, 15000));
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ---------- /health ---------- */
/* ---------- apply a /health payload (real or sample) to the UI ---------- */
function applyHealthFields(h) {
  state.health = h;

  /* models: availability, recommended, cards (accept models_available or models) */
  const availRaw = h.models_available || h.models;
  const avail = Array.isArray(availRaw) ? availRaw : null;
  document.querySelectorAll('.mcard').forEach(card => {
    const m = card.dataset.model;
    const ok = !avail || avail.includes(m);
    card.classList.toggle('unavailable', !ok);
    card.setAttribute('aria-disabled', String(!ok));
    card.querySelector('.m-state').textContent = ok ? '' : 'Not loaded in this dataset';
  });
  const priority = ['M0', 'M1'];
  state.recommended = avail && avail.length
    ? (avail.includes(h.model) ? h.model : priority.find(m => avail.includes(m)))
    : (h.model || 'M0');
  document.querySelectorAll('.mcard [data-tag="rec"]').forEach(t => t.classList.add('hidden'));
  const recCard = document.querySelector(`.mcard[data-model="${state.recommended}"]`);
  const recTag = recCard && recCard.querySelector('[data-tag="rec"]');
  if (recTag) recTag.classList.remove('hidden');
  if (!state.sampleMode || !state.model || !avail || avail.includes(state.model)) selectModel(state.recommended);

  /* scoring window comes from the service */
  if (h.scoring_window && h.scoring_window.max) {
    state.window = h.scoring_window;
    const w = $('asof');
    w.min = h.scoring_window.min; w.max = h.scoring_window.max; w.value = h.scoring_window.max;
    $('asof-hint').textContent = `Score using the first ${h.scoring_window.max} quarter-hours of stored history (valid range ${h.scoring_window.min}-${h.scoring_window.max}).`;
  } else {
    $('asof').value = '';
    $('asof-hint').textContent = 'The service did not report a scoring window. The full stored history will be used.';
  }

  updateSummary();
}

async function boot() {
  setDot('waking', 'checking…');
  try {
    const r = await fetchWithRetry(API_BASE + '/health', {}, 6);
    const h = await r.json();
    setDot('ok', 'backend ready');
    setSampleBanner(false);
    applyHealthFields(h);
  } catch (e) {
    setDot('down', 'unreachable');
    setStatus('Scoring service unavailable. You can preview labelled sample data after opening a scoring run.', true);
  }
}

/* ---------- sample mode (frontend-only preview; always clearly labelled) ---------- */
const SAMPLE_HEALTH = {
  profile_source: 'synthetic_india_v2 (sample)',
  model: 'M0',
  models_available: ['M0', 'M1', 'M2', 'M3', 'M4'],
  models_note: 'Sample mode. No scoring service is connected.',
  scoring_window: { min: 1344, max: 1344 },
};

function makeSampleResponse(scenario, severity) {
  let seed = 42 + Math.round(severity * 100) + scenario.length;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const threshold = 0.42;
  const meters = [];
  for (let i = 0; i < 24; i++) {
    meters.push({
      meter_id: 'METER-' + String(100 + i), dt_id: i % 10, rank: 0,
      probability_simulated_theft: 0.02 + rnd() * 0.33, inspection_flag: false,
      candidate_kwh_allocation: 0, recorded_to_baseline_ratio: 0.88 + rnd() * 0.24,
      missing_fraction: Math.round(rnd() * 8) / 100, reason_codes: [],
      recommended_action: 'No action - remain in the monitoring pool', assigned_owner: 'MIS Analytics Desk', target_sla: 'Next monthly review', rdss_mis_code: 'RDSS-MON-00',
    });
  }
  const dts = [
    { dt_id: 0, unexplained_kwh: 4.2, candidate_allocated_kwh: 0, unassigned_kwh: 4.2, input_kwh: 96.5, technical_loss_estimate_kwh: 1.1, missing_fraction: 0.03, loss_attribution: { technical_loss_kwh: 1.1, meter_tamper_anomaly_kwh: 0, defective_frozen_metering_kwh: 0, unmetered_direct_hooking_kwh: 4.2 }, recommended_action: 'Upstream LT line patrol for direct hooking / illegal tapping', assigned_owner: 'Feeder Line Patrolman & JE (Distribution)', target_sla: 'Within 72 hours (night/dawn patrol)', rdss_mis_code: 'RDSS-LT-HOOK' },
    { dt_id: 1, unexplained_kwh: 1.3, candidate_allocated_kwh: 0, unassigned_kwh: 1.3, input_kwh: 88.2, technical_loss_estimate_kwh: 1.0, missing_fraction: 0.02, loss_attribution: { technical_loss_kwh: 1.0, meter_tamper_anomaly_kwh: 0, defective_frozen_metering_kwh: 0, unmetered_direct_hooking_kwh: 0 }, recommended_action: 'No action - remain in the monitoring pool', assigned_owner: 'MIS Analytics Desk', target_sla: 'Next monthly review', rdss_mis_code: 'RDSS-MON-00' },
  ];
  if (scenario === 'theft') {
    const m = meters[3];
    m.probability_simulated_theft = Math.min(0.96, 0.5 + 0.45 * severity);
    m.recorded_to_baseline_ratio = Math.max(0.05, 1 - severity);
    m.reason_codes = [
      `Recorded energy is ${m.recorded_to_baseline_ratio.toFixed(2)} times the own-history expectation.`,
      'Tamper-like event rate 1.00 per day; events are imperfect evidence.',
    ];
    m.recommended_action = 'Physical vigilance raid and load check (Electricity Act s.135/s.126)'; m.assigned_owner = 'Sub-Division Vigilance Squad (AEE Enforcement)'; m.target_sla = 'Within 48 hours'; m.rdss_mis_code = 'RDSS-VIG-135';
  } else if (scenario === 'upstream_hooking') {
    dts[0].unexplained_kwh += 14 * severity;
    dts[0].unassigned_kwh = dts[0].unexplained_kwh;
    meters.forEach(m => { if (m.dt_id === 0) m.probability_simulated_theft = Math.min(0.4, m.probability_simulated_theft); });
  } else if (scenario === 'ami_dropout') {
    const m = meters[7];
    m.missing_fraction = 0.9; m.probability_simulated_theft = Math.min(0.9, 0.3 + 0.3 * severity);
    m.reason_codes = ['Missing intervals: 90.0% of the assessment window.'];
    m.recommended_action = 'Smart-meter health check and optical-port audit (non-theft fault)'; m.assigned_owner = 'AMI Meter Operations / AMISP Field Engineer'; m.target_sla = 'Next 7-day billing cycle'; m.rdss_mis_code = 'RDSS-AMI-MTR';
  } else { // none / vacancy: keep the generated example calm
    meters.forEach(m => { m.probability_simulated_theft = Math.min(m.probability_simulated_theft, 0.25); });
  }
  meters.sort((a, b) => b.probability_simulated_theft - a.probability_simulated_theft);
  meters.forEach((m, i) => {
    m.rank = i + 1;
    m.inspection_flag = m.probability_simulated_theft >= threshold;
    if (m.inspection_flag) {
      const d = dts.find(d => d.dt_id === m.dt_id) || dts[0];
      m.candidate_kwh_allocation = Math.round(d.unexplained_kwh * m.probability_simulated_theft / meters.filter(x => x.inspection_flag).length * 10) / 10;
    }
  });
  const days = 3;
  const daily = [];
  for (let d = 0; d < 2; d++) for (let k = 0; k < days; k++) {
    const inp = 90 + d * 6 + k * 2;
    daily.push({ dt_id: d, ts: `2026-07-1${k + 1}T00:00:00+05:30`,
      input_kwh: inp, observed_consumer_kwh: inp * 0.94, imputed_consumer_kwh: inp * 0.015,
      estimated_technical_kwh: inp * 0.012,
      residual_kwh: d === 0 ? dts[0].unexplained_kwh / days : dts[1].unexplained_kwh / days,
      missing_fraction: 0.03 });
  }
  return {
    model: state.model || 'M0', profile_source: 'synthetic_india_v2 (sample)',
    as_of_interval: 1344, as_of_time: '2026-06-14T23:45:00+05:30',
    telemetry_mode: 'recorded sample', scenario,
    operating_point: { threshold, target_precision: 0.7, validation_target_met: true, validation_flags: 6, validation_precision: 0.73, validation_recall: 0.58 },
    meters, dts, daily_balance: daily,
    notes: [
      'SAMPLE MODE: generated by the front end because the backend is unreachable. Not a live result.',
      'Synthetic profiles and reference topology; probabilities are not validated for Indian field use.',
      'A field inspector must verify every flag. No disconnection or penalty is automated.',
    ],
    runtime_seconds: 0.02,
  };
}
function setSampleBanner(on) {
  $('sample-banner').classList.toggle('hidden', !on);
  state.sampleMode = on;
}
function loadSample() {
  state.health = SAMPLE_HEALTH;
  applyHealthFields(SAMPLE_HEALTH);
  setDot('waking', 'sample mode - backend offline');
  setSampleBanner(true);
  lastResponse = makeSampleResponse(state.scenario, parseFloat($('severity').value));
  render(lastResponse);
  location.hash = '#/results';
  navigate();
  setStatus('Sample mode - showing generated demo data.', false);
}
function exitSample() {
  setSampleBanner(false);
  lastResponse = null;
  navigate();
  boot();
}

/* ---------- model & scenario selection ---------- */
function selectModel(m) {
  state.model = m;
  document.querySelectorAll('.mcard').forEach(c => {
    const sel = c.dataset.model === m && !c.classList.contains('unavailable');
    c.classList.toggle('selected', sel);
    c.setAttribute('aria-pressed', String(sel));
  });
  updateSummary();
}
function selectScenario(s) {
  state.scenario = s;
  document.querySelectorAll('input[name="scen"]').forEach(r => { r.checked = r.value === s; });
  const tamper = $('tamper');
  const theftOnly = s === 'theft';
  tamper.disabled = !theftOnly;
  if (!theftOnly) tamper.checked = false;
  $('tamper-note').textContent = theftOnly
    ? 'A meter-manipulation event flag. Applies to the theft scenario only.'
    : 'Tamper events apply to the theft scenario only. Disabled for this scenario.';
  updateSummary();
}
function severityMeaning(v) {
  if (v >= 0.8) return 'Strong anomaly - deliberately easy to spot.';
  if (v >= 0.5) return 'Moderate anomaly - a realistic inspection case.';
  return 'Subtle anomaly - hard to distinguish from noise.';
}
function updateSummary() {
  const tam = $('tamper').checked && state.scenario === 'theft' ? ' with a tamper event' : '';
  $('run-summary').textContent =
    `Single-method run: ${modelDisplayName(state.model || 'M0')} on ${state.scenario} at ${parseFloat($('severity').value).toFixed(2)}${tam}. Compare all five methods using the same input.`;
}

/* ---------- run ---------- */
function setBusy(busy, mode = 'single') {
  $('run').disabled = busy;
  $('compare-all').disabled = busy;
  $('run').setAttribute('aria-busy', String(busy && mode === 'single'));
  $('compare-all').setAttribute('aria-busy', String(busy && mode === 'compare'));
  $('run-spin').hidden = !(busy && mode === 'single');
  $('run-label').textContent = busy && mode === 'single' ? 'Scoring...' : 'Run scoring';
  $('compare-label').textContent = busy && mode === 'compare' ? 'Comparing...' : 'Compare all 5 methods';
  setStepper(busy ? 'run' : (lastResponse ? 'review' : 'choose'));
}
function showRunState(which, msg) {
  $('run-progress').classList.toggle('hidden', which !== 'progress');
  $('run-error').classList.toggle('hidden', which !== 'error');
  $('run-sample').classList.toggle('hidden', which !== 'error');
  if (which === 'progress') $('progress-msg').textContent = msg;
  if (which === 'error') $('run-error-msg').textContent = msg;
  if (which === null) { $('run-progress').classList.add('hidden'); $('run-error').classList.add('hidden'); }
}

async function run() {
  if (!state.model) { setStatus('Choose a scoring method first.', true); return; }
  clearComparison();
  if (state.sampleMode) { // frontend-only preview: regenerate the clearly-labelled sample
    lastResponse = makeSampleResponse(state.scenario, parseFloat($('severity').value));
    render(lastResponse);
    location.hash = '#/results';
    navigate();
    toast('Sample response regenerated (backend offline).');
    return;
  }
  setBusy(true);
  showRunState('progress', 'Scoring...');
  setStatus('Scoring...');

  /* Preserve the strict API request schema. */
  const body = scorePayload(state.model);

  try {
    const j = await postScore(body, m => showRunState('progress', m));
    showRunState(null);
    render(j);
    const flagged = j.meters.filter(m => m.inspection_flag).length;
    setStatus(`Done. ${flagged} of ${j.meters.length} meters met the operating point in ${fmt(j.runtime_seconds, 2)} s.`);
    /* The response is rendered above before navigating to Results. */
    if (currentRoute() !== 'results') { location.hash = '#/results'; navigate(); }
    else { navigate(); } // already there: just re-sync views/tabs
  } catch (e) {
    showRunState('error', e.message);
    $('run-sample').classList.remove('hidden');
    setStatus('Scoring failed: ' + e.message, true);
  } finally {
    setBusy(false);
  }
}

function clearComparison() {
  if ($('compare-table')) $('compare-table').tBodies[0].innerHTML = '';
  if ($('compare-summary')) $('compare-summary').textContent = 'Run Compare all 5 methods to populate this view.';
}

function scorePayload(model) {
  const body = {
    model,
    scenario: state.scenario,
    severity: parseFloat($('severity').value),
    as_of_interval: parseInt($('asof').value, 10),
    tamper_event: $('tamper').checked,
  };
  if (!Number.isFinite(body.as_of_interval)) delete body.as_of_interval;
  return body;
}

async function postScore(body, onAttempt) {
  const r = await fetchWithRetry(API_BASE + '/score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 6, onAttempt);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail || ('HTTP ' + r.status));
  }
  return r.json();
}

async function runCompareAll() {
  if (state.sampleMode) {
    toast('Model comparison needs the scoring service. Sample mode has no model-specific scores.');
    return;
  }
  const available = state.health && (state.health.models_available || state.health.models);
  const missing = available && MODEL_IDS.filter(m => !available.includes(m));
  if (missing && missing.length) {
    setStatus(`Cannot compare all five methods. Not loaded: ${missing.map(modelDisplayName).join(', ')}.`, true);
    return;
  }

  clearComparison();
  const requests = GridGNNCompare.buildCompareRequests(scorePayload(state.model || 'M0'), MODEL_IDS);
  const responses = [];
  let currentModel = null;
  setBusy(true, 'compare');
  showRunState('progress', 'Starting model comparison...');
  setStatus('Comparing all five methods on the same input...');
  try {
    for (let i = 0; i < requests.length; i++) {
      currentModel = requests[i].model;
      showRunState('progress', `Running ${modelDisplayName(currentModel)} (${i + 1} of ${requests.length})...`);
      const response = await postScore(requests[i], m =>
        showRunState('progress', `${modelDisplayName(currentModel)}: ${m}`));
      if (response.model !== currentModel) {
        throw new Error(`The service returned ${modelDisplayName(response.model)} instead of ${modelDisplayName(currentModel)}.`);
      }
      responses.push(response);
    }
    const primary = responses.find(r => r.model === 'M0') || responses[0];
    render(primary);
    renderComparison(responses);
    showRunState(null);
    setStatus('Comparison complete. Rankings remain separate; the agreement count is not a combined score.');
    location.hash = '#/results?tab=compare';
    navigate();
  } catch (e) {
    showRunState('error', `${currentModel || 'Model comparison'} failed: ${e.message}. No partial comparison is shown.`);
    $('run-sample').classList.remove('hidden');
    setStatus('Model comparison failed: ' + e.message, true);
  } finally {
    setBusy(false);
  }
}

function renderComparison(responses) {
  const rows = GridGNNCompare.buildTopTenAgreement(responses, 10);
  const body = $('compare-table').tBodies[0];
  body.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(row.meter_id)}</td><td>${esc(row.dt_id)}</td>` +
      MODEL_IDS.map(model => `<td>${row.ranks[model] ?? '-'}</td>`).join('') +
      `<td><strong>${row.top10_count}/5</strong></td>`;
    body.appendChild(tr);
  }
  $('compare-summary').textContent =
    `All 5 methods scored the same input. Showing ${rows.length} meters that at least one method placed in its top 10. Agreement means only inclusion in multiple top-10 lists; it is not a probability or finding of theft.`;
}

/* ---------- guided demo ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
let guidedRunning = false;
async function guidedDemo() {
  if (guidedRunning) return;
  guidedRunning = true;
  try {
    /* walk the user through the choices visibly instead of jumping blindly */
    location.hash = '#/models'; navigate();
    await wait(450);
    if (state.recommended) selectModel(state.recommended);
    selectScenario('theft');
    $('severity').value = '0.9'; $('sev-val').textContent = '0.90'; $('sev-mean').textContent = severityMeaning(0.9);
    if (state.window) $('asof').value = state.window.max;
    $('tamper').checked = true;
    /* clear stale filters so the results list is complete */
    state.search = ''; $('meter-search').value = '';
    flagOnly = false; $('flag-only').checked = false;
    updateSummary();
    toast(`Guided demo - ${modelDisplayName(state.model)}; theft at 0.90 with tamper. Running...`);
    await wait(700);
    await run();
  } finally {
    guidedRunning = false;
  }
}

/* ---------- render ---------- */
function render(j) {
  lastResponse = j;

  /* plain-English summary banner */
  const flagged = j.meters.filter(m => m.inspection_flag).length;
  const top = [...j.meters].sort((a, b) => a.rank - b.rank)[0];
  const op = j.operating_point || {};
  let s = `${esc(modelDisplayName(j.model))} ranked ${j.meters.length} meters in ${fmt(j.runtime_seconds, 2)} s. `;
  if (flagged === 0) s += 'No meters met the precision target, so no flags were raised. ';
  else s += `${flagged} meter${flagged === 1 ? '' : 's'} met the precision target and were flagged for review. `;
  if (top) s += `Top suspicion: meter ${esc(top.meter_id)} on DT ${top.dt_id} (p = ${fmt(top.probability_simulated_theft, 2)}).`;
  $('sum-banner').textContent = s;
  $('zero-flag-note').classList.toggle('hidden', flagged !== 0);

  /* KPIs */
  $('kpi-flag').textContent = flagged;
  $('kpi-thresh').textContent = fmt(op.threshold, 3);
  $('kpi-top').textContent = fmt(j.dts[0]?.unexplained_kwh, 1);
  $('kpi-rt').textContent = fmt(j.runtime_seconds, 2);
  renderMeters(j);

  /* transformers with inline bars */
  const maxUn = Math.max(...j.dts.map(d => d.unexplained_kwh), 1e-9);
  const dtb = $('dts-table').tBodies[0];
  dtb.innerHTML = '';
  for (const d of j.dts) {
    const tr = document.createElement('tr');
    const w = Math.max(2, Math.round(d.unexplained_kwh / maxUn * 100));
    const la = d.loss_attribution || {};
    tr.innerHTML = `<td>${d.dt_id}</td><td>${fmt(d.unexplained_kwh, 1)}</td>` +
      `<td style="width:110px"><span class="pbar" style="width:90px"><span style="width:${w}%"></span></span></td>` +
      `<td>${fmt(d.candidate_allocated_kwh, 1)}</td><td>${fmt(d.unassigned_kwh, 1)}</td>` +
      `<td>${fmt(d.input_kwh, 1)}</td><td>${fmt(d.technical_loss_estimate_kwh, 1)}</td><td>${fmt(d.missing_fraction, 2)}</td>` +
      `<td>${fmt(la.meter_tamper_anomaly_kwh, 1)}</td><td>${fmt(la.defective_frozen_metering_kwh, 1)}</td>` +
      `<td>${fmt(la.unmetered_direct_hooking_kwh, 1)}</td>` +
      `<td title="${esc(d.recommended_action || '')}">${esc(d.rdss_mis_code || '-')}</td>`;
    dtb.appendChild(tr);
  }

  /* balance picker */
  const pick = $('dt-pick');
  const dts = [...new Set(j.daily_balance.map(r => r.dt_id))];
  const cur = pick.value;
  pick.innerHTML = '<option value="all">all DTs</option>' + dts.map(d => `<option value="${d}">DT ${d}</option>`).join('');
  if (dts.includes(cur)) pick.value = cur;

  state.chartDirty = true;
  refreshVisibleCharts();

  /* provenance */
  $('prov-meta').textContent =
    `Method: ${modelDisplayName(j.model)} | Scenario: ${j.scenario || '-'} | Telemetry: ${j.telemetry_mode || '-'} | Interval: ${j.as_of_interval ?? '-'}`;
  const notesHtml = (j.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
  $('notes').innerHTML = notesHtml;

  navigate(); // sync route UI (hides empty state if we're on results)
}

/* ---------- meters table ---------- */
function reasonChips(codes) {
  if (!codes || !codes.length) return '<span class="muted">-</span>';
  return codes.map(c => `<span class="rc-chip" title="${esc(c)}">${esc(c)}</span>`).join('');
}
function renderMeters(j) {
  let rows = [...j.meters];
  const q = state.search.trim().toLowerCase();
  if (q) rows = rows.filter(m => String(m.meter_id).toLowerCase().includes(q));
  if (flagOnly) rows = rows.filter(m => m.inspection_flag);
  rows.sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    const c = (typeof va === 'string' || typeof vb === 'string')
      ? String(va).localeCompare(String(vb), undefined, { numeric: true }) : va - vb;
    return c * sortDir;
  });

  document.querySelectorAll('#meters-table th.sort').forEach(th => {
    th.classList.toggle('active', th.dataset.key === sortKey);
    th.classList.toggle('desc', th.dataset.key === sortKey && sortDir === -1);
    th.setAttribute('aria-sort', th.dataset.key === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
  });
  $('meter-count').textContent = `showing ${rows.length} of ${j.meters.length} meters · ${j.meters.filter(m => m.inspection_flag).length} flagged`;

  const tb = $('meters-table').tBodies[0];
  tb.innerHTML = '';
  for (const m of rows) {
    const tr = document.createElement('tr');
    if (m.inspection_flag) tr.className = 'flag-row';
    const pct = Math.round(Math.min(Math.max(m.probability_simulated_theft, 0), 1) * 100);
    tr.innerHTML =
      `<td>${m.rank}</td><td>${esc(m.meter_id)}</td><td>${m.dt_id}</td>` +
      `<td><span class="pbar"><span style="width:${pct}%"></span></span><span class="mono">${fmt(m.probability_simulated_theft)}</span></td>` +
      `<td><span class="pill ${m.inspection_flag ? 'flag' : 'ok'}">${m.inspection_flag ? 'flag' : '-'}</span></td>` +
      `<td>${fmt(m.candidate_kwh_allocation, 1)}</td><td>${fmt(m.recorded_to_baseline_ratio, 2)}</td>` +
      `<td>${fmt(m.missing_fraction, 2)}</td><td>${reasonChips(m.reason_codes)}</td>` +
      `<td title="${esc(m.recommended_action || '')}">${esc(m.recommended_action || '-')}</td>` +
      `<td>${esc(m.assigned_owner || '-')}</td><td>${esc(m.target_sla || '-')}</td>` +
      `<td class="mono">${esc(m.rdss_mis_code || '-')}</td>`;
    tb.appendChild(tr);
  }
}

/* ---------- charts (palette-matched) ---------- */
const PLOT_FONT = { family: 'Inter,"Segoe UI",Roboto,sans-serif', color: '#222B2E' };
function drawBalance(j) {
  const el = $('balance-chart');
  if (!el || el.offsetParent === null) { state.chartDirty = true; return; }
  const sel = $('dt-pick').value;
  let rows = j.daily_balance;
  if (sel !== 'all') rows = rows.filter(r => String(r.dt_id) === sel);
  const agg = {};
  for (const r of rows) {
    const k = r.ts.slice(0, 10);
    const a = agg[k] = agg[k] || { input: 0, obs: 0, imp: 0, tech: 0, res: 0 };
    a.input += r.input_kwh; a.obs += r.observed_consumer_kwh; a.imp += r.imputed_consumer_kwh;
    a.tech += r.estimated_technical_kwh; a.res += r.residual_kwh;
  }
  const x = Object.keys(agg).sort();
  const g = v => x.map(k => Number(agg[k][v].toFixed(2)));
  const traces = [
    { x, y: g('obs'), name: 'measured consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#8A9089' } },
    { x, y: g('imp'), name: 'imputed consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#C4C9C3' } },
    { x, y: g('tech'), name: 'estimated technical kWh', type: 'bar', stackgroup: 's', marker: { color: '#E3EBE7' } },
    { x, y: g('res'), name: 'unexplained residual kWh', type: 'scatter', mode: 'lines', line: { color: '#B4452A', width: 2 } },
  ];
  const layout = {
    margin: { l: 60, r: 16, t: 10, b: 40 }, barmode: 'stack', height: 340,
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: PLOT_FONT,
    legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
    yaxis: { title: 'kWh / day', gridcolor: '#E5E0D5', zerolinecolor: '#DDD7C9' },
    xaxis: { title: 'day', gridcolor: '#E5E0D5' },
  };
  Plotly.newPlot('balance-chart', traces, layout, { responsive: true, displayModeBar: false });
  state.chartDirty = false;
}
function refreshVisibleCharts() {
  if (!lastResponse) return;
  if (currentRoute() === 'results') {
    if ($('pane-balance').classList.contains('hidden') === false) drawBalance(lastResponse);
  }
}

/* ---------- CSV export (client-side only) ---------- */
function csvCell(v) { return `\"${String(v ?? '').replace(/\"/g, '\"\"')}\"`; }
function saveCsv(filename, cols, rows) {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvCell(Array.isArray(r[c]) ? r[c].join('; ') : r[c])).join(','));
  const blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}
function downloadCSV() {
  if (!lastResponse) return;
  const cols = ['rank', 'meter_id', 'dt_id', 'probability_simulated_theft', 'inspection_flag',
    'candidate_kwh_allocation', 'recorded_to_baseline_ratio', 'missing_fraction', 'reason_codes',
    'recommended_action', 'assigned_owner', 'target_sla', 'rdss_mis_code'];
  const rows = lastResponse.meters;
  saveCsv('rdss-mis-work-orders.csv', cols, rows);
  toast('RDSS MIS work-order CSV exported');
}
function downloadDTCsv() {
  if (!lastResponse) return;
  const cols = ['dt_id', 'input_kwh', 'technical_loss_estimate_kwh', 'unexplained_kwh',
    'candidate_allocated_kwh', 'unassigned_kwh', 'missing_fraction',
    'technical_loss_kwh', 'meter_tamper_anomaly_kwh', 'defective_frozen_metering_kwh',
    'unmetered_direct_hooking_kwh',
    'recommended_action', 'assigned_owner', 'target_sla', 'rdss_mis_code'];
  const rows = lastResponse.dts.map(d => ({ ...d, ...(d.loss_attribution || {}) }));
  saveCsv('rdss-mis-transformer-work-orders.csv', cols, rows);
  toast('Transformer work-order CSV exported');
}

function downloadRunSummary() {
  if (!lastResponse) return;
  const summary = {
    title: 'Grid-GNN scoring run summary',
    timestamp: new Date().toISOString(),
    model: lastResponse.model,
    model_name: modelDisplayName(lastResponse.model),
    profile_source: lastResponse.profile_source,
    scenario: lastResponse.scenario,
    scoring_window: lastResponse.scoring_window || null,
    meters_count: lastResponse.meters.length,
    dts_count: lastResponse.dts.length,
    dt_loss_attribution: lastResponse.dts.map(d => ({
      dt_id: d.dt_id,
      input_kwh: d.input_kwh,
      unexplained_kwh: d.unexplained_kwh,
      technical_loss_kwh: (d.loss_attribution || {}).technical_loss_kwh,
      meter_tamper_anomaly_kwh: (d.loss_attribution || {}).meter_tamper_anomaly_kwh,
      defective_frozen_metering_kwh: (d.loss_attribution || {}).defective_frozen_metering_kwh,
      unmetered_direct_hooking_kwh: (d.loss_attribution || {}).unmetered_direct_hooking_kwh,
      recommended_action: d.recommended_action,
      assigned_owner: d.assigned_owner,
      target_sla: d.target_sla,
      rdss_mis_code: d.rdss_mis_code,
    })),
    top_flagged_meters: lastResponse.meters.filter(m => m.inspection_flag).map(m => ({
      meter_id: m.meter_id, dt_id: m.dt_id,
      probability_simulated_theft: m.probability_simulated_theft,
      reason_codes: m.reason_codes,
      recommended_action: m.recommended_action,
      assigned_owner: m.assigned_owner,
      target_sla: m.target_sla,
      rdss_mis_code: m.rdss_mis_code,
    })),
  };
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grid-gnn-run-summary.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  toast('Run summary exported');
}

/* ---------- router ---------- */
const ROUTES = {
  '': 'home', 'home': 'home', 'models': 'models', 'results': 'results',
  'how': 'how', 'evidence': 'evidence', 'about': 'about', 'team': 'team',
  'run': 'models',                       // legacy alias
  'meters': 'results', 'dts': 'results', 'charts': 'results', // legacy aliases → tabs
};
const TITLES = {
  home: 'Grid-GNN - Electricity theft triage',
  models: 'Grid-GNN - Choose a scoring method',
  results: 'Grid-GNN - Results',
  how: 'Grid-GNN - How it works',
  evidence: 'Grid-GNN - Evaluation evidence',
  about: 'Grid-GNN - Governance',
  team: 'Grid-GNN - The team',
};
const LEGACY_TAB = { meters: 'meters', dts: 'dts', charts: 'balance' };

function currentRoute() {
  const m = location.hash.match(/^#\/?(\w*)/);
  return ROUTES[m ? m[1] : ''] || 'home';
}
function setStepper(step) {
  const st = $('stepper');
  const onResults = currentRoute() === 'results', onModels = currentRoute() === 'models';
  st.classList.toggle('hidden', !(onModels || onResults));
  const active = onResults ? 'review' : (onModels ? 'choose' : step);
  const order = ['choose', 'run', 'review'];
  st.querySelectorAll('li').forEach(li => {
    li.classList.toggle('active', li.dataset.step === active);
    li.classList.toggle('done', order.indexOf(li.dataset.step) < order.indexOf(active));
  });
}
function activateTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + ({ meters: 'meters', dts: 'dts', balance: 'balance', compare: 'compare' }[name])));
  refreshVisibleCharts();
}
function navigate() {
  let r = currentRoute();
  /* legacy aliases with tabs */
  const m = location.hash.match(/^#\/(\w+)/);
  if (m && LEGACY_TAB[m[1]]) {
    const tab = LEGACY_TAB[m[1]];
    history.replaceState(null, '', `#/results?tab=${tab}`);
    activateTab(tab);
  }
  /* Query parameters inside the route hash. */
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('model') && document.querySelector(`.mcard[data-model="${q.get('model')}"]:not(.unavailable)`)) selectModel(q.get('model'));
  if (q.get('scenario')) selectScenario(q.get('scenario'));

  document.title = TITLES[r] || TITLES.home;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + r));
  document.querySelectorAll('#nav a').forEach(a => {
    const active = a.dataset.route === r;
    a.classList.toggle('active', active);
    a.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const has = !!lastResponse;
  $('empty-results').classList.toggle('hidden', has);
  $('results-body').classList.toggle('hidden', !has);
  if (r === 'results') {
    activateTab(q.get('tab') && ['meters', 'dts', 'balance', 'compare'].includes(q.get('tab')) ? q.get('tab') : 'meters');
  }
  setStepper();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', navigate);

/* ---------- wiring ---------- */
$('severity').addEventListener('input', () => {
  const v = parseFloat($('severity').value);
  $('sev-val').textContent = v.toFixed(2);
  $('sev-mean').textContent = severityMeaning(v);
  updateSummary();
});
$('tamper').addEventListener('change', updateSummary);
$('asof').addEventListener('change', updateSummary);
document.querySelectorAll('input[name="scen"]').forEach(r =>
  r.addEventListener('change', () => selectScenario(r.value)));
document.querySelectorAll('.mcard').forEach(c => c.addEventListener('click', () => {
  if (c.classList.contains('unavailable')) { toast('That scoring method is not loaded in this dataset.'); return; }
  selectModel(c.dataset.model);
}));
document.querySelectorAll('.btn[data-preset]').forEach(b => b.addEventListener('click', () => {
  const p = b.dataset.preset;
  if (p === 'theft') { selectScenario('theft'); $('severity').value = '0.9'; $('tamper').checked = true; }
  if (p === 'vacancy') { selectScenario('vacancy'); $('severity').value = '0.7'; }
  if (p === 'hooking') { selectScenario('upstream_hooking'); $('severity').value = '0.7'; }
  if (p === 'baseline') { selectScenario('none'); $('severity').value = '0.7'; }
  $('sev-val').textContent = parseFloat($('severity').value).toFixed(2);
  $('sev-mean').textContent = severityMeaning(parseFloat($('severity').value));
  updateSummary();
   toast('Preset applied. Review it, then press Run scoring.');
}));
$('run').addEventListener('click', run);
$('compare-all').addEventListener('click', runCompareAll);
$('empty-guided').addEventListener('click', guidedDemo);
$('empty-sample').addEventListener('click', loadSample);
$('run-sample').addEventListener('click', loadSample);
$('exit-sample').addEventListener('click', exitSample);
$('btn-csv').addEventListener('click', downloadCSV);
$('btn-csv-dt').addEventListener('click', downloadDTCsv);
$('btn-summary').addEventListener('click', downloadRunSummary);
$('flag-only').addEventListener('change', e => { flagOnly = e.target.checked; if (lastResponse) renderMeters(lastResponse); });
$('meter-search').addEventListener('input', e => { state.search = e.target.value; if (lastResponse) renderMeters(lastResponse); });
$('dt-pick').addEventListener('change', () => { if (lastResponse) drawBalance(lastResponse); });
document.querySelectorAll('#meters-table th.sort').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.key;
  if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
  if (lastResponse) renderMeters(lastResponse);
}));
/* tabs: click + keyboard */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));
document.querySelector('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('.tab')];
  const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
  const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  n.focus(); activateTab(n.dataset.tab); e.preventDefault();
});

/* team page: know-more toggles */
document.querySelectorAll('.know-more').forEach(b => b.addEventListener('click', () => {
  const bio = b.parentElement.querySelector('.bio');
  const open = !bio.classList.contains('hidden');
  bio.classList.toggle('hidden', open);
  b.textContent = open ? 'Know more' : 'Show less';
  b.setAttribute('aria-expanded', String(!open));
}));

/* ---------- init ---------- */
selectScenario('theft');
navigate();
boot();
