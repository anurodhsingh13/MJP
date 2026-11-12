# Data status

Be accurate here: list a source as working only after a live run stored results in the database.

| Source | Status |
|---|---|
| Sentinel-2 L2A Collection 1 via Earth Search (AWS Open Data) | **Working.** Verified 12 Nov 2026: an image check stored NDVI for a 3.57 ha field from the 11 Nov 2026 scene (tile 43RGK, 100% clear field), and a season-history job stored 12 accepted dates from May–Nov 2026 (1 date rejected for cloud). |
| Sentinel-2 L2A via Google Earth Engine | Optional. Used when `EARTH_ENGINE_PROJECT_ID` and Application Default Credentials are configured; not yet run end to end in this workspace. |
| NASA POWER | Connected in code (historical weather context). |
| Open-Meteo | Connected in code (seven-day forecast context). |
| FAO Crop Calendar | Requires a manual, permission-reviewed CSV import. |

## Method notes

- NDVI = (B8 − B4) / (B8 + B4) on surface reflectance (DN × 0.0001 − 0.1 for processing baseline 04.00+, taken from STAC `raster:bands`).
- Pixels with SCL classes 0, 1, 2, 3, 8, 9, 10 or 11 (no data, saturated, dark/shadow, cloud shadow, cloud, cirrus, snow) are excluded.
- An image is accepted when at least 70% of the field and at least 10 pixels are clear.
- Sentinel-2 overlap zones deliver the same pass in two MGRS tiles with separately corrected reflectance. On 11 Nov 2026 the same 3.57 ha field measured NDVI 0.246 in tile 43RGK and 0.317 in 43RGL, so each field keeps one primary tile and changes are only compared within the same tile.
- A decrease of 0.10 or more between two accepted images at most 30 days apart is an inspection signal, except within 30 days before or 45 days after the recorded harvest date (expected ripening/harvest).
