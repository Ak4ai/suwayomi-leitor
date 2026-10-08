import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {handleTranslationRelay} from './translation-relay.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port=Number(process.argv.find(value=>value.startsWith('--port='))?.split('=')[1]||3003);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const ui = path.join(root, 'public/ocr-web');
const runtime = path.join(root, 'tools/ocr-web-runtime/node_modules/onnxruntime-web/dist');
const files = new Map();
for (const name of await readdir(ui)) if (/\.(html|css|js|json|ttf|txt)$/.test(name)) files.set(`/${name}`, path.join(ui, name));
files.set('/', path.join(ui,'index.html'));
for (const name of ['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm','ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm']) {
    files.set(`/vendor/${name}`, path.join(runtime,name));
}
for (const [name, local] of Object.entries({
    'rtdetr.onnx':'rtdetr.onnx',
    'lines.onnx':'paddle/ch_PP-OCRv5_det_mobile.onnx',
    'recognizer.onnx':'paddle/en_PP-OCRv5_rec_mobile.onnx',
})) files.set(`/models/${name}`, path.join(root,'.ocr-models',local));
const lama=path.join(root,'.ocr-models/lama_512_int8.onnx');
if(existsSync(lama))files.set('/models/lama-512-int8.onnx',lama);
async function registerFolder(folder,prefix){
    if(!existsSync(folder))return;
    for(const entry of await readdir(folder,{withFileTypes:true})){const filename=path.join(folder,entry.name),url=`${prefix}/${entry.name}`;if(entry.isDirectory())await registerFolder(filename,url);else files.set(url,filename);}
}
await registerFolder(path.join(ui,'translation-vendor'),'/translation-vendor');
await registerFolder(path.join(ui,'translation-models'),'/translation-models');

const missing = [...files.values()].filter(file => !existsSync(file));
if (missing.length) {
    console.error('Faltam recursos locais. Consulte OCR-WEB.md.\n' + missing.join('\n'));
    process.exit(1);
}
if (process.argv.includes('--export')) {
    const target = path.join(root,'ocr-web-dist');
    for (const [url, source] of files) {
        if (url === '/') continue;
        const destination = path.join(target,url.slice(1));
        await mkdir(path.dirname(destination),{recursive:true});
        await copyFile(source,destination);
    }
    console.log(`Exportado para ${target}. Sirva esta pasta por HTTPS ou localhost.`);
} else {
    const mime = {'.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.onnx':'application/octet-stream'};
    const server = createServer(async (request,response) => {
        if(await handleTranslationRelay(request,response))return;
        const url = new URL(request.url, 'http://localhost');
        const name = files.get(url.pathname);
        const clientIp = request.socket.remoteAddress;
        if (!['GET','HEAD'].includes(request.method) || !name) {
            console.log(`[404] ${request.method} ${url.pathname} from ${clientIp}`);
            response.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
            return;
        }
        try {
            const size = (await stat(name)).size;
            response.writeHead(200, {
                'Content-Type': mime[path.extname(name)] || 'application/octet-stream',
                'Content-Length': size,
                'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff',
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'require-corp',
                'Access-Control-Allow-Origin': '*'
            });
            console.log(`[200] ${request.method} ${url.pathname} from ${clientIp}`);
            if (request.method === 'HEAD') response.end();
            else createReadStream(name).pipe(response);
        } catch {
            console.error(`[500] Erro ao servir ${name}`);
            response.writeHead(500, {'Content-Type': 'text/plain'}).end('Asset unavailable');
        }
    });
    server.on('error',error=>{console.error(error.message);process.exitCode=1;});
    server.listen(port, '0.0.0.0', () => {
        console.log(`OCR web iniciado em 0.0.0.0:${port}:`);
        console.log(` - Local desta execução: http://127.0.0.1:${port}`);
        console.log(' - Local:        http://127.0.0.1:3003');
        console.log(' - Wi-Fi Local:  http://192.168.10.12:3003');
        console.log(' - Tailscale IP: http://100.70.183.127:3003');
        console.log(' - MagicDNS:     http://desktop-32f9g6n-1.tail1b5b08.ts.net:3003');
    });
}
