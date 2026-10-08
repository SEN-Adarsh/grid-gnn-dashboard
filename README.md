# Grid-GNN Demo Dashboard

Static browser client for the Grid-GNN inspection decision-support API (FastAPI backend hosted separately).

- **No build step** — plain HTML/JS/CSS + Plotly.js from CDN; deploy to Vercel as a static site.
- **Backend URL:** set in `app.js` (`API_BASE`), or override per-load with `?api=<url>`.
- All telemetry is synthetic (`profile_source: synthetic_fallback`); probabilities are not validated for field use; flags are review requests only — a field inspector must verify every flag, and no disconnection or penalty is automated.
