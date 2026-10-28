/* Pure rank-only helpers shared by the comparison UI and its Node tests. */
(function (root) {
  function buildCompareRequests(baseRequest, models) {
    const { model: _selectedModel, ...sharedInput } = baseRequest;
    return models.map(model => ({ ...sharedInput, model }));
  }

  function buildTopTenAgreement(responses, limit = 10) {
    const byMeter = new Map();
    for (const response of responses) {
      const model = response.model;
      const top = [...response.meters]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit);
      for (const meter of top) {
        let row = byMeter.get(meter.meter_id);
        if (!row) {
          row = { meter_id: meter.meter_id, dt_id: meter.dt_id, ranks: {}, top10_models: [] };
          byMeter.set(meter.meter_id, row);
        }
        row.ranks[model] = meter.rank;
        row.top10_models.push(model);
      }
    }
    return [...byMeter.values()]
      .map(row => ({ ...row, top10_count: row.top10_models.length }))
      .sort((a, b) => b.top10_count - a.top10_count || a.meter_id.localeCompare(b.meter_id));
  }

  const api = { buildCompareRequests, buildTopTenAgreement };
  root.GridGNNCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
