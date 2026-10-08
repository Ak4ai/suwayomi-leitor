"""Download the pinned official server JAR and verify its release checksum."""
import hashlib
import json
import shutil
from pathlib import Path

import httpx

root = Path(__file__).resolve().parent.parent / '.local-server'
version = 'v2.4.2366'
expected = 'af9feb20af9d7ebe9e30769e6c6ebc7fc7ab1c447388d42e0280b1da5fe07bfd'
name = f'Suwayomi-Server-{version}.jar'
url = f'https://github.com/Suwayomi/Suwayomi-Server/releases/download/{version}/{name}'
target = root / 'bin' / name
for directory in ['bin', 'data', 'logs']:
    (root / directory).mkdir(parents=True, exist_ok=True)

def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

if not target.exists() or digest(target) != expected:
    temporary = target.with_suffix('.jar.part')
    with httpx.stream('GET', url, follow_redirects=True, timeout=180) as response:
        response.raise_for_status()
        total = 0
        announced = 0
        with temporary.open('wb') as stream:
            for chunk in response.iter_bytes(1024 * 1024):
                stream.write(chunk)
                total += len(chunk)
                if total // (25 * 1024 * 1024) > announced:
                    announced = total // (25 * 1024 * 1024)
                    print(f'Download: {total / 1024 / 1024:.0f} MiB', flush=True)
    actual = digest(temporary)
    if actual != expected:
        raise RuntimeError(f'Checksum mismatch: {actual}')
    temporary.replace(target)

(root / 'installation.json').write_text(json.dumps({
    'version': version, 'url': url, 'sha256': expected,
    'jar': str(target), 'data': str(root / 'data'),
}, indent=2), encoding='utf-8')
print(f'Verified official server: {target}', flush=True)

config = root / 'data/server.conf'
if not config.exists():
    config.write_text('''server.ip = "127.0.0.1"
server.port = 4567
server.initialOpenInBrowserEnabled = false
server.systemTrayEnabled = false
server.webUIEnabled = true
server.webUIChannel = BUNDLED
server.webUIUpdateCheckInterval = 0
server.kcefEnabled = false
''', encoding='utf-8')

project = root.parent
samples = [
    ('Amostra IHC - OCR ingles', 'Capitulo 01 - pagina de referencia', [(project.parent / 'imagensinputteste/7.jpg', '001.jpg')], 'Pagina de referencia fornecida para o teste de OCR.'),
    ('Ultimate Spider-Man - amostra salva', 'Amostra do numero 133 - paginas disponiveis', [(image, f'{int(image.stem.rsplit("-", 1)[1]):03}.jpg') for image in sorted((project / 'ocr-runs').glob('chapter-134-page-*.jpg'))], 'Amostra parcial: somente as paginas salvas durante o teste no Fly.io, nao a edicao completa.'),
]
for title, chapter, images, description in samples:
    valid = [(source, name) for source, name in images if source.exists()]
    if not valid:
        continue
    directory = root / 'data/local' / title / chapter
    directory.mkdir(parents=True, exist_ok=True)
    for source, page_name in valid:
        destination = directory / page_name
        if not destination.exists():
            shutil.copy2(source, destination)
    details = directory.parent / 'details.json'
    if not details.exists():
        details.write_text(json.dumps({'title': title, 'description': description}, indent=2), encoding='utf-8')
    print(f'Local sample: {title}, {len(valid)} pages', flush=True)
