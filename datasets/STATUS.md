# Public demo data status

Verified on 15 October 2026 against the local native services.

| Public parcel | Area (ha) | Weather days | Satellite scenes | Processed dates | Latest observation |
|---|---:|---:|---:|---:|---|
| Public demo: India parcel 4054 | 1.36 | 30 | 10 | 2 | 2026-10-05 |
| Public demo: India parcel 8681 | 1.47 | 30 | 10 | 2 | 2026-10-12 |
| Public demo: India parcel 3178 | 2.81 | 30 | 9 | 2 | 2026-10-12 |

Total added for public demos: **90 daily weather records, 29 scene metadata records and 6 field-clipped vegetation observations**. Each observation contains NDVI, NDRE, NDMI, SAVI, EVI and valid-pixel coverage. The local UI was checked for a populated NDVI table, trend response, source notice and weather chart.

The three original fields remain separate and unchanged by the public-demo import. Repeat import was checked: three demos and one source-attribution event per demo, without duplicates.

## Data meaning

- Boundaries: FTW India reference year **2016**, CC BY 4.0; see [attribution](ATTRIBUTION.md).
- Weather: NASA POWER, **13 September–12 October 2026**, 30 available daily records per demo.
- Imagery: real Sentinel-2 L2A scenes from Earth Search; indices calculated by the local Python engine.
- Crop identity, actual planting/harvest dates and expected yield: **unknown**, not filled with guesses.
- Trend is based on only two processed dates per demo; it is a small-sample indicator, not a calibrated yield forecast or crop-stage diagnosis.
- Source catalog: nine sources; soil, crop classification, alternate rainfall and calendars remain reference-only rather than silently imported data.

Validation: production build, TypeScript, lint, 14 Node tests, nine browser workflows (plus the updated history/provenance paths) passed. Live local checks confirmed all five vegetation indices, coverage, trend responses and weather data for the three demos.
