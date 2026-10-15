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

def test_irregular_dates_use_elapsed_days_without_planting_date():
    result=client.post('/analyze-indices',json={'observations':[
        {'observed_on':'2026-01-21','ndvi_value':.6},
        {'observed_on':'2026-01-01','ndvi_value':.8},
        {'observed_on':'2026-01-03','ndvi_value':.78},
        {'observed_on':'2026-01-03','ndvi_value':.78},
        {'observed_on':'bad','ndvi_value':.5},
        {'ndvi_value':.2}]}).json()
    assert result['observations']==3
    assert result['slopePerDay']==-.01
    assert result['dateStart']=='2026-01-01'
    assert result['dateEnd']=='2026-01-21'
    assert result['stage'] is None
    assert result['predictedNext'] is None
    assert result['rSquared'] is None

def test_duplicate_dates_do_not_establish_a_trend():
    result=client.post('/analyze-indices',json={'observations':[
        {'observed_on':'2026-01-01','ndvi_value':0},
        {'observed_on':'2026-01-01','ndvi_value':.5}]}).json()
    assert result['status']=='insufficient_data'
    assert result['observations']==1
