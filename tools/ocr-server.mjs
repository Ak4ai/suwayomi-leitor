import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Serve only these prototype assets; never expose repository files or credentials.
const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/ocr.js', ['ocr.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
    const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
    if (!asset || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(404).end('Not found');
        return;
    }
    try {
        const body = await readFile(new URL(`../public/ocr/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
        response.writeHead(500).end('Unable to load OCR prototype');
    }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(3001, '127.0.0.1', () => console.log('Laboratório OCR: http://127.0.0.1:3001'));
