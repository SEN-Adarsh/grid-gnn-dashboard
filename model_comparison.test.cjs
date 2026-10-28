const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompareRequests, buildTopTenAgreement } = require('./model_comparison.js');

function response(model, topMeters) {
  return {
    model,
    meters: [...topMeters, `${model}-other`].map((meter_id, i) => ({
      meter_id,
      dt_id: 0,
      rank: i + 1,
    })),
  };
}

test('buildTopTenAgreement reports independent top-ten appearances, not a blended score', () => {
  const responses = [
    response('M0', ['METER-A', 'METER-B']),
    response('M1', ['METER-A', 'METER-C']),
    response('M2', ['METER-A', 'METER-D']),
    response('M3', ['METER-A', 'METER-E']),
    response('M4', ['METER-A', 'METER-F']),
  ];

  const rows = buildTopTenAgreement(responses, 2);

  assert.equal(rows[0].meter_id, 'METER-A');
  assert.deepEqual(rows[0].top10_models, ['M0', 'M1', 'M2', 'M3', 'M4']);
  assert.equal(rows[0].top10_count, 5);
  assert.equal(rows.find(row => row.meter_id === 'METER-B').top10_count, 1);
  assert.equal('score' in rows[0], false);
  assert.equal('combined_probability' in rows[0], false);
});

test('buildCompareRequests preserves one input payload and varies only the model', () => {
  const input = {
    model: 'M3',
    scenario: 'theft',
    severity: 0.9,
    readings: [{ meter_id: 'METER-A', kwh: 1.2 }],
  };
  const models = ['M0', 'M1', 'M2', 'M3', 'M4'];

  const requests = buildCompareRequests(input, models);

  assert.deepEqual(requests.map(request => request.model), models);
  for (const request of requests) {
    assert.deepEqual({ ...request, model: input.model }, input);
  }
  assert.equal(input.model, 'M3');
});
