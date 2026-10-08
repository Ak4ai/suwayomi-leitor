"""Create an experimental model without replacing reader assets."""
import hashlib
import json
from pathlib import Path

import onnx
from onnxconverter_common import float16

root = Path(__file__).resolve().parent.parent
source = root / '.ocr-models/paddle/en_PP-OCRv5_rec_mobile.onnx'
target = root / '.ocr-models/experimental/recognizer-fp16.onnx'
target.parent.mkdir(parents=True, exist_ok=True)
model = onnx.load(source)
converted = float16.convert_float_to_float16(model, keep_io_types=True, min_positive_val=0.0, max_finite_val=65504.0)
onnx.checker.check_model(converted)
onnx.save(converted, target)
report = {
    'sourceBytes': source.stat().st_size,
    'targetBytes': target.stat().st_size,
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'targetSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'keepIoTypes': True,
    'minPositiveVal': 0.0,
    'maxFiniteVal': 65504.0,
    'fp16Initializers': sum(t.data_type == onnx.TensorProto.FLOAT16 for t in converted.graph.initializer),
    'fp32Initializers': sum(t.data_type == onnx.TensorProto.FLOAT for t in converted.graph.initializer),
}
(root / 'ocr-runs/fp16-conversion.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
