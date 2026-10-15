# TerraScope Crop Health Monitor

Crop health dashboard using Sentinel-2 imagery, a Node API, a Python raster engine and PostgreSQL/PostGIS.

## Start / stop locally

```bash
npm start          # starts database (when managed), Python, API and frontend in background
npm run status     # URLs and health checks
npm stop           # stops this project's managed processes
```

On macOS, double-click `Start.command` to start and open the browser, and `Stop.command` to stop.

Open **http://localhost:5173**. API health: `http://localhost:3001/api/health`; Python health: `http://localhost:8000/health`. Closing the browser does not stop the services; use `npm stop`. Logs are in `.local/server.log`.

For development with logs in the terminal:

```bash
npm run dev        # frontend + API + Python; Ctrl+C stops all three
```

`npm run dev` requires the database to already be running. `npm start` checks the database/schema, Python imports and free ports before launching. A failed service stops the other app services. It never kills an unrelated process occupying a port.

## Fresh installation

Use Node.js 24, Python 3.11 and a **native PostgreSQL with PostGIS** installation. Docker is not required. On macOS, [Postgres.app](https://postgresapp.com/downloads.html) includes PostGIS; a plain PostgreSQL installation may need PostGIS installed separately.

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/engine/requirements.txt
cp .env.example .env
```

Configure `DATABASE_URL` for your local database. Create an empty `terrascope` database with your PostgreSQL tools, then run:

```bash
npm run migrate
npm start
```

Migrations install the schema and enable the required extensions; the database user must have permission to create them. Do not rerun seed SQL manually over existing data.

## Configuration

The frontend and backend both load the root `.env`. Restart after changing it. Only variables prefixed `VITE_` are exposed to the browser; never put server secrets under that prefix.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Native PostgreSQL connection URL | localhost:5432/terrascope |
| `WEB_PORT` | Browser port | 5173 |
| `API_PORT` | API port; Vite proxy follows this | 3001 |
| `PYTHON_BIN` | Python executable | .venv/bin/python |
| `PYTHON_ENGINE_URL` | Local Python engine URL/port | http://127.0.0.1:8000 |
| `LOCAL_PG_BIN` | Optional native PostgreSQL bin directory managed by start/stop | unset |
| `LOCAL_PG_DATA` | Data directory for that managed database | .local/postgres-data |
| `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID` | Legacy optional Google map settings; current core maps use Leaflet/OpenStreetMap and do not require these values | unset |
| `SARVAM_API_KEY`, `SARVAM_MODEL` | Field assistant | unset / sarvam-105b |
| `SENTINEL_HUB_CLIENT_ID`, `SENTINEL_HUB_CLIENT_SECRET` | Optional Sentinel Hub processing endpoint | unset |
| `AUTH_MODE` | `required` enables accounts; `local` disables ownership checks for isolated development only | required |
| `APP_ORIGIN` | Comma-separated browser origins allowed for write requests | http://localhost:5173 |
| `AUTH_SECURE_COOKIE` | Set to `1` when serving the app over HTTPS | 0 |
| `PHOTO_STORAGE_DIR` | Private server-side storage for scouting photos | .local/scouting-photos |
| `JOB_CONCURRENCY` | Concurrent PostgreSQL-backed worker jobs (clamped to 1–4) | 2 |

This machine is configured with a project-managed native database on port **5435** under `.local/`; the existing system PostgreSQL stays on its own port.

When `LOCAL_PG_BIN` is set, its data directory must already be initialized. The launcher starts/stops only that configured cluster, leaving any system PostgreSQL installation alone. Otherwise PostgreSQL runs independently and `npm stop` stops the three app services only.

Field drawing, boundary editing and satellite-map viewing use Leaflet with OpenStreetMap; no Google Maps key is required. The basemap is not the selected Sentinel acquisition. Sarvam needs its own server key. Public STAC scene ingestion and NASA POWER weather do not require Google credentials. Placeholder credentials will not enable these services. In shared deployments, keep `AUTH_MODE=required`, set `APP_ORIGIN` to the exact HTTPS frontend origin(s), and set `AUTH_SECURE_COOKIE=1`. Do not use `AUTH_MODE=local` on a shared or network-exposed service.

Accounts are created in the app. Migrations preserve legacy fields with `owner_id = NULL`; they are never assigned to the first account automatically. For an explicit local claim, sign in/create the intended account, identify the exact legacy field UUIDs with your database administrator, then run `node scripts/claim-fields.mjs account@example.com <field-uuid> [...]`. The script only operates on a loopback TerraScope database, claims only listed unowned fields, and writes an audit record. Back up the database before migrations or claims.

## Checks and remaining work

```bash
npm run build
npm test
npm run lint
npm run test:ui     # browser workflows; launches its own frontend on port 5174
npm run test:smoke  # requires running local services; creates and deletes one temporary field
.venv/bin/python -m pytest backend/engine -q
```

CI starts a disposable PostGIS service, applies all migrations, and runs the database-backed integration test against the dedicated `chm_integration` database. Ordinary `npm test` intentionally skips that test. To run it locally, create a separate empty `chm_integration` database with PostGIS, set `DATABASE_URL` to that database on loopback (`127.0.0.1` port `5432` or `5435`), run `npm run migrate`, then `npm run test:integration`. The test refuses the normal `terrascope` database and non-loopback hosts; it deletes only its own fixture field.

See [PROJECT_REVIEW.md](PROJECT_REVIEW.md) for the findings and recommended implementation order. Browser tests verify rendered Leaflet workflows with fixture tiles and mocked APIs; they do not prove live external credentials, live satellite acceptance, or agronomic validity.

The original database backup is `.local-database-backup.dump` and is ignored by Git. Keep it until the native database copy is verified.

Browser tests use Chrome on macOS and Playwright Chromium on Linux (`npx playwright install --with-deps chromium`). API responses and OpenStreetMap tiles are fixture-backed; the actual Leaflet map, drawing controls, navigation, forms and HTTP requests run in the browser. These tests do not verify live provider access or a real satellite observation.

## Sync project data

With native services running, run `npm run sync:data` to import 30 available days of NASA POWER weather and search the last 90 days of Sentinel-2 observations for saved field locations. NASA meteorological availability typically trails by 2–3 days; missing-value sentinels are excluded from measurements. Set `SYNC_WEATHER_DAYS` to choose 1–365 days. This sends saved coordinates to NASA POWER and Earth Search.

Fields with no coordinates are skipped. Field-level indices require an actual polygon boundary; a point lookup only supplies scene metadata. Successful observations update vegetation indices and field health, and may generate stress alerts. The local sync report is `.local/data-sync-report.json`. Planting/harvest dates, yield and management events must come from the field manager.

## Public demo and dataset catalog

Open **Explore datasets** on the dashboard for nine relevant public sources and their actual integration status. See [datasets/README.md](datasets/README.md) for reproducible public-boundary demo import, attribution, and the mapping from datasets to app fields. Public demo parcels are clearly labelled; unknown crop identity, farm dates and yield remain unknown.

## Phones, tablets, and other computers

The web interface adapts to phones, tablets, laptops, and desktops, including portrait and landscape screens. Tables scroll within their panel on narrow screens; field navigation, forms, and map controls support touch.

To use the running app from another device on the same trusted Wi-Fi, set `WEB_HOST=0.0.0.0` in `.env`, restart with `npm run stop` then `npm start`, and open `http://<computer-LAN-IP>:5173` on that device (or your configured `WEB_PORT`). Allow the web port through the computer's firewall if needed. Keep the API and Python engine local: the frontend proxies `/api` to them, so devices share the same data. Automatic geolocation requires HTTPS on remote devices; otherwise pan and zoom the OpenStreetMap view to draw a boundary manually. For access outside your Wi-Fi, deploy the services behind HTTPS.

## Evidence-first monitoring (feature branch)

The overview prioritizes field visits, old images and missing evidence. Universal farm-average health has been removed. Field-level coverage, valid pixels, acquisition date, source, freshness and descriptive change are separate. Demo/public parcels are hidden from real-farm summaries by default. Legacy scores are preserved in PostgreSQL but are not verified imagery.

Run `npm run migrate` before starting this version. The two new forward-only migrations preserve existing rows, archive boundary revisions, and attach provenance and quality to observations. Take a database backup before migration. Existing unverified observations must be reprocessed to qualify; they are not silently promoted to measured evidence.

`EVIDENCE_MIN_COVERAGE=70`, `EVIDENCE_MIN_PIXELS=10`, `EVIDENCE_FRESH_DAYS=14`, and `EVIDENCE_DECLINE_THRESHOLD=0.10` are initial product heuristics, not validated agricultural thresholds. Restart after changing them. Scene discovery searches `SATELLITE_SEARCH_DAYS=90` days, retrieves up to `SATELLITE_CANDIDATE_LIMIT=100` recent candidates and processes at most `SATELLITE_MAX_ATTEMPTS=6` sequentially. Missing required bands, insufficient field coverage and unusable pixels cause a candidate to be rejected. No accepted candidate leaves the previous evidence in place. `POST /api/fields/:id/ndvi/process-latest` processes discovered candidates; discover first via the existing ingestion endpoint. The app also includes PostgreSQL-backed job records, bounded retries and worker lease recovery; this queue still needs full restart/concurrency validation before shared production use.

Experimental vegetation scores remain under advanced details, independent of image quality. A decrease is a reason to inspect, not disease detection. Trends use elapsed dates, not observation sequence numbers. There is no crop-stage or next-NDVI forecast. Historical weather is modeled NASA POWER data, not a forecast. Manually closing a notice does not establish recovery.

The engine requires red/NIR/SCL bands and trustworthy reflectance scale/offset metadata (STAC `raster:bands`, or raster metadata). It refuses to guess integer-band scaling. Statistics, tiles and overlays share masking and normalization. Boundary updates archive the old geometry, invalidate summaries, and isolate old observations by revision. OpenStreetMap/Leaflet provides the key-free basemap; it is not the selected Sentinel acquisition.

For the opt-in real PostgreSQL regression, use `npm run test:integration` after configuring the isolated database described above. The integration test verifies PostGIS transactions, acquisition recency, duplicate prevention, quality rejection, fallback to an older usable observation, and boundary-version invalidation. Standard `npm test` skips the database-dependent portion but still tests that the safety guard rejects ordinary development and remote databases.

Field records and related API routes now have account ownership checks, and the field diary supports photo-backed scouting records. No licensed diagnosis provider is configured, so the product explicitly reports diagnosis as unavailable and does not infer diseases or treatments. PDF reports, offline synchronization, application-wide translations/unit preferences, and full shared-deployment hardening remain incomplete. Do not represent the whole roadmap as complete; see [the implementation handoff](docs/EVIDENCE_HANDOFF.md) for current evidence, validation and blockers.

Field onboarding saves the boundary independently of imagery processing, uses newest-first candidate processing and offers retry without creating another field. Optional planting/harvest dates remain unknown when omitted. GeoJSON import supports one valid Polygon (not MultiPolygon); boundary edits are versioned and invalidate current summaries. The analysis page now shows a two-date comparison and timeline from actual accepted observations, with quality and source information.
