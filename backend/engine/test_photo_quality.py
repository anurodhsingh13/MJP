from PIL import Image
from main import photo_quality_assessment

def test_dark_photo_is_flagged_without_disease_labels():
    photo=Image.new('RGB',(640,640),(15,16,17))
    result=photo_quality_assessment(photo)
    assert result['status']=='needs_review'
    assert 'underexposed' in result['issues']
    assert 'low_contrast' in result['issues']
    assert 'disease' in result['disclaimer'].lower()
    assert 'predicted_disease' not in result

def test_small_photo_needs_more_resolution():
    photo=Image.new('RGB',(300,450),(127,127,127))
    result=photo_quality_assessment(photo)
    assert 'low_resolution' in result['issues']

def test_bright_image_is_flagged():
    photo=Image.new('RGB',(640,640),(250,250,250))
    result=photo_quality_assessment(photo)
    assert 'overexposed' in result['issues']
    assert all(isinstance(item,str) for item in result['suggestions'])
