import base64, io
import pytest
from fastapi.testclient import TestClient
from PIL import Image
import main

def photo_b64(color=(120,160,90)):
    buffer=io.BytesIO()
    Image.new('RGB',(640,640),color).save(buffer,format='JPEG')
    return base64.b64encode(buffer.getvalue()).decode()

@pytest.fixture
def reset_model():
    original=dict(main._leaf_model)
    main._leaf_model.update(loaded=False,model=None,calibration=None,metadata=None)
    yield
    main._leaf_model.update(original)

def test_missing_model_returns_503_not_a_guess(monkeypatch,tmp_path,reset_model):
    monkeypatch.setenv('POTATO_LEAF_MODEL_DIR',str(tmp_path/'nope'))
    response=TestClient(main.app).post('/classify-potato-leaf',json={'image':photo_b64()})
    assert response.status_code==503

def test_bad_image_is_rejected_when_model_present(reset_model):
    if main._load_leaf_model() is None:
        pytest.skip('trained leaf model not present on this machine')
    response=TestClient(main.app).post('/classify-potato-leaf',json={'image':base64.b64encode(b'not an image').decode()})
    assert response.status_code==422

def test_dark_photo_is_not_classified(reset_model):
    if main._load_leaf_model() is None:
        pytest.skip('trained leaf model not present on this machine')
    body=TestClient(main.app).post('/classify-potato-leaf',json={'image':photo_b64((10,10,10))}).json()
    assert body['status']=='photo_quality' and 'label' not in body
