const params = new URLSearchParams(location.search);
// explicit ?api= wins; otherwise default to the local API when the page itself is served locally
const API_BASE = params.get('api') ||
  (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8001' : 'https://USERNAME-grid-gnn-api.hf.space');
document.getElementById('api-link').href = API_BASE;
document.getElementById('docs-link').href = API_BASE + '/docs';

const $ = id => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setStatus(msg, err = false) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (err ? ' err' : '');
}

function setBusy(busy) {
  $('run').disabled = busy;
  $('run').setAttribute('aria-busy', busy);
  $('run-spin').hidden = !busy;
  $('run-label').textContent = busy ? 'Scoring…' : 'Run scoring';
}

/* fetch with cold-start retries + per-attempt timeout */
async function fetchWithRetry(url, opts = {}, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await fetch(url, { ...opts, signal: ac.signal });
      if (r.status === 502 || r.status === 503) throw new Error('backend waking');
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('request timed out — backend unreachable');
      if (i === attempts - 1) throw e;
      setStatus(`Backend is waking up (free tier cold start) — retry ${i + 1}/${attempts} in 15 s…`);
      await new Promise(res => setTimeout(res, 15000));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function boot() {
  setStatus('Contacting backend…');
  try {
    const r = await fetchWithRetry(API_BASE + '/health');
    const h = await r.json();
    // adapt the model list and interval window to whatever dataset the backend loaded
    if (Array.isArray(h.models_available) && h.models_available.length) {
      const sel = $('model').value;
      $('model').innerHTML = h.models_available.map(m => `<option value="${m}">${m}</option>`).join('');
      $('model').value = h.models_available.includes(sel) ? sel : h.model;
    }
    if (h.scoring_window && h.scoring_window.max) {
      const w = $('asof');
      w.min = h.scoring_window.min; w.max = h.scoring_window.max;
      w.step = 96; w.value = h.scoring_window.max;
      $('asof-hint').textContent = `Valid range ${h.scoring_window.min}\u2013${h.scoring_window.max} intervals of stored history (dataset: ${h.profile_source}).`;
    }
    if (h.model) { $('badge-model').textContent = 'model ' + h.model; }
    if (h.profile_source) {
      $('badge-source').textContent =
        h.profile_source === 'synthetic_fallback' ? 'data: synthetic (demo)' : 'data: ' + h.profile_source;
    }
    if (h.config_hash) {
      $('badge-config').textContent = 'config ' + h.config_hash;
      $('badge-config').title = 'Configuration hash: identifies the exact scenario/config bundle the backend was launched with.\nconfig_hash: ' + h.config_hash;
    }
    setStatus(`Backend ready — selected model ${h.model}.`);
  } catch (e) {
    setStatus(`Cannot reach backend at ${API_BASE} — deploy the Space or pass ?api=<url>.`, true);
  }
}

async function run() {
  setBusy(true);
  setStatus('Scoring…');
  const body = {
    model: $('model').value,
    scenario: $('scenario').value,
    severity: parseFloat($('severity').value),
    as_of_interval: parseInt($('asof').value, 10),
    tamper_event: $('tamper').checked,
  };
  if ($('meter').value) body.meter_id = $('meter').value;
  try {
    const r = await fetchWithRetry(API_BASE + '/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.detail || ('HTTP ' + r.status));
    }
    const j = await r.json();
    render(j);
    const flagged = j.meters.filter(m => m.inspection_flag).length;
    setStatus(`Done — ${flagged} of ${j.meters.length} meters flagged in ${fmt(j.runtime_seconds, 2)} s. Full ranked list below.`);
    // take the user straight to the results so it's obvious the run completed
    location.hash = '#/meters';
    navigate();
  } catch (e) {
    setStatus('Scoring failed: ' + e.message, true);
  } finally {
    setBusy(false);
  }
}

/* ---------- meters table: filter + sort state ---------- */
let lastResponse = null;
let sortKey = 'rank', sortDir = 1, flagOnly = false;

function renderMeters(j) {
  let rows = [...j.meters];
  if (flagOnly) rows = rows.filter(m => m.inspection_flag);
  rows.sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    const c = (typeof va === 'string' || typeof vb === 'string')
      ? String(va).localeCompare(String(vb), undefined, { numeric: true })
      : va - vb;
    return c * sortDir;
  });

  document.querySelectorAll('#meters-table th.sort').forEach(th => {
    th.classList.toggle('active', th.dataset.key === sortKey);
    th.classList.toggle('desc', th.dataset.key === sortKey && sortDir === -1);
    th.setAttribute('aria-sort',
      th.dataset.key === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
  });

  const flagged = j.meters.filter(m => m.inspection_flag).length;
  $('meter-count').textContent =
    `showing ${rows.length} of ${j.meters.length} meters · ${flagged} flagged`;

  const tb = $('meters-table').tBodies[0];
  tb.innerHTML = '';
  for (const m of rows) {
    const tr = document.createElement('tr');
    if (m.inspection_flag) tr.className = 'flag-row';
    tr.innerHTML = `<td>${m.rank}</td><td>${esc(m.meter_id)}</td><td>${m.dt_id}</td>` +
      `<td>${fmt(m.probability_simulated_theft)}</td>` +
      `<td><span class="pill ${m.inspection_flag ? 'flag' : 'ok'}">${m.inspection_flag ? 'flag' : '—'}</span></td>` +
      `<td>${fmt(m.candidate_kwh_allocation, 1)}</td><td>${fmt(m.recorded_to_baseline_ratio, 2)}</td>` +
      `<td>${fmt(m.missing_fraction, 2)}</td><td>${esc((m.reason_codes || []).join('; ')) || '—'}</td>`;
    tb.appendChild(tr);
  }
}

