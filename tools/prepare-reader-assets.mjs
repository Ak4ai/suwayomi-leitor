import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const copies = [
    ...[
        'ort.webgpu.min.mjs',
        'ort-wasm-simd-threaded.jsep.mjs',
        'ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd-threaded.asyncify.mjs',
        'ort-wasm-simd-threaded.asyncify.wasm',
    ].map((name) => [`tools/ocr-web-runtime/node_modules/onnxruntime-web/dist/${name}`, `vendor/${name}`]),
    ['.ocr-models/rtdetr.onnx', 'models/rtdetr.onnx'],
    ['.ocr-models/paddle/ch_PP-OCRv5_det_mobile.onnx', 'models/lines.onnx'],
    ['.ocr-models/paddle/en_PP-OCRv5_rec_mobile.onnx', 'models/recognizer.onnx'],
];
if (existsSync(path.join(root, '.ocr-models/lama_512_int8.onnx')))
    copies.push(['.ocr-models/lama_512_int8.onnx', 'models/lama-512-int8.onnx']);
for (const [source, target] of copies) {
    const destination = path.join(root, 'public/ocr-web', target);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, source), destination);
}
console.log('Modelos e runtime preparados para o leitor nativo.');
