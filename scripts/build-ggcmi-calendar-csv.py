#!/usr/bin/env python3
"""Build India crop-calendar CSVs from the GGCMI Phase 3 crop calendar (CC BY 4.0, DOI 10.5281/zenodo.5062513).

    python scripts/build-ggcmi-calendar-csv.py --ggcmi .local/datasets/calendar/ggcmi --fields fields.json \
        --field-csv out/field-calendar.csv --state-csv datasets/reference/india-crop-calendar-ggcmi.csv

fields.json: [{"id": "<uuid>", "name": "...", "crop": "rice|wheat|maize", "lat": 26.4, "lon": 81.3}, ...]

Output for the importer (scripts/import-fao-calendar.mjs) has one row per field for the field's own crop. Windows are derived
from the grid cell's mean planting day (+/- 15 days) and maturity day (to +30 days) at 0.5 degree resolution: regional
reference windows only, never a farmer's actual dates. Only crops with a real source in India are produced (rice, wheat,
maize); potato is refused because GGCMI has no India source for it.
"""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path

import h5py
import numpy as np

CROPS = {  # app crop -> (GGCMI file code, label, season note)
    "rice": ("ri1_ir", "Rice (main season, irrigated)"),
    "wheat": ("wwh_ir", "Wheat (winter, irrigated)"),
    "maize": ("mai_rf", "Maize (rainfed)"),
}
SOURCES = {1: "MIRCA", 2: "SAGE", 3: "Iizumi 2019", 4: "RiceAtlas", 5: "Dimou 2018", 6: "ChinCropPhen", 7: "IndiaAgStat", 8: "CONAB", 9: "ABARES"}
STATES = {
    "Punjab": (30.9, 75.85), "Haryana": (29.7, 76.98), "Uttar Pradesh": (26.2, 81.2), "Bihar": (25.6, 85.1),
    "West Bengal": (23.2, 87.9), "Odisha": (20.5, 85.9), "Tamil Nadu": (10.8, 79.1), "Andhra Pradesh": (16.3, 80.4),
    "Maharashtra": (18.5, 73.9), "Madhya Pradesh": (23.3, 77.4), "Gujarat": (23.0, 72.6), "Rajasthan": (26.9, 75.8),
    "Karnataka": (12.3, 76.6), "Assam": (26.75, 94.2),
}
WHEAT_CAVEAT = " Wheat: planting is one national date (4 Nov) for all of India and harvest is modelled, so treat harvest as +/- 1 month (may be late)."
SOURCE_URL = "https://doi.org/10.5281/zenodo.5062513"
SOURCE_TITLE = "GGCMI Phase 3 crop calendar (Jaegermeyr et al. 2021), CC BY 4.0"
PERMISSION = ("CC BY 4.0 (Zenodo 5062513); attribution: Jaegermeyr J. et al. (2021), Nature Food 2, 873-885. "
              "Regional reference window derived from a 0.5 degree grid cell; not FAO data and not a farmer record.")


def month_of(day: float) -> int:
    day = int(round(day))
    day = (day - 1) % 365 + 1
    return (dt.date(2001, 1, 1) + dt.timedelta(days=day - 1)).month


def lookup(ggcmi: Path, code: str, lat: float, lon: float):
    with h5py.File(ggcmi / f"{code}_ggcmi_crop_calendar_phase3_v1.01.nc4") as g:
        i = int(np.abs(g["lat"][:] - lat).argmin())
        j = int(np.abs(g["lon"][:] - lon).argmin())
        planting, maturity = float(g["planting_day"][i, j]), float(g["maturity_day"][i, j])
        source = int(g["data_source_used"][i, j]) if "data_source_used" in g else 0
        cell = (float(g["lat"][i]), float(g["lon"][j]))
    if not (0 < planting <= 366 and 0 < maturity <= 366):
        return None
    return {"planting": planting, "maturity": maturity, "source": SOURCES.get(source), "cell": cell}


def windows(value):
    return month_of(value["planting"] - 15), month_of(value["planting"] + 15), month_of(value["maturity"]), month_of(value["maturity"] + 30)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ggcmi", type=Path, required=True)
    parser.add_argument("--fields", type=Path, required=True)
    parser.add_argument("--field-csv", type=Path, required=True)
    parser.add_argument("--state-csv", type=Path, required=True)
    args = parser.parse_args()
    today = dt.date.today().isoformat()

    rows, skipped = [], []
    for field in json.loads(args.fields.read_text(encoding="utf-8")):
        crop = (field.get("crop") or "").strip().lower()
        if crop not in CROPS:
            skipped.append(f"{field['id']}: crop '{crop}' not supported (only rice, wheat, maize)")
            continue
        value = lookup(args.ggcmi, CROPS[crop][0], field["lat"], field["lon"])
        if value is None or value["source"] not in ("IndiaAgStat", "RiceAtlas", "MIRCA", "SAGE"):
            skipped.append(f"{field['id']}: no observed source for {crop} at this location")
            continue
        ps, pe, hs, he = windows(value)
        rows.append({"field_id": field["id"], "country": "India", "region": f"grid cell {value['cell'][0]:.2f}N {value['cell'][1]:.2f}E (source: {value['source']})",
                     "crop": crop.capitalize(), "planting_start_month": ps, "planting_end_month": pe, "harvest_start_month": hs, "harvest_end_month": he,
                     "source_url": SOURCE_URL, "source_title": SOURCE_TITLE, "license": "CC BY 4.0",
                     "permission_note": PERMISSION + (WHEAT_CAVEAT if crop == "wheat" else ""), "reviewed_on": today})
    args.field_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.field_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader(); writer.writerows(rows)

    args.state_csv.parent.mkdir(parents=True, exist_ok=True)
    month_name = lambda m: dt.date(2001, m, 1).strftime("%b")
    with args.state_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["state", "reference_point_lat", "reference_point_lon", "crop", "planting_months", "harvest_months", "data_source", "note"])
        for state, (lat, lon) in STATES.items():
            for crop, (code, label) in CROPS.items():
                value = lookup(args.ggcmi, code, lat, lon)
                if value is None:
                    continue
                ps, pe, hs, he = windows(value)
                note = "" if value["source"] else "no observed source here (gap-filled): low confidence"
                if crop == "wheat":
                    note = (note + " " if note else "") + "planting is one national date; harvest is modelled (+/- 1 month, may be late)"
                writer.writerow([state, lat, lon, label, f"{month_name(ps)}-{month_name(pe)}", f"{month_name(hs)}-{month_name(he)}", value["source"] or "gap-filled", note])
    print(json.dumps({"field_rows": len(rows), "skipped": skipped, "field_csv": str(args.field_csv), "state_csv": str(args.state_csv)}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