function render(j) {
  lastResponse = j;
  const sha = j.model_sha256 || '';
  $('badge-sha').textContent = 'sha ' + (sha ? sha.slice(0, 12) : '—');
  $('badge-sha').title = sha
    ? 'SHA-256 of the loaded model artifact (models.joblib).\nFull hash: ' + sha
    : 'No model hash in the response.';
  $('badge-model').textContent = 'model ' + $('model').value;
  const op = j.operating_point || {};
  $('kpi-flag').textContent = j.meters.filter(m => m.inspection_flag).length;
  $('kpi-top').textContent = fmt(j.dts[0]?.unexplained_kwh, 1);
  $('kpi-thresh').textContent = fmt(op.threshold, 3);
  $('kpi-rt').textContent = fmt(j.runtime_seconds, 2);
  $('op-note').textContent = op.validation_target_met === false
    ? 'The validation precision target was unattainable for this model — inspection flags are disabled.'
    : 'Operating point targets the predeclared validation precision; probabilities are decision-support scores, not field-validated probabilities.';

  renderMeters(j);

  const dtb = $('dts-table').tBodies[0];
  dtb.innerHTML = '';
  for (const d of j.dts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.dt_id}</td><td>${fmt(d.unexplained_kwh, 1)}</td><td>${fmt(d.candidate_allocated_kwh, 1)}</td>` +
      `<td>${fmt(d.unassigned_kwh, 1)}</td><td>${fmt(d.input_kwh, 1)}</td><td>${fmt(d.technical_loss_estimate_kwh, 1)}</td>` +
      `<td>${fmt(d.missing_fraction, 2)}</td>`;
    dtb.appendChild(tr);
  }

  const pick = $('dt-pick');
  const dts = [...new Set(j.daily_balance.map(r => r.dt_id))];
  const cur = pick.value;
  pick.innerHTML = '<option value="all">all DTs</option>' + dts.map(d => `<option value="${d}">DT ${d}</option>`).join('');
  if (dts.includes(cur)) pick.value = cur;

  const prevMeter = $('meter').value;
  const ms = j.meters.map(m => `<option value="${esc(m.meter_id)}">${esc(m.meter_id)} (DT ${m.dt_id})</option>`).join('');
  $('meter').innerHTML = '<option value="">first ranked meter</option>' + ms;
  const hasPrev = [...$('meter').options].some(o => o.value === prevMeter);
  if (hasPrev) $('meter').value = prevMeter;
  else if (j.scenario && j.scenario !== 'none') $('meter').value = j.meters[0]?.meter_id || '';

  drawBalance(j);
  drawExplanation(j);

  $('notes').innerHTML = (j.notes || []).map(n => `<li>${esc(n)}</li>`).join('');

  navigate(); // re-sync route views now that data exists (hides empty states)
}

function drawBalance(j) {
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
    { x, y: g('obs'), name: 'observed consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#8f8f8f' } },
    { x, y: g('imp'), name: 'imputed consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#4d4d4d' } },
    { x, y: g('tech'), name: 'estimated technical kWh', type: 'bar', stackgroup: 's', marker: { color: '#2b2b2b' } },
    { x, y: g('res'), name: 'residual kWh (unexplained)', type: 'scatter', mode: 'lines', line: { color: '#ef4444', width: 2 } },
  ];
  const layout = {
    margin: { l: 60, r: 16, t: 10, b: 40 }, barmode: 'stack', height: 340,
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#d4d4d4' },
    legend: { orientation: 'h', y: -0.18, font: { color: '#8f8f8f' } },
    yaxis: { title: 'kWh / day', gridcolor: '#262626', zerolinecolor: '#262626' },
    xaxis: { title: 'day', gridcolor: '#262626' },
  };
  Plotly.newPlot('balance-chart', traces, layout, { responsive: true, displayModeBar: false });
}

function drawExplanation(j) {
  const e = j.selected_meter_explanation;
  if (!e || !e.group_names) { $('expl-card').style.display = 'none'; return; }
  $('expl-card').style.display = '';
  $('expl-method').textContent = (e.method || '') +
    ` — reference probability ${fmt(Array.isArray(e.reference_probability) ? e.reference_probability[0] : e.reference_probability)}` +
    `, prediction ${fmt(Array.isArray(e.prediction) ? e.prediction[0] : e.prediction)}` +
    `, additivity max error ${fmt(e.additivity_max_error)}. Grouped, reference-based interventional Shapley; not causal.`;
  const vals = e.values;
  const row = Array.isArray(vals[0]) ? vals[0] : vals;
  const order = e.group_names.map((n, i) => [n, row[i]]).sort((a, b) => a[1] - b[1]);
  Plotly.newPlot('expl-chart', [{
    type: 'bar', orientation: 'h',
    x: order.map(p => Number(p[1].toFixed(4))), y: order.map(p => p[0]),
    marker: { color: order.map(p => p[1] >= 0 ? '#ef4444' : '#5c5c5c') },
  }], { margin: { l: 190, r: 16, t: 10, b: 40 }, height: 40 + 26 * order.length,
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#d4d4d4' },
    xaxis: { title: 'Shapley contribution to p(theft)', gridcolor: '#262626', zerolinecolor: '#4d4d4d' } },
    { responsive: true, displayModeBar: false });
}

/* ---------- hash router (static-host friendly) ---------- */
const ROUTES = ['run', 'meters', 'dts', 'charts', 'about'];
function currentRoute() {
  const m = location.hash.match(/^#\/(\w+)/);
  return m && ROUTES.includes(m[1]) ? m[1] : 'run';
}
function navigate() {
  const r = currentRoute();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + r));
  document.querySelectorAll('#nav .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.route === r);
    t.setAttribute('aria-current', t.dataset.route === r ? 'page' : 'false');
  });
  const has = !!lastResponse;
  $('empty-meters').hidden = has;
  $('empty-dts').hidden = has;
  $('empty-charts').hidden = has;
  window.scrollTo(0, 0); // each route starts at the top
  // Plotly renders wrongly inside display:none containers — redraw when charts become visible
  if (r === 'charts' && has) { drawBalance(lastResponse); drawExplanation(lastResponse); }
}
window.addEventListener('hashchange', navigate);

/* ---------- wiring ---------- */
$('severity').addEventListener('input', () => $('sev-val').textContent = parseFloat($('severity').value).toFixed(2));
$('run').addEventListener('click', run);
$('dt-pick').addEventListener('change', () => { if (lastResponse) drawBalance(lastResponse); });
$('flag-only').addEventListener('change', e => { flagOnly = e.target.checked; if (lastResponse) renderMeters(lastResponse); });
document.querySelectorAll('#meters-table th.sort').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.key;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    if (lastResponse) renderMeters(lastResponse);
  });
});
navigate(); // apply initial route
boot();
