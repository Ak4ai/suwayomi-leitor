"""OCR adapters. Detector weights are upstream; postprocessing here is an experiment,
not a reproduction of the complete Comic Translate / manga-image-translator apps.
"""
import base64
import hashlib
import io
import importlib.metadata
import json
import os
import re
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from rapidocr import RapidOCR, OCRVersion, ModelType, LangRec

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / '.ocr-models'
_ocr = None
_sessions = {}


def rapid():
    global _ocr
    if _ocr is None:
        _ocr = RapidOCR(params={
            'Global.model_root_dir': str(MODELS / 'paddle'),
            'Global.log_level': 'error',
            'Det.ocr_version': OCRVersion.PPOCRV5, 'Det.model_type': ModelType.MOBILE,
            'Rec.ocr_version': OCRVersion.PPOCRV5, 'Rec.model_type': ModelType.MOBILE, 'Rec.lang_type': LangRec.EN,
            'EngineConfig.onnxruntime.intra_op_num_threads': 4,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
        })
    return _ocr


def session(name):
    if name not in _sessions:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        _sessions[name] = ort.InferenceSession(str(MODELS / name), sess_options=options, providers=['CPUExecutionProvider'])
    return _sessions[name]


def decode(raw):
    if len(raw) > 15 * 1024 * 1024:
        raise ValueError('Limite: 15 MB por imagem.')
    image = Image.open(io.BytesIO(raw))
    if image.format not in ('PNG', 'JPEG', 'WEBP') or image.width * image.height > 25_000_000:
        raise ValueError('Use PNG/JPEG/WebP com até 25 milhões de pixels.')
    return ImageOps.exif_transpose(image).convert('RGB')


def bounded(box, width, height):
    x1, y1, x2, y2 = map(float, box)
    return [max(0, min(width, round(x1))), max(0, min(height, round(y1))),
            max(0, min(width, round(x2))), max(0, min(height, round(y2)))]


def nms(regions, threshold=0.4):
    if not regions:
        return []
    boxes = [[x1, y1, x2-x1, y2-y1] for x1,y1,x2,y2 in [r['box'] for r in regions]]
    indices = cv2.dnn.NMSBoxes(boxes, [r['score'] for r in regions], 0.3, threshold)
    return [regions[int(i)] for i in np.asarray(indices).flatten()]


def rtdetr(image):
    model = session('rtdetr.onnx')
    arr = np.asarray(image.resize((640, 640)), dtype=np.float32) / 255
    labels, boxes, scores = model.run(None, {
        'images': arr.transpose(2, 0, 1)[None],
        'orig_target_sizes': np.array([image.size], dtype=np.int64),
    })[:3]
    regions = []
    for label, box, score in zip(labels.reshape(-1), boxes.reshape(-1, 4), scores.reshape(-1)):
        if int(label) in (1, 2) and float(score) >= 0.3:
            regions.append({'box': bounded(box, *image.size), 'score': float(score), 'label': int(label)})
    return nms(regions)


def ctd(image):
    model = session('ctd.onnx')
    width, height = image.size
    size = 1024
    scale = min(size/width, size/height)
    # Upstream's letterbox pads on the right/bottom, not symmetrically.
    resized = image.resize((round(width*scale), round(height*scale)))
    padded = Image.new('RGB', (size, size), (114,114,114))
    padded.paste(resized, (0,0))
    data = np.asarray(padded, dtype=np.float32).transpose(2,0,1)[None] / 255
    outputs = model.run(None, {model.get_inputs()[0].name: data})
    predictions = next(o for o in outputs if o.ndim == 3 and o.shape[-1] >= 6)[0]
    regions = []
    for row in predictions:
        score = float(row[4] * max(row[5:]))
        if score < 0.4:
            continue
        cx,cy,w,h = row[:4]
        box = [(cx-w/2)/scale,(cy-h/2)/scale,(cx+w/2)/scale,(cy+h/2)/scale]
        regions.append({'box': bounded(box,width,height), 'score': score})
    return nms(regions, 0.35)


def recognize(image, offset=(0,0)):
    output = rapid()(np.asarray(image)[:,:,::-1].copy(), use_cls=False)
    if output.txts is None:
        return []
    results = []
    for text, score, box in zip(output.txts, output.scores, output.boxes):
        points = np.asarray(box)
        results.append({'text': text, 'confidence': float(score), 'box': [
            float(points[:,0].min()+offset[0]), float(points[:,1].min()+offset[1]),
            float(points[:,0].max()+offset[0]), float(points[:,1].max()+offset[1])]})
    return results


