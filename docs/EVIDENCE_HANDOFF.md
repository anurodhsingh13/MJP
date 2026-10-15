# TerraScope evidence-first slice

Branch: `feature/evidence-first-monitoring`, based on `c49b80725eb57c6d832de0308bb643ea6d35d236`.

This is the first local vertical slice requested in the implementation brief. It is not completion of the whole multi-phase roadmap. No code was pushed, merged or deployed. No MADHWAI service or database was accessed. Native CHM PostgreSQL/PostGIS remains the database; no Supabase integration was introduced.

## Farmer workflow

Open the overview to find fields requiring inspection, old imagery, or missing evidence. Demo/public parcels are excluded by default. Search/filter fields, open a field, read acquisition/age/coverage/source and the next action. On the map, select an acquisition date and inspect that date's quality and processing status. The basemap is explicitly separate from analysed Sentinel imagery. Toggle the accepted NDVI layer and its opacity. On analysis, view measured NDVI/NDMI/NDRE time series and recorded field-event markers; expand the technical table if needed. Low-quality or missing evidence never becomes a healthy/unhealthy label.

## Scope by phase

| Phase | Status |
| --- | --- |
| A: correctness, provenance, recency | First slice implemented: coverage-independent score, quality acceptance, newest-first bounded candidate processing, idempotent versioned writes, transaction-safe latest summaries, provenance, elapsed-date trends, consistent raster masks. Agronomic calibration and broader live-scene evaluation remain. |
| B: dashboard/onboarding/maps/trends | Dashboard evidence queue, search/filter, field evidence summary, selected-date quality, layer opacity and actual time series implemented. No-Google onboarding/editing, full translation/units, compact four-tab navigation, two-date comparison and timeline remain. |
| C: photo scouting/diagnosis | Pending. No diagnosis provider/model is configured or represented as functional. |
| D: forecasts/jobs/reports/offline | Pending. Current processing is bounded synchronous work with persisted scene status, not a durable job queue. Assistant context now includes dated accepted imagery, historical weather and diary events. |
| E: shared-access protection | Pending. Local-only operation; no public release. |

## Data and scientific behavior

- `shared/evidence.ts` defines provenance, quality checks, states and experimental scoring. API-configured heuristics are returned with each field assessment.
- Measurements with identical NDVI .7 and NDMI .3 have experimental score 81 at both 100% and 20% coverage. At 20% coverage the image is rejected for condition assessment, rather than calling the crop unhealthy.
- Defaults: >=70% usable field coverage, >=10 usable pixels, <=14 days old, decline flag at a decrease >=.10 NDVI between distinct comparable dates. These are **unvalidated product heuristics**.
- One accepted date supports a measurement, not a change assessment. Unverified records, future dates, missing coverage/pixel counts and stale evidence cannot imply healthy crops. Zero-valued measurements are preserved.
- Comparisons require the same boundary revision and calculation version, accepted quality and different acquisition dates. Completion order is irrelevant. Transactions lock only the field while writing, after external raster work.
- Observations are unique per field/scene/date/boundary revision; decline notices have unique evidence keys. Reprocessing does not multiply rows or notices. Spatial low-NDVI areas are inspection areas; they are not automatically labelled high-severity crop damage.
- Boundary changes archive geometry, clear summary pointers and processing state, and leave previous observations with their original revision. Tiles are not publicly cached across boundary changes. Historical geometry/statistics remain in PostgreSQL.
- Legacy observations remain unverified. Original example fields matching known seed name/crop/area are labelled demo conservatively; public benchmark parcels have explicit public-boundary provenance. Current crop, dates and yield are user-reported, not established by a parcel outline. Historical scores are not destructively rewritten by migration.
- The undated Sentinel Hub mosaic write path now returns a clear error instead of storing the current date as an acquisition. Earth Search remains the dated processing path.
- Raster processing explicitly aligns bands/CRS, uses bilinear reflectance and nearest categorical masks, honors nodata and source masks, applies scale/offset metadata, accepts valid zero reflectance, guards zero denominators, and measures coverage over the full field even outside the scene footprint. Integer bands lacking trustworthy scaling are rejected. The engine limits interactive grids to four million pixels.
- Legacy overlay output is now north-up WGS84 instead of stretching a projected array into geographic corners. Overlay, tiles and statistics use the same NDVI/mask functions; pixel grids differ by output resolution/projection.
- Trends deduplicate dates, use elapsed days, expose NDVI/day and date range, and qualify two-image comparisons. Generic crop-stage and next-NDVI forecasts/R-squared were removed. NDMI is not soil-moisture percentage, NDRE is not an automatic fertilizer prescription, and NDVI does not identify disease.

