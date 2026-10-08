"""Score manually transcribed punctuation examples; no chapter-wide accuracy claim."""
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'ocr-runs/sorcerer-supreme-1'
def read(path):
    return json.loads(path.read_text(encoding='utf-8'))
def normalized(text):
    return re.sub(r'\s+', '', text.upper()).replace('“', '"').replace('”', '"').replace('…', '...')
def distance(a, b):
    row = list(range(len(b)+1))
    for i, ca in enumerate(a, 1):
        nxt = [i]
        for j, cb in enumerate(b, 1):
            nxt.append(min(nxt[-1]+1, row[j]+1, row[j-1]+(ca != cb)))
        row = nxt
    return row[-1]
reference = read(ROOT / 'tools/fixtures/sorcerer-punctuation-reference.json')
ct = read(RUN / 'comic-translate-comparison.json')
methods = {name:{} for name in ['browser','same_boxes_upstream_resize','comic_translate','fragment','fragment_padding','fragment_targeted']}
for page in ct['pages']:
    for segment in page['segments']:
        for name in ['browser','same_boxes_upstream_resize','comic_translate']:
            methods[name][(page['page'],segment['id'])] = segment[name]
for name,filename in [('fragment','fragment-comparison.json'),('fragment_padding','fragment-padding-comparison.json'),('fragment_targeted','fragment-targeted-comparison.json')]:
    for page in read(RUN / filename):
        for segment in page['result']['segments']:
            methods[name][(page['page'],segment['id'])] = segment['sourceText']
rows = []
for ref in reference:
    rows.append({**ref,'outputs':{name:values[(ref['page'],ref['id'])] for name,values in methods.items()}})
scores = {}
for name in methods:
    errors = sum(distance(normalized(row['text']),normalized(row['outputs'][name])) for row in rows)
    chars = sum(len(normalized(row['text'])) for row in rows)
    scores[name] = {'characterErrors':errors,'referenceCharacters':chars,'CER':errors/chars,
                    'exactExamples':sum(normalized(row['text'])==normalized(row['outputs'][name]) for row in rows)}
report = {'reference':'8 visually transcribed examples, selected for punctuation problems; spaces ignored, punctuation counted','scores':scores,'examples':rows}
(RUN / 'punctuation-metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(scores,indent=2))
