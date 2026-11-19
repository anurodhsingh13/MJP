# Wheat and rice leaf-disease experiments: plan declared before training

Declared 2026-11-20, before any wheat/rice model was trained. Research only; nothing here goes into the app.

## Data (all CC BY 4.0, verified through DataCite; see datasets/TRAINING-DATA-REGISTER.md)
- Wheat leaf rust, IARI India (Mendeley th422bg4yd): 859 photos, Healthy / Leaf rust. Split 602/129/128 by duplicate group.
- Rice leaf disease, Bangladesh (Mendeley sjkptpgv79): 1,516 photos, 4 classes. Split 875/228/227 by duplicate group.
- The publisher's own split is ignored (wheat: 3 duplicate groups cross it).

## Models (MobileNetV2, 224 px, strong phone-photo augmentation, cosine LR, seed 42, no ImageNet weights)
- A. scratch: random initialisation, 80 epochs.
- B. transfer: feature layers from our own PLDD-UP run 4 model (trained on legal CC BY potato data), new classifier head, 80 epochs.
- The checkpoint is chosen by validation loss only. The test split is evaluated once per model.

## Reading rule (fixed now)
1. Transfer (B) is called better than scratch (A) only if test accuracy is higher by at least 2.0 points AND macro-F1 is higher.
   Otherwise the report says transfer did not help on that dataset.
2. Test sets are small (128 wheat, 227 rice): a 95% interval on accuracy is about +/-4 to +/-7 points, so differences under that are noise
   and will be reported as such, whatever the point estimates look like.
3. No result here is app-ready. App use still requires the app's own expert-labelled field photos, which we do not yet have.
   Rice photos are from Bangladesh, so rice results say nothing about Indian fields.
