# CHM submission and demonstration brief

Prepared: 16 October 2026. Student's requested demonstration/submission target: 17 October 2026. This is a verified implementation brief, not a claim of faculty approval, guaranteed marks, a validated agricultural model or completion of every roadmap feature.

## What to demonstrate

TerraScope converts field boundaries and dated satellite measurements into an understandable next step: visit a field, find a clear picture, review a due visit or record a photo. It includes field management, ownership, durable image checks, greenness trends, diary/scouting records and reports.

The simplified interface starts with an action rather than a technical score. Field cards hide optional picture percentages/dates until requested; the field overview explains the next action and why. The Help page has a four-step bilingual guide. Missing imagery does not produce a reassuring crop-health message. Sample-only accounts can add a real field or explicitly open a sample instead of getting a filter dead end.

## Rubric alignment

Source: the student's uploaded *Major Project Evaluation Rubrics - B.Tech. Pre-final Year 2026-27*.

| Assessment | Marks | Evidence / remaining personal input |
|---|---:|---|
| Phase I initiation | 10 | Student reports completed; faculty marks/sign-off unverified. |
| Phase II planning and design | 10 | [Planning/design](PHASE_II_PLANNING_DESIGN.md), [data model and traceability](DESIGN_AND_TRACEABILITY.md). Add actual guide feedback and approved schedule. |
| Mid-term | 20 | Existing prototype and test evidence; faculty evaluation and earlier presentation outcome must be supplied by the student. |
| Phase III implementation | 20 | Current implementation, test table below, controlled raster tests, integration CI and measured browser rendering. |
| Exhibition | 10 | Working prototype; prepare poster and rehearse expert interaction. Rubric dates: 26-31 October. |
| Final report | 10 | Use this brief and design/test documents as source material. Add confirmed team/guide details, literature references and institution formatting. |
| Final presentation/demo/viva | 15 | Demonstration sequence and viva answers below. |
| Paper/patent/IPR as applicable | 5 | No submission or publication is claimed. Attach only genuine evidence. |

The rubric lists Phase III through 24 October and final evaluation in early-mid November. Follow the faculty's actual earlier submission instruction; the student's 17 October target is treated as the immediate deadline.

## Verification of this UI revision

| Check | Actual result / boundary of evidence |
|---|---|
| Production build / TypeScript | Passed locally after final UI edits. |
| Lint | Passed locally. |
| Ordinary API/unit tests | 20 passed; 3 database tests intentionally skipped by this command. |
| Browser workflows | 34 passed, including existing workflows and 5 new plain-language regressions. |
| Layout coverage | 320, 390, 768 and 1440 px plus portrait/landscape regression widths; Hindi glyphs and acre preferences checked. |
| PostgreSQL/PostGIS integration | Dedicated CI job applies migrations and runs the isolated integration database. Consult the Actions result for the submitted commit; a local database was not available in this review environment. |
| Python engine | Unchanged by this UI revision; the submitted commit's CI runs the 14-test engine suite. Do not replace this evidence with browser mocks. |
| Live acceptance / local full-stack smoke | Not performed in this review environment. Must be checked on the student's configured local stack before the demo. |

Browser tests use controlled API responses and fixture map tiles. They verify UI behavior, real Leaflet interactions, navigation, saving/retry requests and exports, not live provider access or crop diagnosis. Screenshots remain generated local test artifacts, not ground-truth farm evidence.

### Controlled performance measurement

Metric: browser navigation until all 20 fixture field cards render, followed by two animation frames. Ten navigations at 1440x900 in Linux x64, Node 24.19.0, Chromium 153.0.8010.0, Vite development server; AMD EPYC 9V74. API responses were mocked and external fonts blocked.

Median: **942 ms**. Nearest-rank p95: **1042 ms** (10 samples). Raw samples and environment: [browser-performance-2026-10-16.json](evidence/browser-performance-2026-10-16.json).

This is a controlled frontend rendering result, not live API latency, satellite processing speed or a production performance guarantee. Backend p50/p95 and successful live scene duration remain to be measured on the actual demo machine.

## Pull, start and rehearse on the demo machine

Keep the existing CHM .env, account and database. Do not overwrite .env or reset the database.

```bash
npm stop
git pull --ff-only origin main
# Back up your local CHM database with your existing PostgreSQL tools.
# Apply any earlier unapplied additive migrations; this UI revision adds none.
npm run migrate
npm start
npm run status
```

Open the frontend URL printed by status, normally http://localhost:5173. Confirm the database, API and Python health checks. Sign in with the existing account. Empty fields after a new sign-in can mean legacy fields have no owner; use only the explicit, UUID-scoped claim process in README, not an authentication bypass.

