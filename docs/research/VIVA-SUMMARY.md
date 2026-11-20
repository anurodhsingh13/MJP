# Crop-disease image models for TerraScope: summary for viva and presentation

**One sentence:** We trained image classifiers on seven legally usable, openly licensed datasets (mostly Indian), tested them honestly, and found
that they work well on public test photos but are **not ready for farmers** until they are checked on photos from the app's own fields.

## 1. What was done
- **Legal data only.** Every dataset's licence was checked on its primary record (DataCite / publisher page) before use; all are CC BY 4.0 and are listed with attribution in `datasets/TRAINING-DATA-REGISTER.md`. Datasets with unclear, share-alike or non-commercial licences were refused (for example PlantVillage, one Jaipur wheat set, a Pakistan dataset removed from the paper).
- **Model:** MobileNetV2 trained from random initialisation (no ImageNet weights, to avoid an unclear licence), PyTorch on an RTX 4050.
- **Honest evaluation:** splits keep duplicate and near-duplicate photos together (no photo and its copy on both sides); test photos were scored once; acceptance criteria were written and committed **before** training.
- **Safety layer:** the app's photo-quality gate (too dark, too bright, blurry) plus a calibrated "not sure, retake the photo" rule, so the model says nothing rather than guess.

## 2. Results (accuracy on each dataset's own held-out test photos)
| Dataset | Region | Photos | Classes | Best test accuracy |
|---|---|---|---|---|
| PLDD-UP potato leaf | Uttar Pradesh | 15,519 | Healthy, Early Blight, Late Blight | **94.7%** (run 4, chosen) |
| Wheat leaf rust (IARI) | Delhi | 859 | 2 | 98.4% scratch, 100% transfer (lab-like photos) |
| Wheat nitrogen deficiency (IARI) | Delhi | 600 | 2 | 92.2% |
| Rice leaf disease (Sethy et al.) | India (Odisha-based authors) | 5,932 in about 400 duplicate groups | 4 | 94.8% (leak-free split) |
| Rice leaf disease (RiceLeafBD) | Bangladesh | 1,516 | 4 | 91.2% scratch, 95.2% transfer |
| Rice leaf disease and pest | Bangladesh authors | 2,747 | 7 | 69.3% scratch, 70.1% transfer |
| AgriFieldNet (satellite crop type) | UP, Rajasthan, Odisha, Bihar | 5,551 fields | crop type | 59.1% (rice F1 only 0.11): not usable |

Potato in detail (the main model, run 4): 94.7% accuracy; diseased leaf called Healthy in 1.4% of test photos on its own. With the quality gate and "not sure" rule on clean photos it answers 87% of photos and calls a diseased leaf Healthy in 0.75% of the answered ones (worst degraded condition 2.6%).
Run 2 scored higher on clean photos (96.7%) but collapsed on blurred or washed-out photos (about 72% accuracy, up to 13% diseased-called-healthy), so the more robust run 4 was kept.

## 3. Findings worth stating
1. **High scores can be fake.** A first Indian-rice run scored 100% because 97% of its test photos had a near copy in training (the dataset is about 400 originals augmented about 15 times). After a flip/rotation-proof duplicate check the leak was gone and the score fell to about 94%. The 100% is void and kept only as proof of the leak.
2. **Robustness matters more than the headline number.** Training with phone-photo augmentation (blur, dim light, glare, JPEG) gave a model that fails far less on bad photos.
3. **Transfer from our own potato model did not generally help.** It met the pre-declared rule (at least 2 points and higher macro-F1) on one of five datasets.
4. **Accuracy on small test sets is uncertain.** With 90 to 130 test photos a 95% interval is about 5 to 7 points wide, so 100% is not "perfect".

## 4. Limits (say these yourself before you are asked)
- All numbers come from public datasets (one lab, one season, one camera). They are not the accuracy a farmer will get.
- Labels on the public data come from the dataset authors; we did not re-verify them.
- Wheat photos are on a plain black background; rice sets contain augmented copies; the Indian rice test is only about 60 independent groups.
- Indian rice has no large verified field dataset available to us (Paddy Doctor needs a paid IEEE DataPort subscription).
- The model is a research model: it can say "possible cause", never a diagnosis. It is **not connected to the app**.

## 5. What is needed before deployment
1. 30 to 100 photos per class from the app's own fields, labelled by an agronomist after a ground visit.
2. Run `scripts/ml/evaluate_field_photos.py` and decide the pass limit **before** looking at the result (for example diseased-called-healthy at most 1.0%, judged on the upper end of the 95% range).
3. Only if it passes: show the result as "possible cause, not a diagnosis", with the quality gate and "not sure" rule on.

## 6. Likely viva questions
- **Why not ImageNet weights?** Licence terms are research-oriented and unclear for a product; random initialisation avoids that, at the cost of needing more epochs.
- **Why is accuracy "only" 94.7% when papers report 99%?** Many papers use lab photos or leaky splits; ours keeps duplicates apart and is measured on field photos.
- **Why a "not sure" answer?** A confident wrong "healthy" can cost a farmer a crop; abstaining on dim, blurred or uncertain photos trades coverage for safety.
- **Can it be used on farms today?** No, see sections 4 and 5.
- **What would you do next?** Collect labelled field photos, re-test, and add Indian rice and wheat data with verified licences.

Full details: `docs/research/ML-TRAINING-REPORT-2026-11.pdf`. Code: `scripts/ml/`. Plans written before training: `docs/research/SMALL-CROP-EXPERIMENT-PLAN.md`.
