# CHM evidence-first implementation handoff

Repository: `tusharsingh-1801/91-CHM`
Branch: `feature/evidence-first-monitoring`
Current committed HEAD: `83d87cc` (`Separate field condition from satellite evidence quality and recency`), based on `c49b807`. Implementation changes in this handoff are still local/uncommitted.

This is a substantial but incomplete continuation of the CHM roadmap, not a claim that the whole product is complete. No changes from this continuation were pushed, merged or deployed. No MADHWAI project or database was accessed. CHM continues to use PostgreSQL/PostGIS; no Supabase integration was introduced.

## Farmer workflow

Open the overview to find fields requiring inspection, old imagery, or missing evidence. Demo/public parcels are excluded by default. Search/filter fields, open a field, read acquisition/age/coverage/source and the next action. Field creation and boundary editing use Leaflet/OpenStreetMap and do not require a Google Maps key. The onboarding wizard saves the field boundary first, then searches and processes candidates newest-first; rejected evidence remains rejected, older scenes can be attempted, and processing can be retried without creating another field. Planting and expected harvest dates are optional. GeoJSON import accepts one valid Polygon; MultiPolygon is deliberately rejected with an explanation.

On the map, select a specific scene ID and inspect that scene's acquisition and quality. The latest accepted scene ID is preferred over a date-only match; refresh retains a still-available user selection. The basemap is explicitly separate from analysed Sentinel imagery. Toggle the accepted NDVI layer and its opacity. On analysis, view measured NDVI/NDMI/NDRE time series, an acquisition timeline, a two-date comparison of actual accepted observations, and recorded field-event markers; expand the technical table if needed. Low-quality or missing evidence never becomes a healthy/unhealthy label.

## Scope by phase

| Phase | Status |
| --- | --- |
| A: correctness, provenance, recency | Implemented in this branch: quality acceptance, newest-first bounded candidate processing, idempotent/versioned writes, transaction-safe latest summaries, provenance, same-scene map evidence, timeline/comparison and consistent raster masks. Agronomic calibration and a live accepted-image result remain unproven. |
| B: dashboard/onboarding/maps/trends | Dashboard evidence queue, search/filter, exact-scene selection, key-free Polygon draw/edit/import, optional dates, actual time series, timeline and two-date comparison are implemented. App-wide persistent Hindi/English and hectare/acre preferences and a separate field overview route remain incomplete. |
| C: photo scouting/diagnosis | Photo-backed scouting capture, storage, diary review and retry flow are implemented. No licensed/configured diagnosis provider is available; diagnosis is reported unavailable, not invented. |
| D: forecasts/jobs/reports/offline | Historical NASA POWER remains labelled as modeled weather; no forecast is configured. PostgreSQL job schema/worker groundwork exists, but the current onboarding/map satellite flow still performs synchronous requests and durable restart/retry behavior is not validated. CSV/PDF reporting and offline/PWA sync remain incomplete. |
| E: shared-access protection | Account/session endpoints, server-side field ownership checks and explicit legacy claim/audit tooling are implemented. Production/shared-deployment hardening and real database-backed cross-user verification remain; do not expose this branch as production-ready. |

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

Frontend: existing dashboard, field layout/map/analysis/history, API types, account gate, Leaflet field renderer/editor and imported `index.css`. Core field maps no longer invoke Google Maps. `App.css` is not used for these changes.

Operations: additive migrations `1792060000000_evidence-provenance.ts`, `1792060100000_evidence-spatial-details.ts`, and `1792071000000_product-workflows.ts`; native launcher preflight; CI PostGIS service; sync/import/claim scripts; and `.env.example`.

## Preservation and local setup

A prior CHM-only backup was taken at `.local/backups/before-evidence-1792070315521.dump` before applying earlier evidence migrations to `127.0.0.1:5435/terrascope`; that earlier handoff recorded six original fields preserved. The product-workflows migration is additive and forward-only. Its legacy `fields.owner_id` stays nullable; no legacy records are automatically assigned to an arbitrary account. Back up before applying migrations. Default startup remains `npm run migrate`, `npm start`, `npm run status`, `npm stop`.

No Google Maps credentials are needed for field creation, editing or viewing. A configured Sarvam key is needed for live assistant answers. No photo diagnosis provider is configured. For shared use, create an account, set `AUTH_MODE=required`, configure exact HTTPS `APP_ORIGIN` values and secure cookies, then explicitly claim only intended legacy field UUIDs via `node scripts/claim-fields.mjs account@example.com <field-uuid> [...]`. Do not use local auth mode on a network-exposed service. Thresholds and candidate limits are documented in `.env.example`. The native launcher fails with migration guidance when the new schema is missing.

## Validation

Latest checks in this continuation:

- `npm run build`: passed (includes TypeScript project check).
- `npm run lint`: passed.
- `npm test`: 19 passed, 2 skipped. Skips are the PostGIS transaction test and database-backed cross-owner API test; both require an isolated integration database.
- `npm run test:ui`: 24 passed, including onboarding rejection/retry, same-date scene selection, auth/scouting UI, key-free Leaflet, and responsive layouts at 320, 390, 768, 844×390, 1024 and 1440 pixels.
- `/Users/tusharsingh18/Desktop/MP/91-CHM/.venv/bin/python -m pytest backend/engine -q`: 14 passed; dependency deprecation warnings remain. The configured local virtualenv is Python 3.9.6, while README/CI target Python 3.11.
- PostGIS integration was not run locally: do not point it at the existing `terrascope` development database. CI is configured to start disposable `postgis/postgis:16-3.4`, migrate `chm_integration`, and run `npm run test:integration`; this CI workflow was not run in this session.
- `npm run test:smoke` was not run; no live external accepted satellite observation was produced during this continuation.

Browser tests exercise real rendered controls and Leaflet with mocked API responses and tile images. They establish fixture-backed behavior, not live imagery/provider correctness or agronomic validity. See the test output directories for generated screenshots and traces; they are not committed.

Most recent recorded live-provider check (from the earlier handoff, 15 October 2026): Earth Search responded for a public demo parcel. A 12 October 2026 scene's STAC red/NIR assets reported scale .0001 and offset -.1. A separate latest scene `S2A_43REM_20261015_1_L2A` was opened from real COGs and rejected with HTTP 422 after masking left no usable pixels. No live observation was saved. This continuation did not repeat the external check; do not claim an accepted live vegetation measurement. Live Sarvam was not exercised; NASA POWER remains fixture-tested rather than freshly fetched.

## References consulted

Product direction: [OneSoil field monitoring](https://onesoil.ai/en/platform) and [Plantix Crop Health API](https://www.plantix.net/en/plantix-intelligence/api-toolkit/). Their workflows inform prioritization and future photo cases; no scraping, branding reuse or simulated diagnosis was added.

Implementation contracts: [Earth Search examples](https://element84.com/earth-search/examples/), [Rasterio dataset scale/mask metadata](https://rasterio.readthedocs.io/en/stable/api/rasterio.io.html), [Rasterio reprojection](https://rasterio.readthedocs.io/en/stable/topics/reproject.html), and [Rasterio masking](https://rasterio.readthedocs.io/en/stable/api/rasterio.mask.html).

Local preview: `http://localhost:5173`. Shared/public release is not authorized or ready. Next priorities are persistent app-wide language/unit preferences, a dedicated field overview, reports and offline support, wiring satellite work to durable jobs, and isolated database-backed ownership/worker recovery validation.
