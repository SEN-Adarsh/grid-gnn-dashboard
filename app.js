/* ============ Grid-GNN — Rodic competition UI ============
   API contract is unchanged: same POST fields, same response reads.
   All request/response handling mirrors the original app.js. */

const params0 = new URLSearchParams(location.search);
// explicit ?api= wins; otherwise default to the local API when served locally
const API_BASE = params0.get('api') ||
  (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8001' : 'https://grid-gnn-api.onrender.com');
document.getElementById('api-link').href = API_BASE;
document.getElementById('docs-link').href = API_BASE + '/docs';

const $ = id => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- app state ---------- */
const state = {
  model: null,            // selected model (set from /health availability)
  scenario: 'theft',
  recommended: null,
  window: null,           // {min,max} from /health
  health: null,
  search: '',
  chartDirty: false,
  explDirty: false,
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
        throw new Error('no backend is reachable at ' + API_BASE + ' — it is not running. Start it, or view the sample data instead.');
      }
      if (i === attempts - 1) throw e;
      const msg = `Waking the hosting container (it sleeps after ~15 min of inactivity) — this usually takes 15–30 seconds. Attempt ${i + 1} of ${attempts}… stay on this page, your results will appear automatically.`;
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
  state.recommended = avail && avail.length ? priority.find(m => avail.includes(m)) : (h.model || 'M0');
  document.querySelectorAll('.mcard [data-tag="rec"]').forEach(t => t.classList.add('hidden'));
  const recCard = document.querySelector(`.mcard[data-model="${state.recommended}"]`);
  if (recCard) recCard.querySelector('[data-tag="rec"]').classList.remove('hidden');
  if (!state.sampleMode || !state.model || !avail || avail.includes(state.model)) selectModel(state.recommended);

  /* scoring window — never hardcoded */
  if (h.scoring_window && h.scoring_window.max) {
    state.window = h.scoring_window;
    const w = $('asof');
    w.min = h.scoring_window.min; w.max = h.scoring_window.max; w.value = h.scoring_window.max;
    $('asof-hint').textContent = `Score using the first ${h.scoring_window.max} quarter-hours of stored history (valid range ${h.scoring_window.min}–${h.scoring_window.max} for this dataset).`;
  } else {
    $('asof').value = '';
    $('asof-hint').textContent = 'Backend did not report a scoring window — the full stored history will be used.';
  }

  /* home status card */
  $('fact-dataset').textContent = h.profile_source || '—';
  $('fact-model').textContent = h.model || '—';
  $('fact-window').textContent = h.scoring_window ? `${h.scoring_window.min}–${h.scoring_window.max} intervals` : '—';
  $('fact-config').textContent = h.config_hash || '—';
  $('fact-note').textContent = h.models_note || '—';
  $('home-skeleton').classList.add('hidden');
  $('home-facts').classList.remove('hidden');

  updateSummary();
}

async function boot() {
  setDot('waking', 'checking…');
  $('home-skeleton').classList.remove('hidden');
  $('home-error').classList.add('hidden');
  $('home-facts').classList.add('hidden');
  $('btn-retry').classList.add('hidden');
  $('btn-sample').classList.add('hidden');
  try {
    const r = await fetchWithRetry(API_BASE + '/health', {}, 6, m => {
      $('home-error').textContent = m; $('home-error').classList.remove('hidden');
    });
    const h = await r.json();
    setDot('ok', 'backend ready');
    setSampleBanner(false);
    applyHealthFields(h);
  } catch (e) {
    setDot('down', 'unreachable');
    $('home-skeleton').classList.add('hidden');
    const err = $('home-error');
    err.textContent = `The backend at ${API_BASE} could not be reached (${e.message}). ` +
      'The hosting container goes to sleep after ~15 minutes of inactivity — please wait 15–30 seconds for it to wake up, then retry.';
    err.classList.remove('hidden');
    $('btn-retry').classList.remove('hidden');
    $('btn-sample').classList.remove('hidden');
    setStatus('Cannot reach backend — ' + e.message, true);
  }
}

