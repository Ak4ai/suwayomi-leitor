"""Local-only comparison server. Raw image bodies, no arbitrary path/URL inputs."""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from engines import ROOT, MODELS, run

LOCK = threading.Lock()
ASSETS = {'/':('index.html','text/html'), '/compare.js':('compare.js','text/javascript'),
          '/metrics.js':('metrics.js','text/javascript'), '/style.css':('style.css','text/css')}


def configured():
    paddle = (MODELS / 'manifest.json').exists()
    return [
        {'id':'tesseract','name':'Tesseract.js 6 · página inteira','ready':True,'kind':'browser'},
        {'id':'paddle','name':'PP-OCRv5 · RapidOCR/ONNX','ready':paddle,'kind':'local'},
        {'id':'comic','name':'Detector Comic Translate + PP-OCRv5','ready':paddle and (MODELS/'rtdetr.onnx').exists(),'kind':'local'},
        {'id':'ctd','name':'Detector CTD (manga-image-translator) + PP-OCRv5','ready':paddle and (MODELS/'ctd.onnx').exists(),'kind':'local'},
        {'id':'vision-text','name':'Google Vision · TEXT_DETECTION','ready':bool(os.environ.get('GOOGLE_VISION_API_KEY')),'kind':'cloud'},
        {'id':'vision-document','name':'Google Vision · DOCUMENT_TEXT_DETECTION','ready':bool(os.environ.get('GOOGLE_VISION_API_KEY')),'kind':'cloud'},
        {'id':'gemini','name':'Gemini · transcrição da imagem','ready':bool(os.environ.get('GEMINI_API_KEY') and os.environ.get('GEMINI_MODEL')),'kind':'cloud'},
    ]


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        # Host and Origin checks prevent arbitrary websites from triggering local/cloud jobs.
        hosts = ('127.0.0.1:3002','localhost:3002')
        return self.headers.get('Host') in hosts and self.headers.get('Origin') in (None,*(f'http://{h}' for h in hosts))

    def json(self, status, data):
        raw = json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):
            pass

    def do_GET(self):
        if not self.allowed():
            self.json(403,{'error':'Origem não permitida.'}); return
        path = urlsplit(self.path).path
        if path == '/api/methods':
            self.json(200,configured()); return
        if path not in ASSETS:
            self.json(404,{'error':'Não encontrado.'}); return
        name,mime = ASSETS[path]
        raw = (ROOT/'public'/'ocr-compare'/name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',mime+'; charset=utf-8')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        self.connection.settimeout(180)
        if not self.allowed() or self.headers.get('X-OCR-Compare') != '1':
            self.json(403,{'error':'Origem não permitida.'}); return
        method = urlsplit(self.path).path.removeprefix('/api/run/')
        available = {m['id']:m for m in configured() if m['kind'] != 'browser'}
        if method not in available or not self.path.startswith('/api/run/'):
            self.json(404,{'error':'Método desconhecido.'}); return
        if not available[method]['ready']:
            self.json(409,{'error':'Método não configurado; consulte OCR-COMPARISON.md.'}); return
        if available[method]['kind'] == 'cloud' and self.headers.get('X-Allow-Cloud') != '1':
            self.json(403,{'error':'Habilite o envio à nuvem no comparador.'}); return
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > 15*1024*1024:
                self.json(413,{'error':'Limite: 15 MB.'}); return
            if not LOCK.acquire(blocking=False):
                self.json(429,{'error':'Há outro processamento em andamento. Aguarde.'}); return
            try:
                raw = self.rfile.read(length)
                result = run(method,raw)
            finally:
                LOCK.release()
            self.json(200,result)
        except Exception as error:
            # Avoid logging provider requests/keys or image data.
            message = str(error) if isinstance(error,ValueError) else f'Falha no processamento ({type(error).__name__}). Consulte instalação/modelos.'
            self.json(400,{'error':message})


if __name__ == '__main__':
    print('Comparador OCR: http://127.0.0.1:3002',flush=True)
    ThreadingHTTPServer(('127.0.0.1',3002),Handler).serve_forever()
