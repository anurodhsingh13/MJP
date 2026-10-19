# Experimental photo analysis: supported scope

The existing upload/camera/scouting workflow remains functional. JPEG/PNG/WebP images up to 5 MB are decoded by the Python service, limited to 20 megapixels, resized and re-encoded as private JPEGs without the original metadata. Owned API routes control photo access. Field/date, symptoms, notes and image-quality results persist in scouting history. These are not disease classifications.

No disease classifier is enabled. No reviewed weight artifact, redistribution licence, supported-label manifest or independent held-out field evaluation is available locally. Returning arbitrary softmax probabilities as disease confidence would not satisfy the master prompt. This is an explicit external/research prerequisite, not a hidden mock classifier.

Reviewed primary references:

- [PlantVillage dataset and citation](https://github.com/spMohanty/PlantVillage-Dataset): a credible research dataset; an available dataset alone does not supply reviewed inference weights or prove compatibility with these field photos.
- [Mohanty et al., 2016](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2016.01419/full): the authors distinguish controlled leaf evaluation from substantially weaker external-image performance. Those published results are not TerraScope's accuracy.

To enable a classifier in a future reviewed change: record the weight checksum and source/licence, exact preprocessing, ordered crop/disease labels, model/runtime versions, unsupported-image policy and uncertainty threshold. Use plant/field-separated held-out images with permission, record class supports, accuracy, macro-F1 and confusion counts, and separately test real field photographs. Do not download an untrusted pickle or train on test images. Until these prerequisites exist, the API continues to report diagnosis as unavailable and the UI offers manual scouting.
