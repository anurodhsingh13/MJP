# Phase III - Implementation, testing and validation (20 marks)

**Project:** TerraScope Crop Health Monitor (CHM). **Updated:** 16 October 2026. **Rubric period:** 21 September-24 October 2026. Student-requested immediate demo target: 17 October.

## Implementation

The implemented system combines a bilingual React/Vite interface, Express ownership checks and durable jobs, PostgreSQL/PostGIS field/evidence storage, and a FastAPI raster/photo-inspection engine. Core screens cover field creation/editing, next actions, exact-image maps, measured greenness changes, visits, photo notes and reports. Photos do not produce automatic disease diagnoses. NASA POWER remains historical modeled weather.

This revision simplifies the first useful path: select a field -> read its next action -> visit/check pictures/record a note. Measurements, experimental scores and detailed image identifiers are optional. The [design document](DESIGN_AND_TRACEABILITY.md) maps requirements to implementation and tests.

## Current executable evidence

| Check | Result | Scope |
|---|---|---|
| `npm run build` | Passed locally | TypeScript and production assets. |
| `npm run lint` | Passed locally | Existing frontend/backend lint scope. |
| `npm test` | 20 passed, 3 skipped | Controller/unit/export/policy checks; DB tests are a separate gate. |
| `npm run test:ui` | 34 passed locally | Actual browser UI/Leaflet, fixture HTTP responses and tiles. |
| `npm run test:integration` | Existing CI gate | Isolated PostGIS, migrations, transactions, ownership, jobs and visits. Check the submitted SHA's Actions result. |
| Python engine pytest | Existing CI gate (14-test suite) | Controlled raster/date/photo tests; engine unchanged in this UI revision. |
| `npm run test:smoke` | Not run in this environment | Run against the student's configured local stack before the demo. |
| Live accepted satellite result | Not demonstrated here | Requires eligible live imagery, actual field boundary and running services. |

GitHub workflow: https://github.com/tusharsingh-1801/91-CHM/actions . Keep the exact submitted commit SHA with its successful workflow result. A green fixture/browser test does not prove a live provider result or agronomic validity.

## Test-case register

| ID | Scenario | Actual evidence | Status |
|---|---|---|---|
| T01 | Launch all local services | README preflight/status available; student-machine full-stack run outstanding | Local demo check pending |
| T02 | Create field without planting date | Browser exercises real form and mocked save/queue requests; duplicate retries covered | UI passed; live persistence check pending |
| T03 | Reject malformed polygon/UUID | Ordinary API validation checks passed | Passed within unit/controller scope |
| T04 | Omitted optional update values remain unchanged | Added actual HTTP/PostGIS regression to the owned-field integration case | See submitted CI result |
| T05 | Explicit null clears an optional value | The same database integration verifies all three optional values clear to null | See submitted CI result |
| T06 | Missing/cloudy/stale picture is unknown | Evidence policy tests and new plain-language regression passed | Passed |
| T07 | Same-day scenes select exact evidence | Browser checks scene identity, accepted/rejected/unprocessed and boundary alignment | Passed with fixture APIs |
| T08 | Controlled raster NDVI/masks | Python CI gate | See submitted CI result |
| T09 | Missing weather sentinels preserve valid zero rain | Controller tests passed | Passed |
| T10 | Hindi/English and mobile/landscape layout | Browser workflows at 320-1440 widths, Hindi font and persistent acre preference | Passed |
| T11 | Cross-owner field isolation | Dedicated database-backed API test in CI; sign-in gate browser test | See integration CI result |
| T12 | Provider/API errors and retry preserve entries | Browser tests for field queue, diary/photo, weather and assistant failures | Passed with controlled failures |
| T13 | Visit retry identity and due-task shortcut | Browser action and targeted plain-language test; DB idempotency CI gate | UI passed; see DB CI |
| T14 | CSV/GeoJSON date range, source and identity | Unit export tests and browser downloads passed | Passed |
| T15 | All fields missing imagery / demo-only account | No false reassurance; useful first-field/sample action | Passed |

## Controlled performance result

Ten browser navigations to all 20 fixture field cards rendered at 1440x900: median **942 ms**, nearest-rank p95 **1042 ms**. Linux x64, AMD EPYC 9V74, Node 24.19.0, Chromium 153.0.8010.0, Vite development server; API responses mocked and external fonts blocked. [Raw samples and environment](evidence/browser-performance-2026-10-16.json).

This is a frontend rendering benchmark, not backend API p50/p95, external provider latency, a production guarantee or satellite processing speed. Measure those separately on the actual demo environment and record scene dimensions, boundary area, repetition count and errors.

## Method and limitations

NDVI is `(NIR - red) / (NIR + red)` with valid reflectance, geometry/cloud/nodata masks and nonzero denominator. Measurements are tied to acquisition, scene, boundary revision and calculation method. Image coverage controls usability independently of the experimental vegetation score. One picture does not establish a trend; stale data does not establish today's crop condition. Resolving a notice records an action, not recovery.

The current thresholds are product heuristics, not crop/season calibration. No disease accuracy, yield prediction, user-study score or live service reliability statistic is claimed. Forecasting, automatic diagnosis, offline synchronization and public-release hardening remain separate work.

## Evidence to attach before presenting

- Submitted Git SHA and successful Actions link; local commands/results above.
- A screenshot/report of the actual configured demo field, with its source/date/quality.
- Controlled raster test result with expected versus measured value.
- Actual guide review/feedback and team identifiers.
- Short presentation/poster/final report in faculty format.
- A known-limitations slide and a rehearsed failure/unknown-data explanation.

For start/pull commands, the six-minute demonstration, viva answers and gap-closing instructions, use [Submission readiness](SUBMISSION_READINESS.md).
