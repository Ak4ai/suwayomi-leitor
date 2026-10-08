import { mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)),
    target = path.join(root, 'public/ocr-web/translation-vendor');
await mkdir(target, { recursive: true });
await copyFile(
    path.join(root, 'tools/translation-runtime/node_modules/@huggingface/transformers/dist/transformers.min.js'),
    path.join(target, 'transformers.web.min.js'),
);
const runtime = path.join(root, 'tools/translation-runtime/node_modules/onnxruntime-web/dist');
for (const name of await readdir(runtime))
    if ((name.startsWith('ort-wasm-') && /\.(mjs|wasm)$/.test(name)) || name === 'ort.bundle.min.mjs')
        await copyFile(path.join(runtime, name), path.join(target, name));
console.log('Local Transformers.js browser runtime prepared.');
