# CHM — 17 October Demo Verification Runbook

This checklist supplements [SUBMISSION_READINESS.md](SUBMISSION_READINESS.md) and the university Phase II/III rubric. **No commands below were executed by this document's author on the student's computer.** Preserve the current `.env`, account and farm data.

## A. Update safely
1. Save work and back up the existing TerraScope database using the current PostgreSQL tools.
2. In the CHM project root, run sequentially:
```bash
npm stop
git pull --ff-only origin main
npm run migrate
npm start
npm run status
```
The current `premigrate` hook starts only the configured project-managed PostgreSQL instance; externally managed PostgreSQL must be started separately. Stop immediately if any command fails. Do **not** reset the database or run destructive integration tests against `terrascope`.

## B. Verify software gates
```bash
npm run build
npm run lint
npm test
npm run test:ui
.venv/bin/python -m pytest backend/engine -q
npm run test:smoke
```
Run smoke only while the local services are healthy. Save date/time, commit SHA, console output and any failures. Run isolated database integration tests only against dedicated `chm_integration`, following README. Record GitHub Actions check conclusions separately; no status is inferred from missing checks.

## C. Real end-to-end field demo
- [ ] Login with existing account; confirm owned fields and sample labels
- [ ] Draw/save a genuine field polygon; screenshot field overview
- [ ] Trigger image check; record job state, result and failure/retry behavior
- [ ] If a real clear scene is accepted, record provider, scene ID, acquisition date, cloud/coverage quality, boundary version and reading
- [ ] If no scene is accepted, explicitly record 'no valid observation' — do not substitute a fabricated health score
- [ ] View dated greenness trend and historical weather, including missing-data handling
- [ ] Plan a field visit; add a scouting photo/note; reload and confirm persistence
- [ ] Export a report and CSV, check date range, source and provenance
- [ ] Repeat primary workflow at phone width and Hindi language
- [ ] Record screenshots without exposing private farm coordinates, credentials or personal data

## D. Performance evidence
For each measurement record hardware, browser/runtime, dataset size, repetitions, median/p95, errors and raw logs. Separate fixture-backed browser render metrics (already in `evidence/browser-performance-2026-10-16.json`) from **live** API and satellite-processing latency. Never label a mocked measurement as a live result.

| Check | Observed result | Evidence path | Verified by/date |
|---|---|---|---|
| Migration | Pending | | |
| Build/lint | Pending | | |
| Node tests | Pending | | |
| UI tests | Pending | | |
| Python tests | Pending | | |
| Local smoke | Pending | | |
| Isolated PostGIS integration | Pending | | |
| Real satellite scene | Pending | | |
| Export/report | Pending | | |
| Human usability (2–3 users) | Pending | | |

## E. Rubric handoff
- **Phase II (10):** planning/design, WBS, methodology, risk register, system architecture, dated guide feedback.
- **Phase III (20):** code quality, integrated working system, testing and validation, performance evidence, milestone closure.
- **Exhibition (10):** poster, working demonstration, technical Q&A.
- **Final (30):** report (10), presentation/demo/viva (15), genuine paper/patent/IPR submission where applicable (5).

## F. Honest completion gate
Mark Phase II or III 'ready for submission' only after evidence has been attached and reviewed. No faculty approval, research publication, crop-disease accuracy or live scene acceptance is implied by automated tests.
