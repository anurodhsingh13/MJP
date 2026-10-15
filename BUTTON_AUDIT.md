# Button and workflow audit

The browser suite runs real React UI interactions in Chrome. It intercepts API calls and replaces the external Google Maps SDK with a controlled fixture. This verifies application wiring, state transitions, failure recovery and navigation without changing real fields or depending on provider outages. A separate local smoke test verifies real frontend/API/Python/PostGIS health and field CRUD.

| Area | Actions covered | Result |
|---|---|---|
| Dashboard | Retry, both Add field entry points, field card links | Passed |
| Add field | Cancel, Close, Escape, Next, Back, date constraints | Passed |
| Boundary | Add points, Undo, Clear, Finish, Review, return to boundary | Passed with Maps fixture |
| Save field | Save & Analyse, processing retry without duplicate creation, Open saved field | Passed with API fixture |
| Field navigation | Dashboard, Map, Analysis, History | Passed |
| Manage field | Cancel, Escape, Save, delete confirmation cancellation/acceptance | Passed with API fixture |
| Satellite | Find & Process, failure recovery, observation selection | Passed with API fixture |
| Alerts | Mark resolved failure/retry and removal from active display | Passed with API fixture |
| Map failure | Retry map after SDK load error | Passed with SDK fixture |
| History | Failed initial load, Retry, Save Event failure/retry, Delete failure/retry | Passed with API fixture |
| Analysis | Partial loading failure, Retry, language selection | Passed with API fixture |
| Weather | Sync failure/retry and imported-count feedback | Passed with API fixture; backend regression covers empty POST body and zero coordinates |
| Assistant | Empty question disabled, error feedback, retry and displayed answer | Passed with API fixture |
| Mobile | History page at 390px without document overflow | Passed |
| Live local services | Health, field creation, partial update, null clearing, deletion | Passed against real PostGIS; temporary field cleaned up |

## Corrections made

- History errors no longer leave the loading spinner indefinitely. Save/delete actions expose failures and prevent duplicate submissions.
- Alert resolution and weather sync expose failures instead of leaving them in unhandled promises or the console.
- Failed satellite processing retains a saved field and allows retry or opening that field.
- Wizard can be closed at every step. Modals support Escape, focus restoration and keyboard focus containment.
- Analysis exposes partial service failures and offers retry; zero-valued indices remain visible.
- Route changes remount field content to prevent stale field data/actions. Initial request completions are ignored after unmount.
- Map has a usable height and retry action; SDK configuration runs once.
- White field panels use readable dark text. Narrow history/analysis pages use a single column.
- Weather handler accepts the empty POST sent by the UI. Both ingestion handlers accept zero latitude/longitude; upstream scene/weather calls have 30-second timeouts.
- Dashboard averages exclude fields without observations and display Pending when no measurements exist.

## What to implement next

1. **Provider readiness and live integration checks:** expose configured/unavailable states for Maps, Sarvam, Python and data providers. Verify real Maps drawing, actual Sentinel raster processing and weather import, and Sarvam answers with working credentials. These remain unverified by fixture tests.
2. **Persistent processing jobs:** queued raster work, progress, cancellation, retries and history that survive page refreshes; cache tiles instead of calculating each request.
3. **Atomic and idempotent writes:** one transaction for vegetation indices, field summaries and stress alerts, with concurrency-safe duplicate prevention.
4. **Correct analysis and provenance:** fit trends using distinct dates and elapsed days; show uncertainty, coverage, source and sample size. Clearly mark seeded fields and heuristic health scores.
5. **Complete boundary management:** import GeoJSON and edit an existing field's boundary. Existing Manage field edits metadata only; adding fields currently depends on a working Google Maps key.
6. **Useful farm workflows:** date-range filters, historical scene comparison, downloadable reports, configurable stress thresholds and scheduled ingestion/notifications.
7. **Multi-user access:** authentication and field ownership before shared hosting, followed by rate limits and an audit trail.
8. **Broader verification:** real disposable PostGIS integration tests, browser tests for races/double-clicks and all mobile pages, and a controlled real-raster fixture.

Run `npm run test:ui`, `npm test`, `npm run build`, `npm run lint`, and (with native services running) `npm run test:smoke`.

## Validation result

7 Chrome workflow tests and 9 Node tests pass. Production build, lint, whitespace checks and the real local CRUD smoke test pass. Compatible updates fixed the 5 dependency audit findings; npm reported 0 remaining vulnerabilities. UI tests are included in CI. The native app remains running on http://localhost:5173.