/* ---------- sample mode (frontend-only preview; always clearly labelled) ---------- */
const SAMPLE_HEALTH = {
  profile_source: 'synthetic_india_v2 (sample)',
  model: 'M0',
  config_hash: 'sample-mode',
  models_available: ['M0', 'M1'],
  models_note: 'Sample mode — this note is static; no backend is connected.',
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
    });
  }
  const dts = [
    { dt_id: 0, unexplained_kwh: 4.2, candidate_allocated_kwh: 0, unassigned_kwh: 4.2, input_kwh: 96.5, technical_loss_estimate_kwh: 1.1, missing_fraction: 0.03 },
    { dt_id: 1, unexplained_kwh: 1.3, candidate_allocated_kwh: 0, unassigned_kwh: 1.3, input_kwh: 88.2, technical_loss_estimate_kwh: 1.0, missing_fraction: 0.02 },
  ];
  if (scenario === 'theft') {
    const m = meters[3];
    m.probability_simulated_theft = Math.min(0.96, 0.5 + 0.45 * severity);
    m.recorded_to_baseline_ratio = Math.max(0.05, 1 - severity);
    m.reason_codes = [
      `Recorded energy is ${m.recorded_to_baseline_ratio.toFixed(2)} times the own-history expectation.`,
      'Tamper-like event rate 1.00 per day; events are imperfect evidence.',
    ];
  } else if (scenario === 'upstream_hooking') {
    dts[0].unexplained_kwh += 14 * severity;
    dts[0].unassigned_kwh = dts[0].unexplained_kwh;
    meters.forEach(m => { if (m.dt_id === 0) m.probability_simulated_theft = Math.min(0.4, m.probability_simulated_theft); });
  } else if (scenario === 'ami_dropout') {
    const m = meters[7];
    m.missing_fraction = 0.9; m.probability_simulated_theft = Math.min(0.9, 0.3 + 0.3 * severity);
    m.reason_codes = ['Missing intervals: 90.0% of the assessment window.'];
  } else { // none / vacancy — everything stays calm
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
    config_hash: 'sample-mode', model_sha256: 'sample00000000deadbeef00000000feedface000000',
    as_of_interval: 1344, as_of_time: '2026-06-14T23:45:00+05:30',
    telemetry_mode: 'recorded sample', scenario,
    operating_point: { threshold, target_precision: 0.7, validation_target_met: true, validation_flags: 6, validation_precision: 0.73, validation_recall: 0.58 },
    meters, dts, daily_balance: daily,
    selected_meter_explanation: null, // M0/M1 do not produce explanations
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
  setDot('waking', 'sample mode — backend offline');
  setSampleBanner(true);
  lastResponse = makeSampleResponse(state.scenario, parseFloat($('severity').value));
  render(lastResponse);
  location.hash = '#/results';
  navigate();
  setStatus('Sample mode — showing generated demo data.', false);
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
    : 'Tamper events apply to the theft scenario only — disabled for this scenario.';
  updateSummary();
}
function severityMeaning(v) {
  if (v >= 0.8) return 'Strong anomaly — deliberately easy to spot.';
  if (v >= 0.5) return 'Moderate anomaly — a realistic inspection case.';
  return 'Subtle anomaly — hard to distinguish from noise.';
}
function updateSummary() {
  const tam = $('tamper').checked && state.scenario === 'theft' ? ' with a tamper event' : '';
  $('run-summary').textContent =
    `You are running ${state.model || '…'} on ${state.scenario} @ ${parseFloat($('severity').value).toFixed(2)}${tam}.`;
}