## Owning files

Backend: `backend/api/services/satellite.ts`, `policy.ts`, `controllers/fieldsController.ts`, `controllers/assistantController.ts`, routes, and `backend/engine/main.py`.

Frontend: existing dashboard, field layout/map/analysis, API types, Google/Leaflet map renderers and imported `index.css`. `App.css` is not used for these changes.

Operations: additive migrations `1792060000000_evidence-provenance.ts` and `1792060100000_evidence-spatial-details.ts`, native launcher preflight, sync/import scripts and `.env.example`.

## Preservation and local setup

A CHM-only backup was taken at `.local/backups/before-evidence-1792070315521.dump` before applying migrations to `127.0.0.1:5435/terrascope`. The six original fields remained. Temporary integration fixtures are removed in cleanup. Existing applied migrations were not edited. The new migrations are forward-only to avoid discarding provenance/history on downgrade. Default startup remains `npm run migrate`, `npm start`, `npm run status`, `npm stop`.

No new credentials are needed for this slice. Existing Sarvam credentials are needed only for live assistant answers; Maps is optional for viewing. Google-only boundary onboarding remains a known next-phase limitation. Thresholds and candidate limits are documented in `.env.example`. The native launcher fails with migration guidance when the new schema is missing.

## Validation

Baseline: build, lint and 14 API tests passed. Existing Python suite contained eight tests.

Current validation results and screenshot paths are recorded at handoff completion below. Browser/API fixtures test behavior; they do not validate agricultural thresholds or external AI answers. The real PostgreSQL integration uses actual PostGIS/transactions with fixture raster-engine responses. Known-raster Python tests use synthetic, numerically specified fixtures rather than live satellite truth.

Live provider check on 15 October 2026: Earth Search responded for the public demo parcel. A 12 October 2026 scene's STAC red/NIR assets explicitly reported scale .0001 and offset -.1. A separate latest public-parcel scene `S2A_43REM_20261015_1_L2A` was opened from the real COGs and rejected with HTTP 422 after cloud/nodata masking left no usable pixels. No live observation was saved and no claim of live accepted vegetation measurements is made. Live Sarvam was not exercised. NASA POWER was preserved and fixture-tested, not re-fetched in this slice.

## References consulted

Product direction: [OneSoil field monitoring](https://onesoil.ai/en/platform) and [Plantix Crop Health API](https://www.plantix.net/en/plantix-intelligence/api-toolkit/). Their workflows inform prioritization and future photo cases; no scraping, branding reuse or simulated diagnosis was added.

Implementation contracts: [Earth Search examples](https://element84.com/earth-search/examples/), [Rasterio dataset scale/mask metadata](https://rasterio.readthedocs.io/en/stable/api/rasterio.io.html), [Rasterio reprojection](https://rasterio.readthedocs.io/en/stable/topics/reproject.html), and [Rasterio masking](https://rasterio.readthedocs.io/en/stable/api/rasterio.mask.html).

## Completed checks

- `npm run build`: passed.
- `npm run lint`: passed without warnings.
- `npm test`: 18 passed; the database integration test is intentionally skipped in the default run.
- Opt-in CHM/PostGIS integration: passed (actual transactions/PostGIS; raster responses are fixtures).
- `.venv/bin/python -m pytest backend/engine -q`: 14 passed. Dependency deprecation warnings remain.
- `npx playwright test`: 20 passed, including evidence workflows at 320/390/768/1440 pixels and portrait/landscape layout regressions.
- `npm run test:smoke`: passed against the restarted native stack; original field count retained.
- Live STAC metadata/read check: reachable, latest tested scene rejected for no usable pixels; no live accepted measurement claimed.

Screenshots (fixture-based, not real field diagnosis) are in `test-results/evidence-farmer-evidence-workflow-and-screenshot-at-<width>px/overview-<width>.png` and `trends-<width>.png` for widths 320, 390, 768 and 1440. Rendered screenshots at all four required widths were visually inspected; the four evidence workflows passed again after the final chart/measurement display adjustments. Persistent local copies are in `.local/evidence-screenshots/`. Traces/screenshots are ignored local artifacts and can be regenerated with the browser suite.

Local preview: `http://localhost:5173`. Shared/public release is not authorized or ready. The next implementation slice should finish no-Google boundary onboarding/editing, optional planting, and persistent interface language before photo scouting.
