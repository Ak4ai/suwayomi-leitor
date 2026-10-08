"""Explicit model download; run once before starting the comparison server."""
import hashlib
import json
from pathlib import Path
import httpx
from engines import MODELS, rapid, session

SOURCES = {
    'rtdetr.onnx': 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/16e8a62/detector-v4-s_int8.onnx',
    'ctd.onnx': 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.2.1/comictextdetector.pt.onnx',
}


def main():
    MODELS.mkdir(exist_ok=True)
    for name, url in SOURCES.items():
        path = MODELS / name
        if not path.exists():
            print(f'Downloading {name}', flush=True)
            temporary = path.with_suffix('.download')
            with httpx.stream('GET',url,follow_redirects=True,timeout=120) as response:
                response.raise_for_status()
                with temporary.open('wb') as file:
                    for chunk in response.iter_bytes():
                        file.write(chunk)
            temporary.replace(path)
        model = session(name)
        print(name,[(i.name,i.shape) for i in model.get_inputs()],flush=True)
    rapid()
    manifest = []
    for path in sorted(MODELS.rglob('*.onnx')):
        manifest.append({'file':str(path.relative_to(MODELS)), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                         'source':SOURCES.get(path.name,'RapidOCR 3.9.2 model registry; PP-OCRv5 configuration')})
    (MODELS / 'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('Models ready; hashes saved in .ocr-models/manifest.json',flush=True)


if __name__ == '__main__':
    main()
