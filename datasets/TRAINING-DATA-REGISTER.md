# Training-data licence register

Audit date: 2026-11-18 (Mendeley rows re-verified through DataCite on 2026-11-20). Purpose: record, before any model is trained, which datasets may legally be used, under which
terms, and what was actually verified. **"Verified" means the licence was read on a primary page on the audit date.**
Anything else is marked unverified and must not be used for training until a person confirms it.

This register is separate from `datasets/catalog.json` (which drives the app's Datasets page): candidate datasets are not
shown to farmers.

## Rules

| Licence | Use for training? | Obligation |
|---|---|---|
| CC0, CC BY 4.0, Apache-2.0 | Yes | Attribute (not needed for CC0); keep the DOI/licence text with the data and the model card |
| CC BY-SA (any version) | Only with a recorded decision | Share-alike may extend to derivative data and possibly to models trained on it. Decide before use |
| Not stated, conflicting, or only seen on a mirror | **No** | Confirm on the primary record first |
| NC (non-commercial) | No (this app is intended for real farmers) | — |

A permissive licence is not a privacy or deployment clearance: no personal data, GPS of private fields or faces may be
published or redistributed with a model.

## Register

| Dataset | Content | Licence | Status | Evidence |
|---|---|---|---|---|
| PLDD-UP | Potato leaf field photos, Uttar Pradesh, Rabi 2025-26; Healthy 4,600 / Early Blight 4,803 / Late Blight 6,116 | CC BY 4.0 | **Allowed.** Licence is recorded in the local source manifest (retrieved 2026-10-30, SHA-256 verified). DataCite on 2026-11-20 also reports CC BY 4.0 | `.local/datasets/up/pldd-up/manifest.json`, DOI 10.17632/3j4nfkvp2n.1 |
| AgriFieldNet India Competition | Sentinel-2 composites + ground-surveyed crop type for 7,081 fields in Uttar Pradesh, Rajasthan, Odisha, Bihar (2022) | CC-BY-4.0 | **Allowed (verified 2026-11-18).** Cite: Radiant Earth Foundation & IDinsight (2022), AgriFieldNet Competition Dataset v1.0, DOI 10.34911/rdnt.wu92p1 | https://source.coop/radiantearth/agrifieldnet-competition |
| Paddy Doctor | Paddy leaf photos, Tamil Nadu (Tirunelveli); 16,225 images (480x640), 13 classes (12 diseases/pests + normal), labelled by an agricultural officer | CC BY 4.0 | **Allowed (verified 2026-11-19 on the primary IEEE DataPort record, which links the CC BY 4.0 licence).** The arXiv metadata mirror says CC BY-SA 4.0 and the GitHub LICENSE (Apache-2.0) covers code; use only the IEEE DataPort copy and attribute: Petchiammal A, Briskline Kiruba S, Murugan D, Pandarasamy Arjunan, "Paddy Doctor", DOI 10.21227/hz4v-af08. **Download needs a free IEEE DataPort login: a person must fetch it** (not yet downloaded) | https://ieee-dataport.org/node/10108 , https://arxiv.org/abs/2205.11108 |
| PlantDoc | ~2,600 mostly web-collected photos, many species | CC BY 4.0 (GitHub, Meta-Album) | **Not allowed for training yet.** Images were largely scraped from the web, so the copyright of the underlying photos is unclear. Small; evaluation only if cleared | https://github.com/pratikkayal/PlantDoc-Dataset |
| PlantVillage | Lab photos, many crops | **Conflicting**: CC BY-SA 3.0 (paper, reviews) vs CC0 (mirrors) | **Not used.** Share-alike may extend to trained models, and lab images transfer poorly to field photos | https://github.com/spMohanty/PlantVillage-Dataset |
| CropHarvest | Global labelled crop / non-crop points | CC BY-SA 4.0 | **Needs a decision** (share-alike) before any use | https://pypi.org/project/cropharvest/ |
| Wheat nitrogen deficiency and leaf rust (IARI) | Wheat photos, IARI Delhi; 368 leaf rust / 491 control (859 files) | CC BY 4.0 | **Allowed (verified 2026-11-20 via the DataCite record of the Mendeley DOI; file SHA-256 matched the publisher's list).** Used in small-crop experiments only | https://data.mendeley.com/datasets/th422bg4yd |
| Maize leaf blight severity (MDSD) | Maize field photos, India; 1,760 images | Paper is CC BY; dataset licence not seen | **Unverified** | https://www.frontiersin.org/articles/10.3389/fpls.2022.1077568/full |
| UCI Rice Leaf Diseases | 120 lab-style photos, 3 classes | CC BY 4.0 | Allowed but too small / not field conditions: sanity checks only | https://archive.ics.uci.edu/dataset/486/rice+leaf+diseases |
| RiceLeafBD (Mendeley sjkptpgv79) | Rice leaf photos, Bangladesh; Bacterial Leaf Blight 422 / Brown Spot 356 / Healthy 252 / Tungro 530 | CC BY 4.0 | **Allowed (verified 2026-11-20 via DataCite; SHA-256 matched).** Different country, so results say nothing about Indian fields. Other Mendeley sets checked the same day and also CC BY 4.0 (not downloaded): corn hmkd6nbngr, wheat disease 5gc7hwydwg, rice vwv3nry3wr, RiceLeaf-06-2777, WheatPhenology | https://data.mendeley.com/datasets/sjkptpgv79 |
| Rice leaf disease images, Sethy et al. (Mendeley fwcj7stb8r v2) | 5,932 rice photos, 4 classes (Bacterial blight 1,584 / Blast 1,440 / Brown spot 1,600 / Tungro 1,308); described by the paper as on-field images from India (Odisha-based authors); our own look at samples shows real field backgrounds | CC BY 4.0 | **Allowed (verified 2026-11-20 via DataCite; file SHA-256 matched).** Cite: Sethy, Barpanda, Rath, Behera (2020), doi:10.1016/j.compag.2020.105527. **Caution:** 1,365 near-duplicate groups found; flipped or rotated copies are not caught by our hash, so a random split can overstate accuracy. Region and capture details are not stated on the data record | https://data.mendeley.com/datasets/fwcj7stb8r |
| Colour-Mix sheath blight severity, Kerala (Mendeley 489spnkhp5) | Field photos, Thrissur Kerala; 6 severity levels of one disease (SBSeverity.zip 4.3 GB, includes augmented data) | CC BY 4.0 | Allowed licence-wise, **not downloaded**: severity grading of a single disease, not disease recognition | https://data.mendeley.com/datasets/489spnkhp5 |
| Indian Rice Disease Dataset (IRDD), West Bengal (IEEE DataPort 11316) | Brown spot / healthy | Not clear ("0" on the record) | **Not allowed** until the licence is confirmed | https://ieee-dataport.org/node/11316 |
| Winter wheat, Jaipur (Mendeley gj72pjfvb2) | Wheat | **NonCommercial** | **Not allowed** | https://data.mendeley.com/datasets/gj72pjfvb2 |

## Weights

Models are trained from random initialisation unless a pretrained checkpoint's licence is confirmed. ImageNet-pretrained
weights are not downloaded by default because the ImageNet terms are research-oriented and their use in a product is a
separate decision for the owner.

## Honest limits

* Public datasets are from other seasons, regions and cameras. A score on their held-out test split is **not** the
  accuracy farmers will see. The only meaningful number is accuracy on photos from the app's own fields, labelled by an
  agronomist (the consent + reviewer workflow already exists in the database).
* Disease cannot be read from satellite NDVI. Satellite datasets (AgriFieldNet) can support crop type and growth-stage
  checks, not diagnosis.

## Crop calendars (reference data, not for model training), checked 2026-11-20
| Dataset | India? | Licence | Status |
|---|---|---|---|
| GGCMI Phase 3 crop calendar (Jaegermeyr et al. 2021, Zenodo 5062513, DOI 10.5281/zenodo.5062513) | Yes, 0.5 degree grid, 18 crops, rainfed and irrigated | CC BY 4.0 | **Allowed; downloaded, 40 files, Zenodo checksums matched.** Wheat and maize in India come from IndiaAgStat and rice from RiceAtlas; **potato has no source in India (gap-filled), do not use it** (it puts UP potato planting in June, which is wrong). Cite: Jaegermeyr J. et al. (2021), Nature Food 2, 873-885 |
| GEOGLAM Crop Monitor sub-national calendars v1.3 (Zenodo 15850408) | **No** (86 countries, India not among them) | CC BY 4.0 | Downloaded, md5 matched; not useful for India |
| JRC ASAP crop calendars GAUL0/GAUL1 (GEO Knowledge Hub 9qpxr-52p90, based on FAO data) | Probably | CC BY 4.0 | **Not downloaded:** the JRC download host timed out from this network; can be fetched from a browser |
| FAO Crop Calendar web tool | Yes | Per-record permission | Not used (no permitted bulk download) |
| SAGE Crop Calendar Dataset (Sacks et al. 2010) | Probably | No licence stated | Not used |
