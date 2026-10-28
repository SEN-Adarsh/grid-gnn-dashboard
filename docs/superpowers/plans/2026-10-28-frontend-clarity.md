# Frontend Clarity Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all public dashboard pages, model labels, results controls, and architecture diagrams with the backend's actual synthetic decision-support behavior.

**Architecture:** Keep the static HTML/JS/CSS frontend and existing API contracts. Make copy/model labels consistent through a shared frontend model-name helper, remove only the browser explanation/target-meter path, and render responsive diagrams that expose the true parallel meter/DT output paths. Keep sample-mode and service status accessible while removing the large Home status panel.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-frontend-clarity-design.md`

## Global Constraints

- User-facing frontend HTML/JS contains no Unicode em dash (`—`) and no prohibited oracle wording.
- Model IDs M0-M4 remain API keys and appear with their semantic labels wherever users see a model name.
- Backend request/response contracts and backend behavior remain unchanged.
- Sample output remains visibly labelled and must never be presented as live scoring.
- Meter reason codes remain visible; remove explanation chart, its selected-meter control, and related browser wiring only.
- Evidence page keeps supported existing benchmark, Track A, Track B, operating-point, and measured-risk values; it does not claim Track C/D are displayed.
- Governance copy must not imply field validation, legal determination, production audit capability, or a proven graph-model advantage.
- Keep public run-summary/CSV downloads free of model/config fingerprints.

---

### Task 1: Add frontend-content regression tests

**Files:**
- Create: `dashboard_content.test.cjs`
- Test: `model_comparison.test.cjs` remains unchanged unless test command aggregation is needed.

**Interfaces:**
- Tests read `index.html`, `app.js`, and `style.css` as text. They assert stable public requirements, not exact markup layout.

- [ ] **Step 1: Write failing tests**

Create tests for:

```js
test('rendered frontend source has no oracle wording or em dash', () => {
  for (const source of [html, app]) {
    assert.doesNotMatch(source, /oracle/i);
    assert.equal(source.includes('\u2014'), false);
  }
});

test('each model ID is paired with its semantic label', () => {
  for (const label of [
    'Physics residual baseline', 'Unsupervised anomaly detector',
    'History-based model', 'Context-aware model', 'Temporal graph model'
  ]) assert.ok(html.includes(label));
});

test('results explanation UI and target-meter control are removed', () => {
  assert.doesNotMatch(html, /tab-expl|pane-expl|id="meter"|data-tab="explanation"/);
  assert.doesNotMatch(app, /drawExplanation|expl-chart|Target meter set/);
});
```

Also assert the model-selection entry link, the required route list, the pipeline stage labels, and that the Evidence page keeps Track A and Track B but does not mention Track C/D.

- [ ] **Step 2: Run tests and confirm current UI fails**

Run: `node --test dashboard_content.test.cjs`  
Expected: FAIL on current oracle copy, em dash, old model names, explanation UI, and diagrams.

- [ ] **Step 3: Keep the test surface focused**

Avoid tests that snapshot entire pages or assert exact SVG coordinates. Assert text, essential IDs/routes, label mapping, and absence of removed paths.

---

### Task 2: Update Home and model identity/copy

**Files:**
- Modify: `index.html` Home and Model & scenario sections, header badge, model cards, result/compare visible model labels.
- Modify: `app.js` model display helper, health handling, status strings, summaries, compare table headings, exports, and removed Home panel lookups.
- Modify: `style.css` only if updated cards require spacing adjustments.
- Test: `dashboard_content.test.cjs`.

**Interfaces:**
- Add `MODEL_LABELS` and `modelDisplayName(id)` in `app.js`; API payloads continue using IDs such as `M0`.
- Home CTA is one anchor to `#/models`; it does not automatically run a scenario.

- [ ] **Step 1: Replace Home copy and structure**

Use the accurate promise: estimate unexplained DT energy, rank meters for human review, show reason codes/work-order details. Replace Rank/Locate/Explain cards with prioritization, DT energy balance, and review/routing information. Replace the flow strip with choose, score stored AMI/DT inputs, review meter/DT outputs, inspector verifies. Remove the backend status panel and redundant top/Home synthetic warnings, but keep the global service indicator and labelled sample banner/fallback controls.

- [ ] **Step 2: Implement semantic model labels and model notes**

Display:

```js
const MODEL_LABELS = {
  M0: 'Physics residual baseline',
  M1: 'Unsupervised anomaly detector',
  M2: 'History-based model',
  M3: 'Context-aware model',
  M4: 'Temporal graph model',
};
```

Cards include IDs and the requested short notes. Replace API-fed training note display with a neutral fixed description or remove it with the Home status panel. Apply `modelDisplayName()` to response summaries, compare statuses/columns, provenance text, and JSON run-summary display fields while preserving the `model` ID field.

- [ ] **Step 3: Remove stale Home panel JavaScript dependencies**

Remove lookups for removed `home-skeleton`, `home-error`, `home-facts`, `fact-*`, `btn-retry`, `btn-sample`, `api-link`, and `docs-link` nodes. Keep `/health` availability and scoring-window reads needed by model selection and requests. On failure, update the global connection indicator and retain the scoring-error-to-sample fallback.

- [ ] **Step 4: Remove obsolete API wake sentence and sample copy em dashes**

Remove the specified Model & scenario footer line. Keep sample mode explicit. Replace user-facing em dashes with a hyphen or normal sentence punctuation in HTML and dynamic JS messages.

- [ ] **Step 5: Run focused checks**

Run: `node --test dashboard_content.test.cjs model_comparison.test.cjs`  
Expected: Home, model labels, and copy checks pass; explanation and diagram checks remain failing until later tasks.

---

### Task 3: Remove Results explanation UI and target-meter behavior

