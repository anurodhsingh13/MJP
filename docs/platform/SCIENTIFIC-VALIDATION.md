# Reproducible scientific scope

The raster engine calculates NDVI `(NIR-red)/(NIR+red)`, NDMI using SWIR and NDRE using red-edge reflectance. Input transforms include STAC scale/offset. Warped rasters use a common projected grid, SCL categorical nearest-neighbour sampling and field geometry masks; rejected/cloud/nodata pixels are excluded. Whole-boundary pixel coverage is the quality denominator, even if part of a field lies outside a scene.

Tests in `backend/engine/test_evidence.py`, `test_synthetic.py` and `test_main.py` check controlled rasters, scaling, masks, coverage, missing bands and temporal trends. `satellite.integration.test.ts` uses real PostGIS with controlled engine replies to check versioning, date recency, out-of-order completion, owner isolation and repeated jobs. These tests do not measure field agronomic accuracy.

Live public-boundary verification on 18 October 2026 retained both rejection and acceptance evidence. Scenes from 3 and 5 October had 125 valid pixels and 100% boundary coverage; their measured NDVI values were 0.3951 and 0.3355. Their decrease is descriptive, not proof of disease, water deficit or yield loss. Crop identity on the historical public parcel is unverified. Additional 17 October scenes had only 1.38% usable coverage and were rejected.

Ignored raw logs are under `.local/complete-platform-evidence/`. Reproduce using the existing public parcel and Sentinel scene IDs in `IMPLEMENTATION-AUDIT.md`, its unchanged boundary version, the current `sentinel-reflectance-scl-v2` engine and the original STAC assets. Remote data availability may change. Never rewrite legacy measurements or substitute fictional demo readings to obtain an accepted result.

No genuine field-truth dataset, crop/season calibration, independently sampled disease labels, confusion matrix or agronomic accuracy is available. Those results remain explicitly unclaimed. See `PHOTO-ANALYSIS.md` for classifier enablement prerequisites.
