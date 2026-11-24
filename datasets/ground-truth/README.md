# Field crop-health observations

This directory contains a blank template, not ground-truth records. Only add observations collected by a person who visited the field and has the required consent. Do not infer these labels from satellite indices or from a model prediction.

## Collection rules

- Record the visit date, crop, growth stage, observed symptoms and observer role.
- Keep an observed condition separate from a suspected cause. Use `disease_status` values such as `not_assessed`, `suspected` or `confirmed`; record how a diagnosis was confirmed.
- Store severity only when the survey protocol defines its scale. Write that scale into the survey data dictionary.
- Obtain field-owner consent for research use and separate consent for public release. Keep the signed consent record outside this repository.
- Use a project field ID or a random observation ID. Do not include farmer names, phone numbers, account IDs or exact household addresses.
- Store geotagged photos and raw records under ignored `.local/datasets/ground-truth/` unless a privacy and redistribution review explicitly approves a small public extract.
- Keep each observation tied to the correct field boundary version and date. Never rewrite an observation as an official farm yield or a confirmed disease label without evidence.

## Template fields

`condition_label` should use the survey's documented categories (for example, `healthy`, `stressed`, `symptomatic`, `unknown`). `stress_type` may record `water`, `nutrient`, `pest`, `disease_suspected`, `other` or `unknown`. These are field observations, not a medical or agronomic diagnosis.

`consent_status` should be `granted`, `not_granted` or `withdrawn`; keep the actual consent document private and put only its internal reference in `consent_reference`. Do not use a row unless consent covers the intended research use.

The project has no validated real crop-health labels yet. The Telangana challenge copy and the spectral-proxy benchmark are not silently imported as farmer-field truth. See [the Telangana source review](../external/TELANGANA-GROUND-TRUTH.md) before considering any external survey copy.

## Scoring the satellite alert against visits

`scripts/evaluate-ndvi-alerts.mjs` runs the app's own rules (`shared/evidence.ts`, `shared/advice.ts`) as of each visit date and reports sensitivity, specificity, precision and imagery coverage with 95% intervals. It scores the measured-evidence alert only, not Gemini or photos.

1. Fill `observation-template.csv` from real visits (consent granted, `reviewed_by` set; `condition_label` = `healthy`, `stressed` or `symptomatic`). Keep the file under `.local/datasets/ground-truth/`.
2. Export the field's satellite history (and crop dates, repeated on each row) to `ndvi.csv` with one read-only command:
   `node scripts/export-ndvi-for-visits.mjs` (writes `.local/datasets/ground-truth/ndvi.csv` from `DATABASE_URL`). It runs this query, which you can also run by hand:
   `select v.field_id, v.observed_on, v.acquired_at, v.ndvi_value, v.valid_coverage_percent, v.valid_pixel_count, v.boundary_version, v.tile_id, f.planting_date, f.harvest_date from public.vegetation_indices v join public.fields f on f.id=v.field_id where v.accepted and v.provenance='measured_imagery'`
3. Run `node --import tsx scripts/evaluate-ndvi-alerts.mjs --visits <visits.csv> --ndvi ndvi.csv`.

Before scoring, make sure each field's `planting_date` and `harvest_date` are this season's real dates: stale crop dates change the stage rules and the result. Collect healthy fields as well as problem fields; without both, specificity or sensitivity cannot be measured. Under 30 scored visits the intervals are very wide.
