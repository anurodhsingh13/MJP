# Labelling real field photos for the validation test

Purpose: public datasets cannot tell us how the model does on this app's own farms and phones. A small, honestly labelled set can.
Until this exists, the model is not connected to the app.

## What to collect
* **Crop:** potato first (the only crop the current candidate model covers).
* **At least 30 photos per class** (Healthy, Early Blight, Late Blight); 100 each is much better. With 30 the 95% range on any rate is still about +/-15 points.
* Photos as a farmer would really take them: phone camera, normal light, some imperfect ones. **Do not pre-select only clear photos.**
* Many different plants and fields, not 20 photos of one leaf.

## Who labels, and how
* An agronomist or plant-protection officer, after seeing the plant in the field (ground visit), not from the photo alone.
* If unsure, the photo is left out (do not guess a class).
* Photos where the leaf has two problems, or the expert is not sure: leave out.

## Folder format (what the script reads)
```
field-photos/
  Healthy/         *.jpg
  Early Blight/    *.jpg
  Late Blight/     *.jpg
```
Folder names must be exactly these three. Keep the folder **outside the git repository** (photos can show people, fields and location).
Only collect photos with the owner's agreement; do not share them or upload them anywhere.

## Run
```
.venv-ml\Scripts\python.exe scripts\ml\evaluate_field_photos.py --photos D:\field-photos ^
  --model .local\models\pldd-up-run4\model.pth --calibration .local\models\pldd-up-run4\calibration.json ^
  --output .local\ml-logs\field-photo-eval.json
```
The report gives, with 95% ranges: accuracy, diseased-called-Healthy, how many photos the quality gate and "not sure" rule answer,
and the confusion matrix. Nothing is copied, trained on or sent anywhere.

## What counts as good enough to consider integration
Decided with the owner **before** looking at the result: for example, diseased-called-Healthy at most 1.0% (upper end of the 95% range, not just the point value)
and a majority of real photos answered. If it fails, the model stays out of the app.
