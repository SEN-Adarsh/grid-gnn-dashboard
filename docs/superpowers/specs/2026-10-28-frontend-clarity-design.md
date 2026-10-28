# Frontend Clarity and Repository-Accurate Diagrams

**Date:** 2026-10-28  
**Status:** Design approved in conversation  
**Repository:** `grid-gnn-dashboard`

## Goal

Make the public dashboard's home, model selection, results, evidence, governance, and architecture descriptions concise and consistent with the actual scoring API and committed project evidence. Preserve API behavior and keep all claims explicit about the synthetic, decision-support-only scope.

## Project facts to preserve

- The served dashboard uses the synthetic `synthetic_india_v2` demonstration context. It does not establish field performance.
- The application ranks meters for human review and estimates unexplained energy at distribution-transformer (DT) level. It does not make offense determinations or automate enforcement.
- Public model labels retain IDs and pair them with these semantic descriptions:
  - M0: Physics residual baseline
  - M1: Unsupervised anomaly detector
  - M2: History-based model
  - M3: Context-aware model
  - M4: Temporal graph model
- The backend still returns model/config provenance (`model_sha256`, `config_hash`) and writes score-event audit records. The public dashboard currently omits these fingerprints from visible values and browser downloads; the update must preserve that policy.
- Track A uses inspection outcomes; Track B is a declared hidden-truth evaluation using synthetic labels. The current Evidence page shows these alongside the separate held-out DT-disjoint benchmark. Track C and Track D are project reports, not sections of the dashboard Evidence page.
- The graph model has not demonstrated a consistent advantage over simpler baselines. Do not add claims of graph advantage, field efficacy, or a best model outside the specific benchmark wording supported by its evidence.
- The 4-way DT loss-attribution fields and work-order routing are heuristic decision-support outputs and require field verification.

## Approved design

### Home

- Replace the current hero with a concise electricity-theft triage title and repository-accurate description: estimate DT unexplained energy, rank meters for review, and expose reason codes/work-order details for human inspection.
- Use one primary link to the Model & scenario page. Do not trigger an automatic guided scoring run from the Home CTA.
- Replace the Rank/Locate/Explain cards with accurate summaries of meter prioritization, DT energy balance, and review/routing information.
- Replace the four-step strip with a short sequence: choose method/scenario, score stored AMI and DT readings, review meter/DT outputs, inspector verifies.
- Remove the Home Backend status card, its sleep/wake copy, and its dataset/model/config/training details. Retain the compact global service indicator and explicit sample-mode banner/fallbacks so connectivity and generated sample data remain distinguishable.
- Remove the redundant Home synthetic warning strips/badges. Keep the synthetic-data and non-field-validated disclosure on Governance.

### Model selection and global labels

- Use semantic names with M0-M4 IDs in model cards, results summaries, comparison columns, provenance/run summaries, and any other displayed model label.
- Include the requested short model notes, grounded in the feature/model definitions in the backend repository.
- Replace visible training provenance text with neutral synthetic-label / benchmark wording. Do not display the prohibited term anywhere in user-facing frontend content, including API-fed training notes.
- Remove the obsolete API-root/wake-duration sentence from Model & scenario.
- Keep model IDs as API values and internal keys. Do not change request/response contracts.

### Results

- Remove the Explanation tab and its pane, target-meter control, meter-row target behavior, explanation-specific rendering/wiring, and legacy tab route handling. Retain reason codes, which are part of the meter response and remain visible in the ranked-meter table.
- Keep Ranked meters, Transformers, Energy balance, and Compare models.
- Preserve CSV and run-summary exports, with no public model/config fingerprint exposure.

### How it works

- Replace the scoring diagram with a responsive, accessible flow reflecting stored AMI/DT input, causal imputation, DT power-flow/technical-loss estimate and residual, own-history/peer-DT/temporal features, selected-model scoring, calibration/threshold, meter ranking, DT balance, 4-way attribution, work-order routing, and provenance/audit.
- The diagram must show the meter-ranking path and DT-balance path as related branches from shared scoring/physics inputs, then show their outputs feeding attribution/routing. It must not imply that the backend computes every result as a misleading strict linear chain.
- Replace the architecture diagram with the browser, separate `GET /health` and `POST /score` calls, the FastAPI route list (`/health`, `/score`, `/ies/manifest`, `/docs`), and the scoring engine responsibilities (load context/models, build features, run physics/residual, apply model, return rankings/DT attribution/routing/runtime, write audit/provenance).
- Include a concise note that results are human-reviewed and attribution is a heuristic, not established loss accounting.

### Evidence

- Keep the page focused on named evaluation evidence and metric definitions. Retain the benchmark, Track A, Track B, operating-point, and measured risk values already present, but label the different evidence sources clearly and pair model IDs with semantic names.
- Remove repeated narrative/risk cards and the readiness banner that duplicate governance or imply a deployment state. Keep measured risks as compact evidence rows where they are actual reported metrics.
- Do not add Track C/D to the dashboard Evidence page or imply that it currently shows them.
- Do not add a Track A p-value not already displayed by the page unless directly verified and explicitly in scope.

### Governance

- Rename the navigation item from About to Governance and set a matching page title.
- Describe the synthetic hosted demonstration, decision-support purpose, lack of field-validation claims, human review, and absence of automated enforcement.
- Describe the intended utility data boundary carefully: no central database is implemented; utility integrations should keep raw telemetry under utility control. Do not imply the hosted demo is already running inside a utility environment.
- State that the API attaches model/config hashes and records score events in an ephemeral service audit log. Clarify that the browser does not display/export these hashes and its JSON file is a run summary, not a regulatory filing.
- State the graph model's benchmark limitation and avoid production-readiness language.

## Copy and accessibility constraints

- No user-facing frontend copy contains the prohibited term or Unicode em dash (`—`). Replace with plain hyphens or sentence punctuation.
- Use semantic model labels consistently while retaining M0-M4 identifiers.
- SVG/HTML diagrams provide useful accessible text and remain readable at desktop and narrow viewport widths.
- Preserve sample-mode labeling, keyboard-accessible controls, and current API contracts.

## Files expected to change

- `index.html`: Home, model cards, results tabs, How it works diagrams, Evidence, Governance, navigation and labels.
- `app.js`: semantic model-label formatting, removal of Home status-panel lookups, model note handling, explanation/target-meter wiring removal, and visible dynamic copy cleanup.
- `style.css`: responsive diagram presentation and any layout adjustment required after removing a result tab or adding feature/model descriptions.
- `model_comparison.test.cjs`: regression checks for semantic labels and prohibited public copy/removed explanation UI if useful without coupling tests to large implementation strings.

## Verification

- Run `node --test model_comparison.test.cjs`, `node --check app.js`, and `node --check model_comparison.js`.
- Search all frontend-rendered HTML/JS for the prohibited term and em dash; verify no stale explanation-tab/picker IDs or event handlers remain.
- Review the rendered diagrams and model comparison labels for semantic correctness and narrow-screen readability.
- Confirm `git diff --check` and inspect all changed files before pushing.
