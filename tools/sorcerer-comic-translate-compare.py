"""Compare saved browser OCR against pinned Comic Translate line processing.

Uses identical local ONNX weights and upstream imkit/DB/preprocessing helpers;
keeps the browser's text-region boxes to isolate line extraction/recognition.
No translation API calls. Run with .venv-ocr/Scripts/python.exe.
"""
import ast
import hashlib
import importlib.util
import json
import sys
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'ocr-runs/sorcerer-supreme-1'
UP = RUN / 'upstream'
COMMIT = '8977b91a4f7a40c3917c5a268e9e7d78e1d818da'
FILES = [f'imkit/{name}.py' for name in ['__init__', 'analysis', 'io', 'morphology', 'transforms', 'utils']] + [
    'modules/ocr/ppocr/preprocessing.py', 'modules/ocr/ppocr/postprocessing.py',
    'modules/ocr/ppocr/engine.py', 'modules/detection/ppocr_lines.py',
]
for name in FILES:
    path = UP / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/ogkalu2/comic-translate/{COMMIT}/{name}').read())
sys.path.insert(0, str(UP))

def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, UP / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

pre = load('ct_pre', 'modules/ocr/ppocr/preprocessing.py')
post = load('ct_post', 'modules/ocr/ppocr/postprocessing.py')

def helpers(relative):
    """Load upstream pure helpers without importing the desktop application."""
    tree = ast.parse((UP / relative).read_text(encoding='utf-8'))
    body = [ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)]
    body += [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    namespace = {'np': np, 'crop_quad': pre.crop_quad}
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(UP / relative), 'exec'), namespace)
    return namespace

line_helpers = helpers('modules/detection/ppocr_lines.py')
rec_helpers = helpers('modules/ocr/ppocr/engine.py')
options = ort.SessionOptions()
options.intra_op_num_threads = 4
options.inter_op_num_threads = 1
options.log_severity_level = 3
det = ort.InferenceSession(str(ROOT / '.ocr-models/paddle/ch_PP-OCRv5_det_mobile.onnx'), options, providers=['CPUExecutionProvider'])
rec = ort.InferenceSession(str(ROOT / '.ocr-models/paddle/en_PP-OCRv5_rec_mobile.onnx'), options, providers=['CPUExecutionProvider'])
characters = json.loads((ROOT / 'public/ocr-web/models.json').read_text(encoding='utf-8'))['characters']
decoder = post.CTCLabelDecoder(charset=characters[1:])
db = post.DBPostProcessor(thresh=.3, box_thresh=.5, unclip_ratio=2.0, use_dilation=False)

def recognize(image, boxes):
    texts = []
    for box in boxes:
        crop = rec_helpers['_crop_line'](image, box, False)
        if crop is None or not crop.size:
            continue
        target = rec_helpers['_rec_target_width'](crop)
        tensor = pre.rec_resize_norm(crop, (3, 48, 320), target / 48)[None]
        output = rec.run(None, {rec.get_inputs()[0].name: tensor})[0]
        text, confidence = decoder(output, prob_threshold=0.0)
        texts.append({'text': text[0], 'confidence': float(confidence[0]), 'box': box})
    return texts

report = {'commit': COMMIT, 'scope': 'same text boxes; upstream full-page line detector and preprocessing; no desktop GUI', 'pages': []}
for number in [7, 12, 17, 18, 23, 24]:
    baseline = json.loads((RUN / f'{number:03}.json').read_text(encoding='utf-8'))['result']
    image = np.asarray(Image.open(RUN / f'{number:03}.jpg').convert('RGB'))
    started = time.perf_counter()
    tensor = pre.det_preprocess(image, limit_side_len=960, limit_type='min')
    pred = det.run(None, {det.get_inputs()[0].name: tensor})[0]
    quads, _ = db(pred, image.shape[:2])
    boxes = line_helpers['_merge_line_boxes']([line_helpers['_axis_box'](quad) for quad in quads], image.shape[1], image.shape[0])
    blocks = [SimpleNamespace(xyxy=s['box']) for s in baseline['segments']]
    groups = [[] for _ in blocks]
    for box in boxes:
        if line_helpers['_is_usable_line'](box, image.shape[1], image.shape[0]):
            index = line_helpers['_best_block_for_line'](box, blocks, image.shape[1], image.shape[0])
            if index >= 0:
                groups[index].append(box)
    detection_ms = (time.perf_counter() - started) * 1000
    rows = []
    for segment, group in zip(baseline['segments'], groups):
        group = line_helpers['_sort_lines'](group, 'horizontal') or [segment['box']]
        ct = recognize(image, group)
        # Control: same browser line boxes, upstream resize/interpolation only.
        control = recognize(image, [line['box'] for line in segment['lines']])
        rows.append({'id': segment['id'], 'box': segment['box'], 'browser': segment['sourceText'],
                     'same_boxes_upstream_resize': '\n'.join(line['text'] for line in control),
                     'comic_translate': '\n'.join(line['text'] for line in ct), 'lines': ct})
    report['pages'].append({'page': number, 'detectorMs': detection_ms, 'totalPythonMs': (time.perf_counter() - started) * 1000, 'segments': rows})
    print(json.dumps({'page': number, 'segments': len(rows), 'detectorMs': round(detection_ms)}, ensure_ascii=True), flush=True)
report['sourceHashes'] = {name: hashlib.sha256((UP / name).read_bytes()).hexdigest() for name in FILES}
(RUN / 'comic-translate-comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
