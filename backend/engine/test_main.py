from fastapi.testclient import TestClient
from backend.engine.main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "TerraScope Engine API"}

def test_root_describes_service_routes():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"service": "TerraScope Engine API", "health": "/health", "docs": "/docs"}

def test_trend_requires_two_observations():
    response = client.post("/analyze-indices", json={
        "languageCode": "en-IN",
        "observations": [{"observed_on": "2026-09-01", "ndvi_value": 0.62}],
    })
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_data"
    assert response.json()["observations"] == 1

def test_trend_accepts_explicit_null_crop_dates_from_api():
    response = client.post('/analyze-indices', json={
        'languageCode': 'en-IN', 'plantingDate': None, 'harvestDate': None, 'observations': []
    })
    assert response.status_code == 200
    assert response.json()['status'] == 'insufficient_data'
    assert response.json()['observations'] == 0


def test_indices_accept_nullable_optional_bands_from_json():
    from backend.engine.main import CalculateIndicesRequest
    payload = CalculateIndicesRequest(redUrl='red.tif', nirUrl='nir.tif',
        blueUrl=None, redEdgeUrl=None, swirUrl=None, sclUrl=None,
        polygonGeojson={'type': 'Polygon', 'coordinates': []})
    assert payload.swirUrl is None
