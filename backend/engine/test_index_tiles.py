import io, math
import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from PIL import Image
from rasterio.transform import from_bounds

from backend.engine.main import app, INDEX_STYLES

client = TestClient(app)
Z = 14
LON, LAT = 78.0, 17.0
RED, NIR, RED_EDGE, SWIR = 0.08, 0.50, 0.20, 0.30   # constant reflectances -> known indices


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_bounds_lonlat(x, y, z):
    n = 2 ** z
    lon = lambda i: i / n * 360 - 180
    lat = lambda j: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * j / n))))
    return lon(x), lat(y + 1), lon(x + 1), lat(y)


@pytest.fixture()
def scene(tmp_path):
    x, y = tile_xy(LON, LAT, Z)
    west, south, east, north = tile_bounds_lonlat(x, y, Z)
    pad = 0.002
    bounds = (west - pad, south - pad, east + pad, north + pad)
    size = 240
    transform = from_bounds(*bounds, size, size)

    def write(name, value, dtype='float32'):
        path = tmp_path / f'{name}.tif'
        data = np.full((size, size), value, dtype=dtype)
        with rasterio.open(path, 'w', driver='GTiff', height=size, width=size, count=1, dtype=dtype, crs='EPSG:4326', transform=transform) as dst:
            dst.write(data, 1)
        return str(path)

    cx, cy = (west + east) / 2, (south + north) / 2
    half = 0.006
    polygon = {'type': 'Polygon', 'coordinates': [[[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]]}
    return dict(x=x, y=y, polygon=polygon, redUrl=write('red', RED), nirUrl=write('nir', NIR), redEdgeUrl=write('re', RED_EDGE),
                swirUrl=write('swir', SWIR), sclUrl=write('scl', 4, 'uint8'))


def centre_colour(response):
    assert response.status_code == 200, response.text
    image = Image.open(io.BytesIO(response.content)).convert('RGBA')
    return np.array(image.getpixel((128, 128)), dtype=float)


def expected_colour(index, value):
    vmin, vmax, cmap = INDEX_STYLES[index]
    return np.array(cmap((value - vmin) / (vmax - vmin)), dtype=float) * 255


def request(scene, index=None, drop=()):
    body = {k: scene[k] for k in ('redUrl', 'nirUrl', 'redEdgeUrl', 'swirUrl', 'sclUrl') if k not in drop}
    body['polygonGeojson'] = scene['polygon']
    if index is not None:
        body['index'] = index
    return client.post(f"/tiles/{Z}/{scene['x']}/{scene['y']}.png", json=body)


def test_default_tile_is_still_ndvi(scene):
    ndvi = (NIR - RED) / (NIR + RED)
    assert np.allclose(centre_colour(request(scene)), expected_colour('ndvi', ndvi), atol=2)
    assert np.allclose(centre_colour(request(scene, 'ndvi')), expected_colour('ndvi', ndvi), atol=2)


@pytest.mark.parametrize('index,other', [('ndre', RED_EDGE), ('ndmi', SWIR)])
def test_index_tiles_use_their_own_band_and_fixed_scale(scene, index, other):
    value = (NIR - other) / (NIR + other)
    colour = centre_colour(request(scene, index))
    assert colour[3] == 255                                         # inside the field and unmasked
    assert np.allclose(colour, expected_colour(index, value), atol=2)
    assert not np.allclose(colour, centre_colour(request(scene, 'ndvi')), atol=8)   # a different index looks different


def test_same_value_gets_the_same_colour_on_two_dates(scene):
    first, second = centre_colour(request(scene, 'ndre')), centre_colour(request(scene, 'ndre'))
    assert np.array_equal(first, second)


def test_unknown_index_and_missing_band_are_rejected(scene):
    assert request(scene, 'evi').status_code == 422
    assert request(scene, 'ndre', drop=('redEdgeUrl',)).status_code == 422
    assert request(scene, 'ndmi', drop=('swirUrl',)).status_code == 422
    assert request(scene, 'ndvi', drop=('redEdgeUrl', 'swirUrl')).status_code == 200


def test_cloud_masked_pixels_stay_transparent_for_every_index(scene, tmp_path):
    scl = tmp_path / 'cloud.tif'
    with rasterio.open(scene['sclUrl']) as src:
        profile = src.profile
    with rasterio.open(scl, 'w', **profile) as dst:
        dst.write(np.full((profile['height'], profile['width']), 9, dtype='uint8'), 1)   # class 9: cloud, high probability
    cloudy = {**scene, 'sclUrl': str(scl)}
    for index in ('ndvi', 'ndre', 'ndmi'):
        assert centre_colour(request(cloudy, index))[3] == 0


def test_typical_crop_values_look_clearly_different_across_indices():
    # Typical mid-season field means (this app's rice and wheat fields): the three maps must not be mistaken for one another.
    typical = {'ndvi': .45, 'ndre': .29, 'ndmi': .06}
    colours = {k: expected_colour(k, v)[:3] for k, v in typical.items()}
    for a in colours:
        for b in colours:
            if a < b:
                assert np.linalg.norm(colours[a] - colours[b]) > 60, (a, b, colours[a], colours[b])


def test_both_tile_renderers_use_the_same_palette_and_range():
    from backend.engine import earth_engine as gee
    for index, (vmin, vmax, cmap) in INDEX_STYLES.items():
        style = gee.INDEX_STYLES[index]
        assert (style['min'], style['max']) == (vmin, vmax)
        if index != 'ndvi':   # NDVI keeps the original continuous RdYlGn on the rasterio path and a 3-stop ramp on Earth Engine
            hexes = ['#' + c for c in style['palette']]
            assert [round(x * 255) for x in cmap(0.0)[:3]] == [int(hexes[0][i:i + 2], 16) for i in (1, 3, 5)]
            assert [round(x * 255) for x in cmap(1.0)[:3]] == [int(hexes[-1][i:i + 2], 16) for i in (1, 3, 5)]
