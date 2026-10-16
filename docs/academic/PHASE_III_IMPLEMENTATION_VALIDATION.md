# Phase III — Implementation, Testing and Validation (20 marks)
**Project:** TerraScope Crop Health Monitor  
**Rubric period:** 21 September–24 October 2026  
**Status:** Evidence template and audit prepared; live tests must be rerun before submission.

## 1. Implementation inventory (repository-described)
| Component | Technology / behavior | Evidence needed |
|---|---|---|
| Web interface | React, TypeScript, Vite, Leaflet/OSM | Screenshots and browser tests |
| API | Node.js, Express | Endpoint and error-response tests |
| Raster engine | Python, FastAPI, rasterio, NumPy | Unit tests and controlled raster fixture |
| Spatial persistence | PostgreSQL + PostGIS | Migration and integration-test logs |
| Imagery | Sentinel-2 STAC; optional Sentinel Hub | Dated scene ID, cloud cover, source |
| Weather | NASA POWER | Timestamp, missing-data handling |
| Field assistant | Optional Sarvam | Key-configured live test or mark unavailable |

## 2. How to run and validate
Follow README setup; configure local PostgreSQL/PostGIS and Python venv, then:
```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/engine/requirements.txt
cp .env.example .env
# Configure DATABASE_URL and create an empty local database
npm run migrate
npm start
npm run status
npm run build
npm run lint
npm test
npm run test:ui
.venv/bin/python -m pytest backend/engine -q
```
Run `npm run test:smoke` only with local services running. Integration tests require the separate `chm_integration` PostGIS database as described in README. Do not point destructive fixture tests at the main `terrascope` database.

## 3. Test-case register
| ID | Scenario | Expected result | Actual result | Status |
|---|---|---|---|---|
| T01 | Launch app/services | Health endpoints ready | Not run in this review | Pending |
| T02 | Create field with valid polygon | Field persists and displays | Not run | Pending |
| T03 | Reject malformed polygon | Clear validation error | Not run | Pending |
| T04 | Edit field with omitted date/yield | Existing values retained | Not run | Pending |
| T05 | Clear optional value with explicit null | Value cleared | Not run | Pending |
| T06 | Invalid UUID in API | HTTP 400 | Not run | Pending |
| T07 | Satellite scene discovery | Source/date/cloud metadata visible | Not run | Pending |
| T08 | Controlled NDVI raster | Computed value matches reference | Not run | Pending |
| T09 | Missing weather values | Missing sentinel excluded | Not run | Pending |
| T10 | Mobile dashboard | Usable layout and controls | Not run | Pending |
| T11 | Unauthorized field access | Request denied | Not run | Pending |
| T12 | External provider outage | Useful failure and recovery | Not run | Pending |

## 4. Prior review evidence (historical, NOT rerun)
The repository's `PROJECT_REVIEW.md` records a previous local verification of build, lint, 9 Node tests, 7 browser workflows, 6 Python tests and a smoke test. These are **historical reported results**, not current independent validation. The same review flags deeper database integration, input validation, atomic processing, date-aware trends, external resilience, access control and provenance as areas requiring attention. The README describes newer authentication, worker and integration-test capabilities; verify their current state rather than copying outdated gap statements.

## 5. Performance measurement protocol
Use a consistent machine, dataset and test configuration. Record median/p95 API latency for field listing, boundary creation and analysis requests; startup time; imagery-processing duration; browser loading; error rate; raster size and scene dates. Capture raw logs and number of repetitions. **No performance numbers are asserted until measured.**

| Metric | Environment / dataset | Observed value | Evidence |
|---|---|---|---|
| API field list p50/p95 | To be recorded | Pending | logs |
| Satellite processing duration | To be recorded | Pending | job log |
| Browser load | To be recorded | Pending | browser trace |
| Test pass rate | To be recorded | Pending | test report |

## 6. Data validity and limitations
NDVI is computed from near-infrared and red reflectance as `(NIR - Red) / (NIR + Red)` where denominator is nonzero. Values require masking and sensor/source context. Do not equate a low index with a confirmed disease. Distinguish observed, simulated, seeded and forecast data. Record field polygon, acquisition date, scene ID and cloud/mask handling for every demonstration.

## 7. Milestone completion evidence
- [ ] Full build and lint pass on submission commit
- [ ] Unit, browser, Python and integration tests recorded
- [ ] Smoke test with local services
- [ ] At least one controlled raster/NDVI result
- [ ] Screenshots of real user workflows
- [ ] Performance logs with dataset/hardware context
- [ ] Known limitations and unresolved bugs
- [ ] Guide review and dated demonstration
- [ ] Git commit SHA and demo instructions

## 8. Submission and viva
Demonstrate: login/field selection → polygon → scene/weather information → health interpretation → limitations. Prepare to explain NDVI formula, cloud masks, PostGIS spatial storage, service architecture, testing, provenance and why satellite observations are not ground-truth diagnoses.

**Source:** Major Project Evaluation Rubrics — B.Tech. Pre-final Year 2026–27, Phase III (20 marks).
