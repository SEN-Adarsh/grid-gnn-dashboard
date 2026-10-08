const API_BASE = new URLSearchParams(location.search).get('api') || 'https://USERNAME-grid-gnn-api.hf.space';
document.getElementById('api-link').href = API_BASE;
document.getElementById('docs-link').href = API_BASE + '/docs';

const $ = id => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setStatus(msg, err = false) { $('status').textContent = msg; $('status').className = 'status' + (err ? ' err' : ''); }

async function fetchWithRetry(url, opts, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 502 || r.status === 503) throw new Error('backend waking');
      return r;
    } catch (e) {
      if (i === attempts - 1) throw e;
      setStatus(`Backend is waking up (free tier cold start) — retry ${i + 1}/${attempts} in 15 s…`);
      await new Promise(res => setTimeout(res, 15000));
    }
  }
}

async function boot() {
  setStatus('Contacting backend…');
  try {
    const r = await fetchWithRetry(API_BASE + '/health');
    const h = await r.json();
    if (h.model) $('model').value = h.model;
    if (h.config_hash) $('badge-config').textContent = 'config ' + h.config_hash;
    setStatus(`Backend ready — selected model ${h.model}.`);
  } catch (e) {
    setStatus(`Cannot reach backend at ${API_BASE} — deploy the Space or pass ?api=<url>.`, true);
  }
}

async function run() {
  const btn = $('run');
  btn.disabled = true;
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
    render(await r.json());
    setStatus('Done.');
  } catch (e) {
    setStatus('Scoring failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function render(j) {
  $('badge-sha').textContent = 'model sha ' + (j.model_sha256 || '—').slice(0, 12);
  const op = j.operating_point || {};
  const flagged = j.meters.filter(m => m.inspection_flag).length;
  $('kpi-flag').textContent = flagged;
  $('kpi-top').textContent = fmt(j.dts[0]?.unexplained_kwh, 1);
  $('kpi-thresh').textContent = fmt(op.threshold, 3);
  $('kpi-rt').textContent = fmt(j.runtime_seconds, 2);
  $('op-note').textContent = op.validation_target_met === false
    ? 'The validation precision target was unattainable for this model — inspection flags are disabled.'
    : 'Operating point targets the predeclared validation precision; probabilities are decision-support scores, not field-validated probabilities.';

  const tb = $('meters-table').tBodies[0];
  tb.innerHTML = '';
  for (const m of j.meters) {
    const tr = document.createElement('tr');
    if (m.inspection_flag) tr.className = 'flag-row';
    tr.innerHTML = `<td>${m.rank}</td><td>${esc(m.meter_id)}</td><td>${m.dt_id}</td>` +
      `<td>${fmt(m.probability_simulated_theft)}</td>` +
      `<td><span class="pill ${m.inspection_flag ? 'flag' : 'ok'}">${m.inspection_flag ? 'flag' : '—'}</span></td>` +
      `<td>${fmt(m.candidate_kwh_allocation, 1)}</td><td>${fmt(m.recorded_to_baseline_ratio, 2)}</td>` +
      `<td>${fmt(m.missing_fraction, 2)}</td><td>${esc((m.reason_codes || []).join('; ')) || '—'}</td>`;
    tb.appendChild(tr);
  }

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

  const ms = j.meters.map(m => `<option value="${esc(m.meter_id)}">${esc(m.meter_id)} (DT ${m.dt_id})</option>`).join('');
  $('meter').innerHTML = '<option value="">first meter</option>' + ms;
  if (j.scenario && j.scenario !== 'none') $('meter').value = j.meters[0]?.meter_id || '';

  drawBalance(j);
  drawExplanation(j);

  $('notes').innerHTML = (j.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
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
    { x, y: g('obs'), name: 'observed consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#2463eb' } },
    { x, y: g('imp'), name: 'imputed consumer kWh', type: 'bar', stackgroup: 's', marker: { color: '#9db8e8' } },
    { x, y: g('tech'), name: 'estimated technical kWh', type: 'bar', stackgroup: 's', marker: { color: '#c9d6a3' } },
    { x, y: g('res'), name: 'residual kWh (unexplained)', type: 'scatter', mode: 'lines', line: { color: '#b42318', width: 2 } },
  ];
  const layout = { margin: { l: 60, r: 16, t: 10, b: 40 }, barmode: 'stack', height: 340,
    legend: { orientation: 'h', y: -0.18 }, yaxis: { title: 'kWh / day' }, xaxis: { title: 'day' } };
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
    marker: { color: order.map(p => p[1] >= 0 ? '#b42318' : '#067647') },
  }], { margin: { l: 190, r: 16, t: 10, b: 40 }, height: 40 + 26 * order.length,
    xaxis: { title: 'Shapley contribution to p(theft)' } }, { responsive: true, displayModeBar: false });
}

$('severity').addEventListener('input', () => $('sev-val').textContent = parseFloat($('severity').value).toFixed(2));
$('run').addEventListener('click', run);
let lastResponse = null;
const _origRender = render;
render = function (j) { lastResponse = j; _origRender(j); };
$('dt-pick').addEventListener('change', () => { if (lastResponse) drawBalance(lastResponse); });
boot();
