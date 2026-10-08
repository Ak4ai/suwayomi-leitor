"""Fetch pinned optional browser model, verify SHA-256, and prepare static asset."""
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=json.loads((ROOT/'public/ocr-web/inpaint-model.json').read_text(encoding='utf-8'))
target=ROOT/'.ocr-models/lama_512_int8.onnx'
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()
if not target.exists() or digest(target)!=spec['sha256']:
    target.parent.mkdir(exist_ok=True)
    temporary=target.with_suffix('.download')
    with urllib.request.urlopen(spec['remoteUrl'],timeout=120) as response,temporary.open('wb') as output:
        shutil.copyfileobj(response,output)
    if temporary.stat().st_size!=spec['bytes'] or digest(temporary)!=spec['sha256']:
        raise RuntimeError('Model size/checksum mismatch; optional model not installed.')
    temporary.replace(target)
destination=ROOT/'public/ocr-web/models/lama-512-int8.onnx'
destination.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(target,destination)
print(f'Optional model ready: {target.name}, {target.stat().st_size/1e6:.1f} MB; SHA-256 verified.')