`npm run migrate` starts the configured project-managed PostgreSQL cluster before applying migrations. If PostgreSQL is managed externally, start it with its normal tool first. Chain update commands with `&&` so a failure stops later commands.

Run `npm run test:smoke` against the configured local services before the presentation. It creates and removes its own temporary field. Do not point fixture/integration tests at the normal farm database; those use the isolated chm_integration database.

## Six-minute demonstration

| Time | Show | Explain |
|---|---|---|
| 0:00-0:40 | Dashboard in Hindi or English | A field manager sees an action first, rather than needing to understand NDVI. |
| 0:40-1:30 | Add field, mark corners, omit planting date | The boundary is saved independently of satellite availability. |
| 1:30-2:20 | Field overview and image-check state | Jobs continue while the API worker runs. Clouds or missing pictures mean unknown, not crop damage. |
| 2:20-3:10 | Map and dated greenness trend | Exact scene/date and boundary determine the overlay. A falling greenness signal suggests an inspection, not a disease diagnosis. |
| 3:10-4:10 | Plan a visit and add a photo/note | A retry preserves entries and avoids duplicate records. Photos are observations, not automatic diagnosis. |
| 4:10-5:00 | Report, date range, print/save PDF or CSV | Reports retain provenance and distinguish the latest summary from date-filtered readings. |
| 5:00-6:00 | Architecture, test evidence, limitations | Explain separation of UI/API/raster engine/spatial storage and show the submission commit's CI. |

Use a previously saved, correctly attributed observation when a live image search takes too long. If only a controlled fixture is available, label it clearly as a fixture; do not present it as a live successful measurement. Do not depend on an external AI response for the central demonstration.

## Remaining gaps and how to close them

| Priority | Gap | Concrete closure / evidence |
|---|---|---|
| Before demo | Student-machine end-to-end evidence | Start all services, add a genuine field boundary, run image/weather jobs, record scene/date/quality, save a report, run local smoke. If no clear image exists, document that rejection. |
| Before demo | Live successful satellite acceptance | Obtain an eligible clear scene through the existing pipeline. Save its actual scene ID, boundary revision, acquisition, accepted coverage and exported reading. Never relax masks just to obtain a green status. |
| Before demo | Guide review and final report metadata | Attach actual guide feedback, confirmed team/roll numbers, approved design and dated evidence. No invented signatures or marks. |
| Before demo | Non-technical user validation | Ask 2-3 people to find a field needing a visit, explain a missing-picture state, plan a visit and open a report. Record completion, time and misunderstandings. Current automation is not a human usability study. |
| Later integration | Automatic photo diagnosis | Select a licensed model/provider, document supported crops, validate on held-out field photos and add uncertain/unsupported results. Until then keep the current unavailable label. |
| Later integration | Weather forecast | Add a separate forecast provider/adapter with issue time, location and expiry. NASA POWER remains historical weather. |
| Later integration | Offline use / phone notifications | Add a service worker, safe draft queue/idempotency and a notification service with explicit opt-in. These are not currently implemented. |
| Research / release | Agronomic validation and shared deployment hardening | Collect labeled field truth, calibrate by crop/season, measure errors and backend performance; review session controls, backups and operational security before a public release. |

## Viva answers to rehearse

1. **What does NDVI measure?** Relative vegetation reflectance: `(NIR - red) / (NIR + red)`, excluding invalid pixels/zero denominator. It is not a disease probability.
2. **Why separate image coverage from crop condition?** Clouds and image edges affect usable evidence, not the plant's biological condition. Low coverage therefore rejects or qualifies evidence instead of lowering a health score.
3. **Why PostGIS?** Field polygons, spatial validation, area and geometry queries belong in spatial storage; boundary revisions keep observations tied to the correct outline.
4. **How is the newest result preserved?** Accepted acquisition dates determine the latest summary inside a transaction. Completion order does not decide which image is newest.
5. **What happens if processing fails?** The saved field and last accepted measurement remain; job state/error is persisted and a bounded retry is available.
6. **What is novel in the prototype?** The integration of field-level evidence quality, dated change, boundary versioning and bilingual next actions. No novel diagnosis algorithm or established agronomic accuracy is claimed.
7. **What does green mean on the map?** More vegetation signal in that acquisition. It does not certify a disease-free or well-watered crop.
8. **What tests are real?** Unit/controller checks, actual browser UI and isolated PostGIS transactions are separate from live provider and field-truth validation. State which evidence is being shown.

## Pack before leaving

- Laptop, charger and an available network/hotspot.
- Working local stack, existing account, one saved field and a report exported in advance.
- Phase II design, data model, WBS and actual guide feedback.
- Phase III test results/Actions link, controlled raster result and performance JSON.
- Presentation/poster/final report in the faculty's required format; team/guide details verified.
- Exact submitted Git SHA and an honest known-limitations slide.
