# Model-training report, November 2026

Generated 2026-11-19 by `scripts/ml/make_report.py` from the saved evaluation files. Nothing here is hand-copied.

**Status: research only. No model is connected to the app.** Scores below are on the public datasets' own held-out splits and are *not* the accuracy a farmer would see.

## 1. Potato leaf photo classifier (PLDD-UP, CC BY 4.0)

Healthy / Early Blight / Late Blight from field photos taken in Uttar Pradesh (15,519 photos; splits never share duplicate groups). MobileNetV2 trained **from random initialisation** (no pretrained weights, see the licence register), on an RTX 4050.

| Run | Setup | Test accuracy | Macro-F1 | Diseased leaf called Healthy | Best validation |
|---|---|---|---|---|---|
| run1 | 20 epochs, constant LR, light augmentation | 91.8% | 0.915 | 76/1394 = 5.5% | 93.1% (epoch 18) |
| run2 | 40 epochs, cosine_annealing_to_zero LR, light augmentation | 96.7% | 0.967 | 7/1394 = 0.5% | 97.6% (epoch 35) |
| run3 | 40 epochs, cosine_annealing_to_zero LR, phone-photo augmentation | 90.9% | 0.909 | 29/1394 = 2.1% | 94.0% (epoch 39) |
| run4 | 80 epochs, cosine_annealing_to_zero LR, phone-photo augmentation | 94.7% | 0.946 | 20/1394 = 1.4% | 96.5% (epoch 77) |

* pldd-up-run1: model SHA-256 `cad44c08db93138a…`, trained in 26 min.
* pldd-up-run2: model SHA-256 `319ad680f01f696b…`, trained in 37 min.
* pldd-up-run3: model SHA-256 `ced41b40c3296967…`, trained in 56 min.
* pldd-up-run4: model SHA-256 `18fb0f6a28c153a5…`, trained in 395 min of wall-clock time, which includes a pause while the laptop was asleep (not compute time; about 1 min per epoch is typical).

### Robustness to phone-photo problems (test photos degraded, accuracy / diseased called Healthy)

| Condition | run2 | run3 | run4 |
|---|---|---|---|
| none (as trained) | 96.7% / 0.5% | 90.9% / 2.1% | 94.7% / 1.4% |
| dim light (x0.5) | 78.8% / 2.3% | 89.5% / 2.6% | 94.3% / 1.7% |
| glare (x1.7) | 76.5% / 2.9% | 86.1% / 6.1% | 90.5% / 3.6% |
| blur (radius 3) | 72.3% / 12.3% | 87.0% / 3.7% | 90.1% / 1.9% |
| heavy JPEG (q=15) | 88.3% / 6.0% | 86.1% / 5.0% | 91.1% / 3.4% |
| off-centre crop | 82.0% / 5.4% | 88.7% / 3.1% | 93.0% / 2.2% |
| rotated 40 degrees | 89.7% / 2.4% | 90.5% / 2.1% | 94.0% / 1.5% |
| low colour (x0.3) | 70.0% / 13.4% | 89.3% / 3.7% | 93.0% / 2.0% |

Accuracy on clean photos overstates real-world use: for pldd-up-run2, dim light, blur and washed-out colour cost 18 to 27 accuracy points, and up to 13.4% of diseased leaves were called Healthy.

### "Not sure" rule (temperature scaling + confidence threshold chosen on validation photos, clean and degraded)

* **pldd-up-run2**: temperature 1.45, threshold 0.99, calibration error 0.0108 -> 0.006. On clean test photos it answers 74.0% of photos with 0.9973 accuracy and 0.0% of answered diseased leaves called Healthy; the rest become "retake the photo".
* **pldd-up-run3**: temperature 0.85, threshold 0.945, calibration error 0.0194 -> 0.0102. On clean test photos it answers 73.3% of photos with 0.9798 accuracy and 1.25% of answered diseased leaves called Healthy; the rest become "retake the photo".
* **pldd-up-run4**: temperature 0.9, threshold 0.81, calibration error 0.012 -> 0.0087. On clean test photos it answers 91.3% of photos with 0.9756 accuracy and 0.72% of answered diseased leaves called Healthy; the rest become "retake the photo".

### Existing photo-quality gate + classifier + "not sure" rule (share of ALL test photos answered / diseased called Healthy among answered)

| Condition | gate passes | run2 | run3 | run4 |
|---|---|---|---|---|
| none (as trained) | 95.4% | 71.2% / 0.0% | 70.2% / 1.3% | 87.2% / 0.75% |
| dim light (x0.5) | 34.4% | 13.6% / 0.0% | 23.8% / 0.7% | 31.3% / 0.25% |
| glare (x1.7) | 91.9% | 38.2% / 0.0% | 53.5% / 2.35% | 76.6% / 2.57% |
| blur (radius 3) | 57.5% | 14.2% / 9.09% | 32.9% / 0.99% | 50.3% / 1.02% |
| heavy JPEG (q=15) | 96.2% | 49.9% / 0.89% | 58.0% / 1.61% | 82.9% / 2.12% |
| off-centre crop | 96.2% | 39.6% / 2.18% | 67.3% / 0.8% | 86.7% / 0.74% |
| rotated 40 degrees | 95.7% | 54.2% / 0.6% | 67.9% / 1.5% | 87.1% / 0.93% |
| low colour (x0.3) | 95.4% | 39.4% / 1.56% | 63.0% / 1.49% | 83.9% / 1.05% |

