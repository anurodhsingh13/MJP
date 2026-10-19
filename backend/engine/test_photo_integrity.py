import base64
import io

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.engine.main import PhotoRequest, inspect_photo


def photo_bytes(size=(64, 64)):
    output = io.BytesIO()
    Image.new('RGB', size, color=(50, 130, 60)).save(output, format='JPEG')
    return output.getvalue()


def test_inspection_returns_decoded_sanitized_jpeg():
    original = photo_bytes()
    result = inspect_photo(PhotoRequest(image=base64.b64encode(original).decode()))
    assert result['width'] == 64
    assert result['height'] == 64
    with Image.open(io.BytesIO(base64.b64decode(result['image']))) as image:
        image.load()
        assert image.format == 'JPEG'
        assert image.size == (64, 64)


def test_corrupt_and_truncated_jpeg_are_rejected():
    original = photo_bytes()
    for damaged in (original[:40], b'not-a-jpeg', original[:len(original)//2]):
        with pytest.raises(HTTPException) as caught:
            inspect_photo(PhotoRequest(image=base64.b64encode(damaged).decode()))
        assert caught.value.status_code == 422
