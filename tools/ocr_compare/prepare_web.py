"""One-time manifest generation. The deployed browser does not require Python."""
import hashlib
import json
from pathlib import Path
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / '.ocr-models'
options = ort.SessionOptions()
options.intra_op_num_threads = 2
model = ort.InferenceSession(str(MODELS/'paddle/en_PP-OCRv5_rec_mobile.onnx'),sess_options=options)
characters = ['', *model.get_modelmeta().custom_metadata_map['character'].splitlines(), ' ']
assert len(characters) == model.get_outputs()[0].shape[-1]
names = {'detector':('rtdetr.onnx','rtdetr.onnx'), 'lines':('lines.onnx','paddle/ch_PP-OCRv5_det_mobile.onnx'),
         'recognizer':('recognizer.onnx','paddle/en_PP-OCRv5_rec_mobile.onnx')}
manifest = {'schemaVersion':1,'pipelineVersion':'web-1','runtimeVersion':'1.30.0','characters':characters,'models':{}}
for role,(name,local) in names.items():
    data = (MODELS/local).read_bytes()
    manifest['models'][role] = {'url':f'./models/{name}','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
target = ROOT/'public/ocr-web/models.json'
target.parent.mkdir(exist_ok=True,parents=True)
target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Manifest generated: {len(characters)} CTC symbols, 3 models.')
