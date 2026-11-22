"""Collect evidence sentences about crop diseases/pests from CC BY open-access articles (Europe PMC).

  .venv/Scripts/python scripts/knowledge/fetch_disease_evidence.py

Only articles whose Europe PMC licence field is exactly 'cc by' are used (not -nc, -sa, -nd, or missing), so the text
can be reused with attribution. Output (raw passages, git-ignored): .local/datasets/knowledge/evidence_passages.csv
columns: crop,disease,category,pmcid,year,title,licence,section,sentence
The curated dataset (datasets/knowledge/crop_disease_knowledge.csv) is written by hand from these passages.
"""
import csv, json, re, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/datasets/knowledge/evidence_passages.csv'
BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
TARGETS = [  # crop, disease, search term
    ('rice', 'blast', '"rice blast" OR "Magnaporthe oryzae"'),
    ('rice', 'bacterial leaf blight', '"bacterial blight" AND rice AND "Xanthomonas oryzae"'),
    ('rice', 'sheath blight', '"sheath blight" AND rice'),
    ('rice', 'brown spot', '"brown spot" AND rice AND (Bipolaris OR Cochliobolus)'),
    ('rice', 'tungro', 'tungro AND rice'),
    ('rice', 'false smut', '"false smut" AND (rice OR Ustilaginoidea)'),
    ('rice', 'bacterial leaf streak', '"bacterial leaf streak" AND rice'),
    ('rice', 'sheath rot', '"sheath rot" AND rice'),
    ('rice', 'brown planthopper', '"brown planthopper" AND rice'),
    ('rice', 'yellow stem borer', '("stem borer" OR Scirpophaga) AND rice'),
    ('rice', 'leaf folder', '("leaf folder" OR Cnaphalocrocis) AND rice'),
    ('wheat', 'yellow (stripe) rust', '"stripe rust" OR "yellow rust" OR "Puccinia striiformis"'),
    ('wheat', 'leaf (brown) rust', '"leaf rust" AND wheat AND "Puccinia triticina"'),
    ('wheat', 'stem rust', '"stem rust" AND wheat'),
    ('wheat', 'Karnal bunt', '"Karnal bunt" OR "Tilletia indica"'),
    ('wheat', 'powdery mildew', '"powdery mildew" AND wheat AND "Blumeria graminis"'),
    ('wheat', 'spot blotch', '"spot blotch" AND wheat'),
    ('wheat', 'loose smut', '"loose smut" AND wheat'),
    ('wheat', 'Fusarium head blight', '"Fusarium head blight" AND wheat'),
    ('wheat', 'aphids', 'aphid AND wheat AND (damage OR yield)'),
    ('potato', 'late blight', '"late blight" AND "Phytophthora infestans" AND potato'),
    ('potato', 'early blight', '"early blight" AND Alternaria AND potato'),
    ('potato', 'black scurf', '"black scurf" OR ("Rhizoctonia solani" AND potato)'),
    ('potato', 'common scab', '"common scab" AND potato'),
    ('potato', 'bacterial wilt', '"bacterial wilt" AND potato AND Ralstonia'),
    ('potato', 'potato virus Y / leaf roll', '("potato virus Y" OR "potato leafroll virus")'),
    ('maize', 'northern leaf blight', '"northern leaf blight" AND maize'),
    ('maize', 'gray leaf spot', '"gray leaf spot" AND maize'),
    ('maize', 'common rust', '"common rust" AND maize AND "Puccinia sorghi"'),
    ('maize', 'southern leaf blight', '"southern corn leaf blight" OR "southern leaf blight"'),
    ('maize', 'banded leaf and sheath blight', '"banded leaf and sheath blight" OR ("Rhizoctonia solani" AND maize)'),
    ('maize', 'downy mildew', '"downy mildew" AND maize'),
    ('maize', 'fall armyworm', '"fall armyworm" AND maize AND Spodoptera'),
    ('maize', 'stalk rot', '"stalk rot" AND maize'),
]
CAT = {
    'symptoms': r'\b(symptoms?|lesions?|chlorotic|chlorosis|necrotic|necrosis|pustules?|streaks?|stripes?|spots?|wilting|yellowing|rolled|dead heart|whiteheads?|galls?|mosaic|stunt(ed|ing)?)\b',
    'conditions': r'(\b(temperature|humidity|rainfall|rain|wet|dew|moisture|favou?r\w*|conducive|cool|warm|humid|drought|nitrogen|dense planting)\b|°\s?C)',
    'stage': r'\b(seedling|tillering|panicle|heading|booting|flowering|anthesis|grain filling|milk stage|vegetative|reproductive|tuberization|silking|maturity|nursery|jointing)\b',
    'loss': r'(yield loss|losses|reduc\w+ (the )?yield|\b\d{1,3}(\.\d)?\s?%)',
}
LIMIT = {'symptoms': 8, 'conditions': 8, 'stage': 4, 'loss': 3}
MOLECULAR = re.compile(r'\b(gene|genes|QTL|allele|transcript\w*|protein|proteins|genom\w+|expression|mutant\w*|effector\w*)\b', re.I)


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'crop-research-script'})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def search(term, review=True):
    q = f'({term}) AND (symptoms OR epidemiology OR "disease management" OR "life cycle" OR damage) AND OPEN_ACCESS:y AND LICENSE:"cc by"'
    if review:
        q += ' AND (PUB_TYPE:"review-article" OR TITLE:review)'
    url = BASE + '/search?' + urllib.parse.urlencode({'query': q, 'format': 'json', 'resultType': 'core', 'pageSize': 10, 'sort': 'RELEVANCE'})
    raw = get(url)
    if not raw:
        return []
    return [r for r in json.loads(raw)['resultList']['result'] if (r.get('license') or '').lower() == 'cc by' and r.get('pmcid')]