/* ---------- run ---------- */
function setBusy(busy) {
  $('run').disabled = busy;
  $('run').setAttribute('aria-busy', String(busy));
  $('run-spin').hidden = !busy;
  $('run-label').textContent = busy ? 'Scoring…' : 'Run scoring';
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
  if (!state.model) { setStatus('Choose a model first.', true); return; }
  if (state.sampleMode) { // frontend-only preview: regenerate the clearly-labelled sample
    lastResponse = makeSampleResponse(state.scenario, parseFloat($('severity').value));
    render(lastResponse);
    location.hash = '#/results';
    navigate();
    toast('Sample response regenerated (backend offline).');
    return;
  }
  setBusy(true);
  showRunState('progress', 'Scoring…');
  setStatus('Scoring…');

  /* Payload — EXACT original fields, nothing extra (backend forbids extras). */
  const body = {
    model: state.model,
    scenario: state.scenario,
    severity: parseFloat($('severity').value),
    as_of_interval: parseInt($('asof').value, 10),
    tamper_event: $('tamper').checked,
  };
  if (!Number.isFinite(body.as_of_interval)) delete body.as_of_interval; // no window known → backend uses full history
  if ($('meter').value) body.meter_id = $('meter').value;

  try {
    const r = await fetchWithRetry(API_BASE + '/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, 6, m => showRunState('progress', m));
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.detail || ('HTTP ' + r.status));
    }
    showRunState(null);
    const j = await r.json();
    render(j);
    const flagged = j.meters.filter(m => m.inspection_flag).length;
    setStatus(`Done — ${flagged} of ${j.meters.length} meters met the operating point in ${fmt(j.runtime_seconds, 2)} s.`);
    /* take the user to the results page — the data was rendered by render(j) above */
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
    toast(`Guided demo — ${state.model} · theft @ 0.90 + tamper. Running…`);
    await wait(700);
    await run();
  } finally {
    guidedRunning = false;
  }
}

