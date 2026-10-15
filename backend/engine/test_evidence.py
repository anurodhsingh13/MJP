import base64
import io
import math
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from PIL import Image
from fastapi.testclient import TestClient
from backend.engine.main import app
client=TestClient(app)

@pytest.fixture
def raster_case(tmp_path):
    def write(name, data, scale=None, offset=0,nodata=None):
        path=str(tmp_path/f'{name}.tif')
        with rasterio.open(path,'w',driver='GTiff',height=10,width=10,count=1,dtype=data.dtype,
            crs='EPSG:4326',transform=from_origin(77,28,.001,.001),nodata=nodata) as src:
            src.write(data,1)
            if scale is not None: src.scales=(scale,);src.offsets=(offset,)
        return path
    polygon={'type':'Polygon','coordinates':[[[77,28],[77.01,28],[77.01,27.99],[77,27.99],[77,28]]]}
    return write,polygon

def test_scale_offset_zero_and_cloud_mask_are_consistent_in_statistics_and_overlay(raster_case):
    write,polygon=raster_case
    red=np.full((10,10),3000,dtype='uint16')
    nir=np.full((10,10),9000,dtype='uint16')
    # Decoded reflectances .2 and .8 => NDVI=.6, while unscaled DN would give .5.
    scl=np.full((10,10),4,dtype='uint8');scl[:2]=9
    payload={'redUrl':write('r',red,.0001,-.1),'nirUrl':write('n',nir,.0001,-.1),
             'sclUrl':write('s',scl),'polygonGeojson':polygon}
    result=client.post('/calculate-indices',json=payload)
    assert result.status_code==200,result.text
    assert result.json()['ndvi']==pytest.approx(.6,abs=.0001)
    assert result.json()['validPixels']==80
    assert result.json()['validCoverage']==80
    overlay=client.post('/generate-overlay',json=payload)
    assert overlay.status_code==200,overlay.text
    rgba=np.array(Image.open(io.BytesIO(base64.b64decode(overlay.json()['image'].split(',')[1]))))
    assert (rgba[:,:,3]>0).sum()==80
    assert (rgba[:2,:,3]==0).all()
    zoom=15
    x=int((77.005+180)/360*2**zoom)
    y=int((1-math.asinh(math.tan(math.radians(27.995)))/math.pi)/2*2**zoom)
    tile=client.post(f'/tiles/{zoom}/{x}/{y}.png',json=payload)
    assert tile.status_code==200,tile.text
    tile_rgba=np.array(Image.open(io.BytesIO(tile.content)))
    colors=tile_rgba[tile_rgba[:,:,3]>0]
    assert len(colors)>0
    assert np.max(np.abs(colors[:,:3].astype(int)-rgba[5,5,:3].astype(int)))<=1

def test_true_zero_reflectance_is_valid_and_nodata_is_not(raster_case):
    write,polygon=raster_case
    red=np.zeros((10,10),dtype='float32');red[0,:]=-999
    payload={'redUrl':write('r',red,nodata=-999),'nirUrl':write('n',np.ones((10,10),dtype='float32')),
             'sclUrl':write('s',np.full((10,10),4,dtype='uint8')),'polygonGeojson':polygon}
    result=client.post('/calculate-indices',json=payload)
    assert result.status_code==200,result.text
    assert result.json()['ndvi']==1
    assert result.json()['validPixels']==90
    assert result.json()['validCoverage']==90

def test_missing_integer_scale_metadata_is_rejected_instead_of_guessed(raster_case):
    write,polygon=raster_case
    payload={'redUrl':write('r',np.full((10,10),2000,dtype='uint16')),
             'nirUrl':write('n',np.full((10,10),8000,dtype='uint16')),
             'sclUrl':write('s',np.full((10,10),4,dtype='uint8')),'polygonGeojson':polygon}
    assert client.post('/calculate-indices',json=payload).status_code==422
    payload['transforms']={'red':{'scale':.0001},'nir':{'scale':.0001}}
    assert client.post('/calculate-indices',json=payload).json()['ndvi']==.6

def test_field_outside_scene_counts_against_usable_coverage(raster_case):
    write,polygon=raster_case
    polygon['coordinates'][0]=[[77,28],[77.02,28],[77.02,27.99],[77,27.99],[77,28]]
    payload={'redUrl':write('r',np.full((10,10),.2,dtype='float32')),
             'nirUrl':write('n',np.full((10,10),.8,dtype='float32')),
             'sclUrl':write('s',np.full((10,10),4,dtype='uint8')),'polygonGeojson':polygon}
    result=client.post('/calculate-indices',json=payload)
    assert result.status_code==200,result.text
    assert result.json()['validCoverage']==50