def sentences(pmcid):
    raw = get(f'{BASE}/{pmcid}/fullTextXML')
    if not raw:
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    body = root.find('.//body')
    if body is None:
        return []
    out = []

    def walk(node, title=''):
        for ch in node:
            if ch.tag == 'sec':
                t = ch.find('title')
                walk(ch, ''.join(t.itertext()).strip() if t is not None else title)
            elif ch.tag == 'p':
                txt = re.sub(r'\s+', ' ', ''.join(ch.itertext())).strip()
                for s in re.split(r'(?<=[.!?])\s+(?=[A-Z])', txt):
                    if 50 <= len(s) <= 420:
                        out.append((title, s))
    walk(body)
    return out


def main():
    rows = []
    for crop, disease, term in TARGETS:
        arts = search(term)[:3]
        if len(arts) < 2:
            seen = {x['pmcid'] for x in arts}
            arts = (arts + [a for a in search(term, review=False) if a['pmcid'] not in seen])[:3]
        print(f'{crop} / {disease}: {len(arts)} articles', [a['pmcid'] for a in arts], flush=True)
        picked = {k: 0 for k in CAT}
        words = [w for w in re.findall(r'[A-Za-z]{5,}', disease + ' ' + term.replace('"', '')) if w.upper() not in ('AND', 'WHEAT', 'MAIZE', 'POTATO', 'DAMAGE')][:6]
        name_re = re.compile('|'.join(re.escape(w) for w in words), re.I)
        generic = re.compile(r'\b(the|this) (disease|pathogen|fungus|pest|insect|virus|bacterium|rust)\b', re.I)
        for a in arts:
            for sec, s in sentences(a['pmcid']):
                if not (name_re.search(s) or generic.search(s)) or MOLECULAR.search(s):
                    continue
                for k, pat in CAT.items():
                    if picked[k] < LIMIT[k] and re.search(pat, s, re.I):
                        picked[k] += 1
                        rows.append([crop, disease, k, a['pmcid'], a.get('pubYear'), a['title'][:140], 'CC BY', sec[:60], s])
                        break
            time.sleep(0.3)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['crop', 'disease', 'category', 'pmcid', 'year', 'title', 'licence', 'section', 'sentence'])
        w.writerows(rows)
    print('rows', len(rows))


if __name__ == '__main__':
    main()
