# CHM: safe end-to-end verification (16 October 2026)

This runbook distinguishes synthetic browser tests from real satellite/DB integration. **Never seed fake NDVI values into production fields.** The browser fixture uses mocked API data and does not modify PostgreSQL.

## 1. Browser demonstration (no DB mutation)

```bash
git pull --ff-only origin main
npm ci
npx playwright test tests/ui/demo-dashboard.spec.ts tests/ui/demo-ndvi-journey.spec.ts
```

Expected: 5 passing tests if the app matches the fixtures. Actual status must be recorded from the terminal; adding a test is not proof it passed.

## 2. Existing full browser and static checks

```bash
npm run build
npm run lint
npm run test:ui
npm test
```

## 3. Dedicated PostgreSQL integration only

**Do not point integration tests at the existing `terrascope` database.** The integration suite enforces a loopback-only `chm_integration` database. It inserts and removes its own test records and checks owner isolation, job recovery, scene quality, boundary-version invalidation, and idempotent tasks.

Create a *separate* local `chm_integration` database with PostGIS and apply the project's migrations there. Confirm the database name with `psql` before continuing. With a dedicated connection string:

```bash
DATABASE_URL='postgres://localhost:5435/chm_integration' npm run migrate
DATABASE_URL='postgres://localhost:5435/chm_integration' npm run test:integration
```

Adapt credentials and port to the dedicated local instance. Never copy production data or credentials into this database.

## 4. Real satellite acceptance

Using a real user-owned field boundary and live scene catalog, record:
- acquisition time, source, scene ID, cloud cover, boundary version
- red B4 and NIR B8 data sources, SCL masking, valid pixel count and usable coverage
- accepted/rejected status and quality reason
- NDVI formula `(NIR - Red)/(NIR + Red)` applied to calibrated reflectance
- two comparable accepted acquisitions, computed change, map tile and report
- rejected cloudy scenes, failed jobs, and the UI's honest no-data state

A synthetic NDVI fixture cannot certify scientific correctness. Save the terminal/browser evidence separately from fixtures.

## 5. Farmer usability

On a 390px phone viewport, ask a nontechnical user to: find the field needing attention, explain what the signal does *not* prove, plan a visit, and open a report. Record completion/errors without coaching.
