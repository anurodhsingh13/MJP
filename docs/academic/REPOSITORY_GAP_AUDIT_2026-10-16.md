# 17 October 2026 CHM repository audit and synthetic demo coverage

This audit is based on the current repository's implementation, README, academic submission brief and test code. **Present code != verified running deployment.** Test cases added here have not been run in the student's local environment by the author of this note.

## Implemented in repository

| Area | Existing implementation |
|---|---|
| Field onboarding | Boundary wizard, Polygon/GeoJSON, field CRUD, owner scoping |
| Satellite ingestion | Sentinel-2 scene search, job queue, retry state, source/date/quality handling |
| Raster measurements | Python engine with NDVI, NDMI, NDRE, mask/coverage checks |
| Evidence | Acceptance rules, scene/boundary versions, freshness and changes |
| Farmer workspace | Dashboard priority, field overview, map, trends, diary, report, Hindi/English |
| Follow-up | Planned visits, scouting photo/note, historical weather |
| Exports | Field report, print, CSV/GeoJSON as available |
| Quality gates | TypeScript/build, lint, Node tests, Playwright UI, Python tests and isolated PostGIS suite |
| Academic | Phase II/III write-ups, traceability and submission/demo runbook |

## NEW: independent synthetic test data

- `tests/fixtures/demo-scenarios.json`: 5 basic dashboard scenarios (existing)
- `tests/fixtures/extended-farmer-scenarios.json`: 15 extra cases, covering cloudy images, too few pixels, missing quality metadata, stale images, method/boundary mismatch, a first-only image, declining/rising/stable greenness, due visits, and no imagery
- `tests/ui/extended-demo.spec.ts`: demo-only dashboard search/visibility checks; mocks `/api/fields` and does **not** populate PostgreSQL
- `backend/api/services/extendedDemo.test.ts`: fixed-date decision regression for all 15 cases

All values are **fictional synthetic test readings**. The mocked `provenance` fields exercise logic but are NOT real imagery. They must never be used in any real field report, crop recommendation, accuracy claim, or submitted agronomic result.

## Before the immediate submission: verification blockers

1. Run `npm run submission:check` at the exact submitted commit; attach output logs; do not assume success.
2. Open the student-machine stack and run `npm run test:smoke`. Confirm an existing genuine boundary can be saved/read.
3. Try one **live** satellite acquisition, preserving source, scene ID, quality, acquisition date and failed/accepted result. Real success is NOT guaranteed by fixtures.
4. Perform report/CSV export with matching date, boundary version and attribution. Confirm print on the actual browser.
5. Demonstrate on a phone width and Hindi; document 2–3 nontechnical users' actual observations if possible.
6. Add real project team/guide information, original guide review, evaluation sign-off, screenshots and verified marks; never fabricate them.
7. Verify GitHub Actions status separately, especially isolated PostGIS tests and engine tests.

## NOT implemented / cannot be claimed complete

- Validated photo-based disease prediction: available scouting/photo capture does not equal a medically/agronomically validated diagnostic model.
- Live weather **forecast**: NASA POWER integration is historical weather, not a forecast.
- Full offline operation, reliable push/phone notifications.
- Crop-/season-specific ground-truth calibration, independently verified classification/accuracy, real-field trials.
- Production deployment hardening, operational backups/observability and security audit.
- Confirmed accepted live Sentinel scene on tomorrow's machine, measured real satellite latency and final faculty approval.

These items are later-stage features, not blockers to an honestly presented integrated prototype unless specifically required by the actual faculty instructions.

## Commands

```bash
git pull --ff-only origin main
npm run build && npm run lint && npm test
npx playwright test tests/ui/demo-dashboard.spec.ts tests/ui/extended-demo.spec.ts
npm run submission:check
```

Use the existing `tests/ui/demo-ndvi-journey.spec.ts` with caution: it includes UI selectors that must pass on the current page implementation; correct the tests/UI if any mismatch is reported, never suppress failures. The submitted `summary.json` will show the precise result.

**Privacy:** Never upload `.env`, database backups, private farm GPS coordinates or scouting photos with test evidence.
