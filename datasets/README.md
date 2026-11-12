# Datasets

TerraScope is scoped to **crop health monitoring using NDVI and satellite imagery**.

| Need | Source | Notes |
|---|---|---|
| Vegetation index | Sentinel-2 L2A via Google Earth Engine | NDVI = (B8 - B4) / (B8 + B4), SCL cloud/shadow mask, 10 m |
| Weather context | NASA POWER (history), Open-Meteo (forecast) | Context only, not a crop-health measurement |
| Crop-stage reference | FAO Crop Calendar | Manual CSV; see `fao-calendar-template.csv` |
| Validation | `ground-truth/observation-template.csv` | Record real field visits to test the alert thresholds |

`catalog.json` drives the `/datasets` page. Only list a source there after it has actually run in this project.
