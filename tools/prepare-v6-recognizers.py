"""Download original PaddlePaddle ONNX bundles and matching dictionaries."""
import concurrent.futures
import hashlib
import io
import json
import tarfile
from pathlib import Path

import httpx
import onnxruntime as ort

root = Path(__file__).resolve().parent.parent
target = root / '.ocr-models/experimental/v6'
target.mkdir(parents=True, exist_ok=True)

def download(tier):
    bundle_url = f'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_{tier}_rec_onnx_infer.tar'
    dictionary = 'ppocrv6_tiny_dict.txt' if tier == 'tiny' else 'ppocrv6_dict.txt'
    dict_url = f'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/{dictionary}'
    with httpx.Client(timeout=180, follow_redirects=True) as client:
        response = client.get(bundle_url)
        response.raise_for_status()
        archive_bytes = response.content
        with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
            members = [m for m in archive.getmembers() if m.isfile() and m.name.endswith('.onnx')]
            if len(members) != 1:
                raise RuntimeError(f'Expected one ONNX model: {[m.name for m in members]}')
            model_bytes = archive.extractfile(members[0]).read()
        response = client.get(dict_url)
        response.raise_for_status()
        dict_bytes = response.content
    model_path = target / f'{tier}.onnx'
    model_path.write_bytes(model_bytes)
    (target / f'{tier}-dict.txt').write_bytes(dict_bytes)
    session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
    spec = {
        'tier': tier, 'url': bundle_url, 'dictionaryUrl': dict_url,
        'archiveSha256': hashlib.sha256(archive_bytes).hexdigest(),
        'sha256': hashlib.sha256(model_bytes).hexdigest(), 'bytes': len(model_bytes),
        'dictionarySha256': hashlib.sha256(dict_bytes).hexdigest(),
        'dictionaryLines': len(dict_bytes.decode('utf-8').splitlines()),
        'inputs': [{'name': v.name, 'shape': v.shape, 'type': v.type} for v in session.get_inputs()],
        'outputs': [{'name': v.name, 'shape': v.shape, 'type': v.type} for v in session.get_outputs()],
    }
    print(json.dumps(spec), flush=True)
    return spec

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    specs = list(pool.map(download, ['tiny', 'small']))
(root / 'ocr-runs/v6-models.json').write_text(json.dumps(specs, indent=2), encoding='utf-8')