/* ---------- render ---------- */
function render(j) {
  lastResponse = j;
  $('run-count-word').textContent = `${j.meters.length} meters`;

  /* plain-English summary banner */
  const flagged = j.meters.filter(m => m.inspection_flag).length;
  const top = [...j.meters].sort((a, b) => a.rank - b.rank)[0];
  const op = j.operating_point || {};
  let s = `${esc(j.model || '')} ranked ${j.meters.length} meters in ${fmt(j.runtime_seconds, 2)} s. `;
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
  const sha = j.model_sha256 || '';
  $('kpi-sha').textContent = sha ? sha.slice(0, 12) : '—';
  $('kpi-sha').parentElement.title = sha ? 'SHA-256 of the loaded model artifact.\nFull hash: ' + sha : 'No model hash in the response.';
  $('kpi-config').textContent = (j.config_hash || (state.health && state.health.config_hash) || '—');
  $('kpi-config').parentElement.title = 'Identifies the exact backend configuration bundle for this run.\nconfig_hash: ' + $('kpi-config').textContent;

  renderMeters(j);

  /* transformers with inline bars */
  const maxUn = Math.max(...j.dts.map(d => d.unexplained_kwh), 1e-9);
  const dtb = $('dts-table').tBodies[0];
  dtb.innerHTML = '';
  for (const d of j.dts) {
    const tr = document.createElement('tr');
    const w = Math.max(2, Math.round(d.unexplained_kwh / maxUn * 100));
    tr.innerHTML = `<td>${d.dt_id}</td><td>${fmt(d.unexplained_kwh, 1)}</td>` +
      `<td style="width:110px"><span class="pbar" style="width:90px"><span style="width:${w}%"></span></span></td>` +
      `<td>${fmt(d.candidate_allocated_kwh, 1)}</td><td>${fmt(d.unassigned_kwh, 1)}</td>` +
      `<td>${fmt(d.input_kwh, 1)}</td><td>${fmt(d.technical_loss_estimate_kwh, 1)}</td><td>${fmt(d.missing_fraction, 2)}</td>`;
    dtb.appendChild(tr);
  }

  /* balance picker */
  const pick = $('dt-pick');
  const dts = [...new Set(j.daily_balance.map(r => r.dt_id))];
  const cur = pick.value;
  pick.innerHTML = '<option value="all">all DTs</option>' + dts.map(d => `<option value="${d}">DT ${d}</option>`).join('');
  if (dts.includes(cur)) pick.value = cur;

  /* explanation target picker */
  const prevMeter = $('meter').value;
  $('meter').innerHTML = '<option value="">first ranked meter</option>' +
    j.meters.map(m => `<option value="${esc(m.meter_id)}">${esc(m.meter_id)} (DT ${m.dt_id})</option>`).join('');
  if ([...$('meter').options].some(o => o.value === prevMeter)) $('meter').value = prevMeter;

  /* explanation tab availability */
  const hasExpl = !!j.selected_meter_explanation;
  $('expl-null').classList.toggle('hidden', hasExpl);
  $('expl-body').classList.toggle('hidden', !hasExpl);

  state.chartDirty = true; state.explDirty = true;
  refreshVisibleCharts();

  /* provenance */
  $('prov-meta').textContent =
    `model ${j.model || '—'} · sha ${(sha || '—').slice(0, 12)} · config ${j.config_hash || '—'} · scenario ${j.scenario || '—'} · telemetry_mode ${j.telemetry_mode || '—'} · as_of_interval ${j.as_of_interval ?? '—'}`;
  const notesHtml = (j.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
  $('notes').innerHTML = notesHtml;
  $('about-notes').innerHTML = notesHtml || '<li class="muted">No run yet — notes appear after your first scoring run.</li>';

  navigate(); // sync route UI (hides empty state if we're on results)
}

/* ---------- meters table ---------- */
function reasonChips(codes) {
  if (!codes || !codes.length) return '<span class="muted">—</span>';
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
    tr.dataset.meter = m.meter_id;
    const pct = Math.round(Math.min(Math.max(m.probability_simulated_theft, 0), 1) * 100);
    tr.innerHTML =
      `<td>${m.rank}</td><td>${esc(m.meter_id)}</td><td>${m.dt_id}</td>` +
      `<td><span class="pbar"><span style="width:${pct}%"></span></span><span class="mono">${fmt(m.probability_simulated_theft)}</span></td>` +
      `<td><span class="pill ${m.inspection_flag ? 'flag' : 'ok'}">${m.inspection_flag ? 'flag' : '—'}</span></td>` +
      `<td>${fmt(m.candidate_kwh_allocation, 1)}</td><td>${fmt(m.recorded_to_baseline_ratio, 2)}</td>` +
      `<td>${fmt(m.missing_fraction, 2)}</td><td>${reasonChips(m.reason_codes)}</td>`;
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
function drawExplanation(j) {
  const el = $('expl-chart');
  if (!el || el.offsetParent === null) { state.explDirty = true; return; }
  const e = j.selected_meter_explanation;
  if (!e || !e.group_names) { state.explDirty = false; return; }
  $('expl-method').textContent = (e.method || '') +
    ` — reference score ${fmt(Array.isArray(e.reference_probability) ? e.reference_probability[0] : e.reference_probability)}` +
    `, prediction ${fmt(Array.isArray(e.prediction) ? e.prediction[0] : e.prediction)}` +
    `, additivity max error ${fmt(e.additivity_max_error)}.`;
  const vals = e.values;
  const row = Array.isArray(vals[0]) ? vals[0] : vals;
  const order = e.group_names.map((n, i) => [n, row[i]]).sort((a, b) => a[1] - b[1]);
  Plotly.newPlot('expl-chart', [{
    type: 'bar', orientation: 'h',
    x: order.map(p => Number(p[1].toFixed(4))), y: order.map(p => p[0]),
    marker: { color: order.map(p => p[1] >= 0 ? '#B4452A' : '#1F5A46') },
  }], {
    margin: { l: 190, r: 16, t: 10, b: 40 }, height: 40 + 26 * order.length,
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: PLOT_FONT,
    xaxis: { title: 'contribution to the suspicion score', gridcolor: '#E5E0D5', zerolinecolor: '#6B6F6A' },
  }, { responsive: true, displayModeBar: false });
  state.explDirty = false;
}
function refreshVisibleCharts() {
  if (!lastResponse) return;
  if (currentRoute() === 'results') {
    if ($('pane-balance').classList.contains('hidden') === false) drawBalance(lastResponse);
    if ($('pane-expl').classList.contains('hidden') === false) drawExplanation(lastResponse);
  }
}

/* ---------- CSV export (client-side only) ---------- */
function downloadCSV() {
  if (!lastResponse) return;
  const cols = ['rank', 'meter_id', 'dt_id', 'probability_simulated_theft', 'inspection_flag',
    'candidate_kwh_allocation', 'recorded_to_baseline_ratio', 'missing_fraction', 'reason_codes'];
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [cols.join(',')];
  for (const m of lastResponse.meters) lines.push(cols.map(c => q(Array.isArray(m[c]) ? m[c].join('; ') : m[c])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grid-gnn-ranked-meters.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  toast('CSV downloaded');
}

/* ---------- router ---------- */
const ROUTES = {
  '': 'home', 'home': 'home', 'models': 'models', 'results': 'results',
  'how': 'how', 'evidence': 'evidence', 'about': 'about',
  'run': 'models',                       // legacy alias
  'meters': 'results', 'dts': 'results', 'charts': 'results', // legacy aliases → tabs
};
const TITLES = {
  home: 'Grid-GNN — Where should the inspector go first?',
  models: 'Grid-GNN — Step 1: choose a model and scenario',
  results: 'Grid-GNN — Step 3: results',
  how: 'Grid-GNN — How it works',
  evidence: 'Grid-GNN — Evidence and limits',
  about: 'Grid-GNN — Provenance and governance',
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
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + ({ meters: 'meters', dts: 'dts', balance: 'balance', explanation: 'expl' }[name])));
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
  /* query params inside the hash (?tab=…, ?model=…&scenario=…) */
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
    activateTab(q.get('tab') && ['meters', 'dts', 'balance', 'explanation'].includes(q.get('tab')) ? q.get('tab') : 'meters');
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
  if (c.classList.contains('unavailable')) { toast('That model is not loaded in this dataset.'); return; }
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
  toast('Preset applied — review and press Run scoring.');
}));
$('run').addEventListener('click', run);
$('btn-guided').addEventListener('click', guidedDemo);
$('empty-guided').addEventListener('click', guidedDemo);
$('btn-retry').addEventListener('click', boot);
$('btn-sample').addEventListener('click', loadSample);
$('empty-sample').addEventListener('click', loadSample);
$('run-sample').addEventListener('click', loadSample);
$('exit-sample').addEventListener('click', exitSample);
$('btn-csv').addEventListener('click', downloadCSV);
$('flag-only').addEventListener('change', e => { flagOnly = e.target.checked; if (lastResponse) renderMeters(lastResponse); });
$('meter-search').addEventListener('input', e => { state.search = e.target.value; if (lastResponse) renderMeters(lastResponse); });
$('dt-pick').addEventListener('change', () => { if (lastResponse) drawBalance(lastResponse); });
$('meter').addEventListener('change', updateSummary);
document.querySelectorAll('#meters-table th.sort').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.key;
  if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
  if (lastResponse) renderMeters(lastResponse);
}));
/* click a meter row → set explanation target */
document.querySelector('#meters-table tbody').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.meter) return;
  const id = tr.dataset.meter;
  if ([...$('meter').options].some(o => o.value === id)) {
    $('meter').value = id;
    toast(`Target meter set to ${id} for the next run.`);
    updateSummary();
  }
});
/* tabs: click + keyboard */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));
document.querySelector('.tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('.tab')];
  const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
  const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  n.focus(); activateTab(n.dataset.tab); e.preventDefault();
});

/* ---------- init ---------- */
selectScenario('theft');
navigate();
boot();