def cloud(method, raw, image):
    if method.startswith('vision-'):
        key = os.environ.get('GOOGLE_VISION_API_KEY')
        if not key:
            raise ValueError('Configure GOOGLE_VISION_API_KEY no servidor.')
        feature = 'TEXT_DETECTION' if method == 'vision-text' else 'DOCUMENT_TEXT_DETECTION'
        response = httpx.post('https://vision.googleapis.com/v1/images:annotate',
            headers={'X-Goog-Api-Key': key}, timeout=120,
            json={'requests':[{'image':{'content':base64.b64encode(raw).decode()},
                  'features':[{'type':feature}], 'imageContext':{'languageHints':['en']}}]})
        if response.status_code != 200:
            raise ValueError(f'Cloud Vision retornou HTTP {response.status_code}. Verifique chave, API e cota.')
        item = response.json()['responses'][0]
        if 'error' in item:
            raise ValueError('Cloud Vision não processou a imagem; verifique permissões/cota.')
        regions = []
        for annotation in item.get('textAnnotations', [])[1:]:
            vertices = annotation.get('boundingPoly',{}).get('vertices',[])
            if vertices:
                regions.append({'text':annotation['description'], 'box':[
                    min(v.get('x',0) for v in vertices),min(v.get('y',0) for v in vertices),
                    max(v.get('x',0) for v in vertices),max(v.get('y',0) for v in vertices)]})
        fallback = item.get('textAnnotations',[{}])[0].get('description','') if item.get('textAnnotations') else ''
        return {'text':item.get('fullTextAnnotation',{}).get('text',fallback), 'regions':regions,
                'model':f'Cloud Vision {feature}', 'notes':'Ordem fornecida pelo serviço; regiões são palavras.'}
    key, model = os.environ.get('GEMINI_API_KEY'), os.environ.get('GEMINI_MODEL')
    if not key or not model or not re.fullmatch(r'[a-zA-Z0-9._-]+',model):
        raise ValueError('Configure GEMINI_API_KEY e GEMINI_MODEL (ID de modelo disponível na sua conta).')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    response = httpx.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        headers={'X-Goog-Api-Key':key}, timeout=120, json={
            'contents':[{'parts':[{'text':'Transcribe all visible English text verbatim. Do not translate, summarize, correct, or invent text. Preserve line breaks and approximate reading order. Return only the transcription, without markdown.'},
                       {'inline_data':{'mime_type':'image/png','data':base64.b64encode(buffer.getvalue()).decode()}}]}],
            'generationConfig':{'temperature':0}})
    if response.status_code != 200:
        raise ValueError(f'Gemini retornou HTTP {response.status_code}. Verifique modelo, chave e cota.')
    candidates = response.json().get('candidates',[])
    if not candidates:
        raise ValueError('Gemini não retornou transcrição.')
    if candidates[0].get('finishReason') != 'STOP':
        raise ValueError('Gemini retornou conteúdo incompleto ou bloqueado; resultado não pontuado.')
    text = '\n'.join(p.get('text','') for p in candidates[0].get('content',{}).get('parts',[]) if not p.get('thought'))
    return {'text':text, 'regions':[], 'model':model, 'notes':'Transcrição multimodal; sem coordenadas. Verifique omissões e alterações.'}


def run(method, raw):
    start = time.perf_counter()
    loaded_before = {'paddle':_ocr is not None, 'detectors':list(_sessions)}
    image = decode(raw)
    if method in ('vision-text','vision-document','gemini'):
        result = cloud(method,raw,image)
    else:
        if method == 'paddle':
            regions = recognize(image)
            model = 'PP-OCRv5 mobile det + en mobile rec / RapidOCR ONNX CPU'
        elif method in ('comic','ctd'):
            detections = rtdetr(image) if method == 'comic' else ctd(image)
            regions = []
            for detection in sorted(detections,key=lambda r:(r['box'][1],r['box'][0])):
                x1,y1,x2,y2 = detection['box']
                if x2-x1 < 3 or y2-y1 < 3:
                    continue
                lines = recognize(image.crop((x1,y1,x2,y2)),(x1,y1))
                regions.append({'box':detection['box'], 'text':'\n'.join(r['text'] for r in lines),
                                'detectionConfidence':detection['score'], 'lines':lines})
            model = ('Comic Translate RT-DETR-v2 detector-v4-s_int8' if method == 'comic' else 'dmMaze CTD beta-0.2.1 block detector') + ' + PP-OCRv5 (RapidOCR)'
        else:
            raise ValueError('Método desconhecido.')
        result = {'text':'\n\n'.join(r['text'] for r in regions), 'regions':regions, 'model':model,
                  'notes':'Ordem geométrica aproximada; não resolve sequência de quadros. Adaptação dos detectores, não execução dos aplicativos completos.'}
    result.update(method=method,elapsedMs=round((time.perf_counter()-start)*1000),
                  imageSha256=hashlib.sha256(raw).hexdigest(),width=image.width,height=image.height,
                  modelsLoadedBefore=loaded_before,
                  timingScope='Servidor: inicialização de modelos quando necessária + processamento; exclui upload.')
    if method in ('paddle','comic','ctd'):
        manifest_path = MODELS / 'manifest.json'
        result['modelManifest'] = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
        result['runtimeVersions'] = {name:importlib.metadata.version(name) for name in ('rapidocr','onnxruntime')}
    return result
