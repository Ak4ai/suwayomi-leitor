"""Prepare pinned OPUS-MT q8 weights and tokenizer for browser-only translation."""
import hashlib
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BIG='--big' in sys.argv
REPO='Douglasrambo/opus-mt-tc-big-en-pt-onnx' if BIG else 'Xenova/opus-mt-en-ROMANCE'
REVISION='738ee4cce801ce7c519954e4b78d02d5057b6740' if BIG else '9d2ba69ac80c8e8453c3d9a1e2323a0e7b8ca3cd'
FILES=['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','vocab.json','source.spm','target.spm','onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx']
metadata=json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true'))
entries={item['rfilename']:item for item in metadata['siblings']}
records=[]
for name in FILES:
    if name not in entries and name in ['vocab.json','source.spm','target.spm']:
        continue
    target=ROOT/'.ocr-models/translation'/REPO/name
    target.parent.mkdir(parents=True,exist_ok=True)
    entry=entries[name]
    def digest(path):
        with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
    expected=entry.get('lfs',{}).get('sha256')
    if not target.exists() or target.stat().st_size!=entry['size'] or (expected and digest(target)!=expected):
        temporary=target.with_suffix(target.suffix+'.download')
        for attempt in range(3):
            offset=temporary.stat().st_size if temporary.exists() else 0
            print(json.dumps({'file':name,'downloaded':offset,'total':entry['size'],'attempt':attempt+1}),flush=True)
            request=urllib.request.Request(f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}',headers={'Range':f'bytes={offset}-'} if offset else {})
            try:
                with urllib.request.urlopen(request,timeout=60) as response,temporary.open('ab' if offset and response.status==206 else 'wb') as output:
                    shutil.copyfileobj(response,output)
                break
            except (TimeoutError,OSError):
                if attempt==2:raise
                time.sleep(1)
        if temporary.stat().st_size!=entry['size'] or (expected and digest(temporary)!=expected):raise RuntimeError('Model verification failed: '+name)
        temporary.replace(target)
    destination=ROOT/'public/ocr-web/translation-models'/REPO/name
    destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(target,destination)
    records.append({'name':name,'bytes':target.stat().st_size,'sha256':digest(target)})
manifest={'id':REPO,'revision':REVISION,'target':'pt_BR','prefix':'>>pob<<' if BIG else '>>pt_BR<<','prefixPt':'>>por<<' if BIG else '>>pt<<','dtype':'q8','runtimeVersion':'3.8.1','files':records,'bytes':sum(item['bytes'] for item in records),'license':'CC-BY-4.0' if BIG else 'Apache-2.0','source':'https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-pt' if BIG else 'https://huggingface.co/Helsinki-NLP/opus-mt-en-ROMANCE'}
(ROOT/'public/ocr-web'/('translation-model-big.json' if BIG else 'translation-model.json')).write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'model':REPO,'bytes':manifest['bytes'],'files':len(records)}),flush=True)
