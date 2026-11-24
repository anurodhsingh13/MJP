"""Build a labelling kit for a random subset of the IIT Kharagpur potato field photos.

The source set (Zenodo 22059910, CC BY 4.0) ships with no per-image labels, so
accuracy needs a human to label a subset. This writes, under .local/ (git-ignored):

  labels.csv     blank sheet to fill in (image, label, notes)
  labeller.html  offline page: shows each photo, keys 1-5 set the label, Export CSV
  images/        copies of the sampled photos (so the HTML works from one folder)

Labels (potato canopy, as in the dataset's manuscript):
  1 healthy | 2 late_blight_initial | 3 late_blight_advanced | 4 early_blight | 5 unsure

For model scoring, both late_blight_* map to the model's Late Blight class.
The sample is seeded, so re-running gives the same images.

Usage: python scripts/ml/make_labelling_sheet.py [--n 200] [--seed 42]
"""
import argparse
import csv
import json
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = (ROOT / ".local/datasets/iitkgp-potato/extracted/"
       "Stage-wise_Late_Blight_Supporting_Data_Repository/data/Images")
OUT = ROOT / ".local/labelling/iitkgp-potato"
LABELS = ["healthy", "late_blight_initial", "late_blight_advanced", "early_blight", "unsure"]

HTML = """<!doctype html><meta charset="utf-8"><title>Potato labeller</title>
<style>body{font-family:sans-serif;max-width:760px;margin:16px auto;padding:0 16px}
img{max-width:100%;max-height:70vh;display:block;margin:8px 0}
button{padding:8px 12px;margin:2px;font-size:15px}.on{background:#2a7;color:#fff}</style>
<h3>Potato leaf labeller (<span id=pos></span>)</h3>
<div id=name></div><img id=img>
<div id=btns></div><p>Keys: 1-5 set label, left/right arrows move. Saved in this browser automatically.</p>
<button onclick="exp()">Export CSV</button> <button onclick="nextUn()">Next unlabelled</button>
<script>
const IMAGES=__IMAGES__, LABELS=__LABELS__, KEY='potato-labels-v1';
let L={};try{L=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
let i=0;
function save(){try{localStorage.setItem(KEY,JSON.stringify(L))}catch(e){}}
function show(){const f=IMAGES[i];img.src='images/'+f;name.textContent=f;
 const done=Object.keys(L).length;pos.textContent=(i+1)+'/'+IMAGES.length+', labelled '+done;
 btns.innerHTML=LABELS.map((l,k)=>`<button class="${L[f]==l?'on':''}" onclick="set(${k})">${k+1} ${l}</button>`).join('')}
function set(k){L[IMAGES[i]]=LABELS[k];save();if(i<IMAGES.length-1)i++;show()}
function nextUn(){for(let k=0;k<IMAGES.length;k++){const j=(i+k)%IMAGES.length;if(!L[IMAGES[j]]){i=j;break}}show()}
function exp(){const rows=['image,label,notes'].concat(IMAGES.map(f=>f+','+(L[f]||'')+','));
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.join('\\n')],{type:'text/csv'}));
 a.download='labels.csv';a.click()}
document.onkeydown=e=>{if(e.key>='1'&&e.key<='5')set(+e.key-1);
 else if(e.key=='ArrowRight'&&i<IMAGES.length-1){i++;show()}else if(e.key=='ArrowLeft'&&i>0){i--;show()}};
show();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    files = sorted(p.name for p in SRC.glob("*.jpg"))
    if not files:
        raise SystemExit(f"No images found in {SRC}")
    pick = sorted(random.Random(a.seed).sample(files, min(a.n, len(files))))
    (OUT / "images").mkdir(parents=True, exist_ok=True)
    for f in pick:
        shutil.copy2(SRC / f, OUT / "images" / f)
    with open(OUT / "labels.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["image", "label", "notes"])
        for f in pick:
            w.writerow([f, "", ""])
    html = HTML.replace("__IMAGES__", json.dumps(pick)).replace("__LABELS__", json.dumps(LABELS))
    (OUT / "labeller.html").write_text(html, encoding="utf-8")
    print(f"{len(pick)} of {len(files)} images -> {OUT}")


if __name__ == "__main__":
    main()
