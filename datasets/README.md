# TerraScope public data package

This is a curated source catalog and a reproducible Indian public-farm demo. It covers the project's weather, imagery, boundary, vegetation, crop-map, soil and agronomy-reference needs. It is not an exhaustive list of every internet dataset.

## What is actually included

- `catalog.json`: nine reviewed sources, their use, access links, integration status and limitations.
- `demo/ftw-india-sample.geojson`: three genuine public parcel polygons, extracted from the 10,013-row FTW India benchmark.
- `demo/manifest.json`: source checksum, file size and reproducible selection rules.
- `ATTRIBUTION.md`: authors, source publication, redistribution license and changes.
- The full 7.47 MB GeoParquet is downloaded to ignored `.local/datasets/`; it is not bundled into the frontend.
- `requirements.txt`: optional GeoParquet tooling. The regular app does not require PyArrow.

Demo fields are named **Public demo: India parcel ...** and have a visible historical-data notice. Source attribution is also recorded as a `dataset_import` event. They are separate from the three original seeded fields. The source polygons refer to 2016 and may have changed since then.

## Reproduce the demo

The three-parcel sample is already included. With Node dependencies installed and local services running:

```bash
npm run data:import-demo
SYNC_DEMO_ONLY=1 SYNC_SCENE_LIMIT=2 npm run sync:data
```

To re-download and regenerate the sample from the full source:

```bash
npm run data:download
.venv/bin/python -m pip install -r datasets/requirements.txt
.venv/bin/python scripts/prepare-public-demo.py
```

The importer adds missing demo records and source events without changing original fields. Reruns identify demos by their source-labelled names; do not rename them between imports. Weather and scene writes are upserts. Demo-only sync excludes original fields and uses public sample coordinates for NASA POWER/Earth Search requests.

`SYNC_WEATHER_DAYS` selects 1–365 available weather days (default 30); `SYNC_SCENE_LIMIT` selects 1–6 candidate scene dates (default 6). Weather imports use a three-day availability lag. At least two successful dated observations are needed for the trend panel. Cloud/no-data scenes may be rejected. Current sync progress and results are in `.local/public-demo-sync-report.json`.

## Which app values each source can fill

| App value | Suitable source | What remains unknown |
|---|---|---|
| Coordinates and polygon | User-drawn boundary, or a labelled FTW public demo | A benchmark polygon is not the user's actual farm |
| Area | PostGIS geodesic calculation on that polygon | Exact surveyed/legal area |
| Temperature, rain, humidity | NASA POWER daily API | Actual irrigation, on-site sensor readings |
| Observation dates and cloud cover | Earth Search Sentinel-2 catalog | Whether every field pixel is cloud-free |
| NDVI/NDRE/NDMI/SAVI/EVI | Python processing of real scene bands and polygon | Farm yield or disease diagnosis |
| Health score and stress zones | Existing experimental formulas from valid scene pixels | Agronomic calibration and uncertainty |
| Current crop type | Farmer record or independently validated current labels | FTW boundary data supplies no crop identity |
| Planting/harvest dates | Actual farm records | Regional FAO windows are reference information only |
| Yield and field events | Actual farm measurements/management records | Cannot be inferred merely by populating UI inputs |
| Soil properties | Optional ISRIC SoilGrids integration | Not yet imported; coarse model estimates are not soil-test results |
| Crop classification training | Optional CropHarvest benchmark | Training labels are not current labels for saved fields |
| Crop/land-cover context | Optional ESA WorldCereal/WorldCover | Not yet imported; historic map classes do not identify an individual current crop |

## Official sources

The UI at `/datasets` and `catalog.json` link to the relevant official pages. Sources connected in this app are NASA POWER and Sentinel-2/Earth Search. FTW is the boundary source for demo records. CropHarvest, ESA WorldCereal, ESA WorldCover, ISRIC SoilGrids, UCSB CHIRPS v3 and FAO Crop Calendar are documented reference sources; their databases are not silently copied or declared integrated.

References: [FTW India](https://source.coop/kerner-lab/fields-of-the-world-india/boundaries_india_2016.parquet), [FTW source licenses](https://github.com/fieldsoftheworld/ftw-datasets-list), [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/), [Earth Search](https://element84.com/earth-search/), [CropHarvest](https://github.com/nasaharvest/cropharvest), [WorldCereal](https://esa-worldcereal.org/en/products/global-maps), [WorldCover](https://esa-worldcover.org/en/data-access), [SoilGrids](https://isric.org/explore/soilgrids), [CHIRPS v3](https://chc.ucsb.edu/data/chirps3), [FAO calendar](https://cropcalendar.apps.fao.org/).

See [STATUS.md](STATUS.md) for verified local import counts and data limitations.