**Files:**
- Modify: `index.html` Results tabs, target-meter control, explanation pane, and row-click guidance.
- Modify: `app.js` target-meter payload, explanation rendering/state, result routing and tab mapping, row click handlers, and model display labels.
- Test: `dashboard_content.test.cjs`.

**Interfaces:**
- Retain Results tabs: meters, transformers, energy balance, comparison.
- Keep API response processing for visible fields only; backend still returns explanation payloads but the frontend does not display them.

- [ ] **Step 1: Remove explanation DOM and target selector**

Delete the explanation tab and pane and the target-meter selector. Remove the meter-row click behavior and the hint that clicking a row selects an explanation target. Keep reason chips in the ranked meter table.

- [ ] **Step 2: Remove dependent JS behavior**

Remove `explDirty`, `drawExplanation()`, explanation availability toggles, explanation-chart refresh, target-meter values from `scorePayload`, meter-picker event listeners, and legacy `explanation` tab aliases/query values. Remove references to deleted DOM IDs.

- [ ] **Step 3: Run tests**

Run: `node --test dashboard_content.test.cjs model_comparison.test.cjs`  
Expected: no explanation tab/pane/picker or stale event wiring; comparison, meter, DT, and balance views remain available.

---

### Task 4: Replace How it works diagrams with repository logic

**Files:**
- Modify: `index.html` How it works flow and architecture markup, surrounding concise explanations.
- Modify: `style.css` responsive flow/diagram styles.
- Test: `dashboard_content.test.cjs`.

**Interfaces:**
- Use semantic HTML/CSS flow components with clear labels and accessible list/section structure; no external diagram library.

- [ ] **Step 1: Build the scoring-flow diagram**

Show stored AMI/DT readings -> causal imputation -> power-flow/technical-loss estimate and residual -> features (own history, DT/peer context, temporal sequence where used) -> selected model -> calibration/operating threshold. Branch to ranked meter output and DT unexplained balance, then converge for four-way attribution, work-order routing, and API response/internal audit. Label the four attribution fields accurately and note that routing attribution is heuristic and requires verification.

- [ ] **Step 2: Build the API architecture diagram**

Show the browser independently calling `GET /health` and `POST /score`. Show FastAPI routes `/health`, `/score`, `/ies/manifest`, `/docs`. Show the scoring engine loading stored context/models, building features, applying physics/residual logic and the selected model, returning ranks/DT attribution/work-order data/runtime, and writing score-event audit provenance.

- [ ] **Step 3: Ensure mobile and assistive readability**

Use responsive grid/flex flow with wrap/stack behavior. Keep sequence and branching clear without relying only on color. Add accessible headings and labels. Do not claim arbitrary utility integration or field deployment.

- [ ] **Step 4: Run diagram regression and syntax tests**

Run: `node --test dashboard_content.test.cjs model_comparison.test.cjs` and `node --check app.js`.  
Expected: required stages/routes are present and source parses.

---

### Task 5: Refocus Evidence and Governance

**Files:**
- Modify: `index.html` Evidence/Governance sections and navigation label.
- Modify: `app.js` route title and semantic model labels in evidence/run descriptions.
- Test: `dashboard_content.test.cjs`.

**Interfaces:**
- Keep route hash `#/about` for compatibility, but label the navigation and page title Governance.
- Evidence retains existing benchmark, Track A, Track B, operating threshold, and measured risk values with explicit source labels.

- [ ] **Step 1: Refocus Evidence on evaluation**

Separate the inherited held-out DT-disjoint benchmark from Track A inspection-supervised and Track B hidden-truth evaluation. Replace the ambiguous “Best model” label with a metric-specific label, pair IDs with semantic names, keep uncertainty and small-positive context, preserve measured risk values as rows, and remove repeated narrative cards/readiness banner. Do not add Track C/D or the Track A p-value to this page.

- [ ] **Step 2: Rewrite Governance accurately**

Explain synthetic served demo, no field-validation claim, human inspection decision support, no enforcement, intended utility-controlled raw-data boundary without implying the hosted demo is in a utility environment, API response hashes and ephemeral score-event audit logs, browser omission of hashes, and no established graph-model advantage. Remove production-readiness and unsupported regulatory filing claims.

- [ ] **Step 3: Run evidence/governance assertions**

Run: `node --test dashboard_content.test.cjs model_comparison.test.cjs`.  
Expected: only Track A/B and benchmark evidence are present on the dashboard Evidence page; governance contains the required disclosures.

---

### Task 6: Global copy and integration verification

**Files:**
- Modify any remaining frontend-rendered copy in `index.html`, `app.js`, `model_comparison.js`, and `style.css` if needed.
- Test: `dashboard_content.test.cjs`, `model_comparison.test.cjs`.

- [ ] **Step 1: Sweep prohibited strings and removed DOM references**

Run ripgrep for `oracle`, Unicode `—`, removed explanation IDs/function names, old model names, deleted Home panel IDs, and removed API wake copy across all rendered frontend HTML/JS/CSS. There must be no user-facing occurrences or dangling DOM lookups.

- [ ] **Step 2: Run complete frontend checks**

Run:

```powershell
node --test dashboard_content.test.cjs model_comparison.test.cjs
node --check app.js
node --check model_comparison.js
git diff --check
```

Expected: all tests pass, both scripts parse, diff check is clean.

- [ ] **Step 3: Review final diff**

Inspect `git diff` and verify API payload construction still contains only accepted fields; model IDs remain unchanged; public CSV/JSON remain free of fingerprints; sample fallback remains explicitly labelled.

- [ ] **Step 4: Commit and push**

Stage only intended frontend and test files. Commit with a concise `docs:` or `feat:` message reflecting the dashboard clarity update, then push `main` to trigger Vercel.