### Selection rule (stated in the working session before run 3 was trained; not committed beforehand)

Run 3 replaces run 2 only if its mean accuracy over the degraded conditions is higher **and** diseased-called-Healthy on clean photos is at most 1.0%. Run 2: mean degraded accuracy 79.7%, clean miss 0.5%. Run 3: 88.2%, clean miss 2.1%. **Result: run 3 is not chosen.**

The rule was applied as declared and not changed after seeing results. The trade-off is real: with the quality gate and the "not sure" rule, run 2 answers 71.2% of clean photos with 0.0% diseased-called-Healthy, but its worst degraded condition is 9.09%; run 3 answers 70.2% with 1.3%, and its worst degraded condition is 2.35%. Run 3 was still under-fitted (final train accuracy 89.9%); a longer run with the same augmentation is the next experiment. Note that run 3's training finished all epochs but its final step ran out of memory, so its test evaluation was re-run from the saved best checkpoint (`finalize_pldd_up.py`; recorded in its model metadata).

### Run 4 criteria (declared and committed before run 4 was trained)

Run 4 = the run 3 augmentation, 80 epochs, cosine schedule. It replaces run 2 as the candidate only if **all** hold on the test split, scored once: (1) diseased leaf called Healthy on clean photos is at most 1.0%; (2) mean accuracy over the seven degraded conditions is above run 2's; (3) the worst degraded-condition miss rate without the "not sure" rule is at most 6%. If it fails any, run 2 stays the reference and the failure is reported.

| Criterion | Met | Value |
|---|---|---|
| clean miss <= 1.0% | NO | 1.43% |
| mean degraded accuracy above run 2 | yes | 92.3% vs 79.7% |
| worst degraded miss <= 6% | yes | 3.59% |

**Result: run 4 does not meet all criteria; run 2 stays the reference.**

## 2. Crop type from Sentinel-2 (AgriFieldNet India, CC-BY-4.0)

5551 fields, split by image chip so neighbouring fields never straddle splits (train 3967, validation 725, test 859). Gradient-boosted trees on band and index statistics of each field.

Test accuracy **59.1%** against a 33.9% always-pick-the-commonest-class baseline, but macro-F1 only **0.22**.

| Crop | Fields (all splits) | Test precision | Test recall | Test F1 |
|---|---|---|---|---|
| Wheat | 2031 | 0.66 | 0.73 | 0.69 |
| Mustard | 990 | 0.36 | 0.45 | 0.40 |
| Lentil | 103 | 0.00 | 0.00 | 0.00 |
| No crop/Fallow | 1641 | 0.72 | 0.71 | 0.72 |
| Green pea | 23 | 0.00 | 0.00 | 0.00 |
| Sugarcane | 163 | 0.33 | 0.17 | 0.23 |
| Garlic | 48 | 0.00 | 0.00 | 0.00 |
| Maize | 293 | 0.68 | 0.73 | 0.71 |
| Gram | 59 | 0.00 | 0.00 | 0.00 |
| Coriander | 14 | 0.00 | 0.00 | 0.00 |
| Potato | 41 | 0.00 | 0.00 | 0.00 |
| Bersem | 16 | 0.00 | 0.00 | 0.00 |
| Rice | 129 | 0.12 | 0.11 | 0.11 |

Wheat, maize and fallow land are recognised reasonably; rice (the app's main crop) and every rare crop are not. One single-date 2022 rabi snapshot cannot separate crops that look alike on that date. **Not suitable for the app in this form.**

## 3. What is NOT shown by these numbers

* Accuracy on photos from other farms, cameras, seasons or states. PLDD-UP is one region and season; near-identical photos from the same plant may sit on both sides of a split even though exact/near duplicates are grouped.
* Any result for rice, wheat or maize photos. Paddy Doctor (CC BY 4.0, verified) is the next dataset but must be downloaded by a person with a free IEEE DataPort account.
* Disease detection from satellite NDVI. It is not possible, and these models do not claim it.
* The 41 duplicate groups in PLDD-UP that appear under more than one class are label noise and cap the attainable accuracy.
* Percentages for degraded photos where the "not sure" rule answered few photos rest on small numbers of diseased leaves; a single case can move them by several points.

## 4. Integration criteria (not yet met)

1. Accuracy and diseased-called-Healthy measured on photos from the app's own fields, labelled by an agronomist (the consent + reviewer workflow already exists).
2. The quality gate + "not sure" rule in place, with the miss rate on degraded photos within an agreed limit.
3. Licences and attributions recorded in `datasets/TRAINING-DATA-REGISTER.md` and shown in the app; the result presented only as "possible cause, not a diagnosis".

## 5. Reproduce

See `scripts/ml/README.md`. Data and models stay in the git-ignored `.local/`.
