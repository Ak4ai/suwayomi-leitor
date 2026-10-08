import * as ort from './vendor/ort.webgpu.min.mjs';
ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
ort.env.logLevel = 'warning';
let session,
    sessionMode,
    provider,
    spec,
    busy = false;
const progress = (message) => self.postMessage({ type: 'progress', message });
const checksum = async (bytes) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
        v.toString(16).padStart(2, '0'),
    ).join('');
async function weights() {
    spec ??= await (await fetch(new URL('./inpaint-model.json', import.meta.url))).json();
    const local = new URL(spec.url, import.meta.url).href;
    let cache;
    try {
        cache = await caches.open('ihc-inpaint-models-v1');
    } catch {}
    const stored = await cache?.match(local);
    if (stored) {
        const bytes = await stored.arrayBuffer();
        if ((await checksum(bytes)) === spec.sha256) return bytes;
        await cache.delete(local);
    }
    let response = await fetch(local);
    if (!response.ok) response = await fetch(spec.remoteUrl);
    if (!response.ok) throw Error(`Modelo LaMa indisponível (HTTP ${response.status}).`);
    const reader = response.body.getReader(),
        chunks = [];
    let size = 0,
        last = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (performance.now() - last > 250) {
            progress(`Baixando LaMa: ${(size / 1e6).toFixed(1)} / ${(spec.bytes / 1e6).toFixed(1)} MB`);
            last = performance.now();
        }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    if (size !== spec.bytes || (await checksum(bytes)) !== spec.sha256)
        throw Error('Checksum do modelo LaMa inválido.');
    try {
        await cache?.put(local, new Response(bytes));
    } catch {
        progress('Modelo em memória; navegador sem espaço para cache.');
    }
    return bytes.buffer;
}
async function initialize(mode) {
    if (session && sessionMode === mode) return;
    await session?.release();
    session = null;
    const bytes = await weights();
    const gpu = mode === 'auto' && navigator.gpu && (await navigator.gpu.requestAdapter());
    provider = gpu ? 'webgpu' : 'wasm';
    progress(`Inicializando LaMa (${provider})…`);
    try {
        session = await ort.InferenceSession.create(bytes, {
            executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'],
            graphOptimizationLevel: 'all',
        });
    } catch (error) {
        if (!gpu) throw error;
        provider = 'wasm';
        progress('LaMa: GPU incompatível; usando WASM.');
        session = await ort.InferenceSession.create(bytes, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        });
    }
    sessionMode = mode;
}
self.onmessage = async ({ data: job }) => {
    if (busy) return;
    busy = true;
    let image;
    try {
        const start = performance.now();
        await initialize(job.mode);
        const initializationMs = performance.now() - start;
        image = job.image instanceof ImageBitmap ? job.image : await createImageBitmap(job.image);
        const canvas = new OffscreenCanvas(image.width, image.height),
            ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        let inferenceMs = 0;
        for (let p = 0; p < job.patches.length; p++) {
            progress(`Limpeza com IA: recorte ${p + 1} de ${job.patches.length}`);
            const patch = job.patches[p],
                { x, y, w, h } = patch,
                side = Math.max(128, w + 64, h + 64),
                rx = x + w / 2 - side / 2,
                ry = y + h / 2 - side / 2;
            const inputCanvas = new OffscreenCanvas(512, 512),
                inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
            inputCtx.fillStyle = 'white';
            inputCtx.fillRect(0, 0, 512, 512);
            inputCtx.drawImage(image, rx, ry, side, side, 0, 0, 512, 512);
            const maskCanvas = new OffscreenCanvas(w, h),
                maskCtx = maskCanvas.getContext('2d'),
                maskData = maskCtx.createImageData(w, h);
            for (let i = 0; i < patch.mask.length; i++) {
                const value = patch.mask[i] ? 255 : 0;
                maskData.data.set([value, value, value, 255], i * 4);
            }
            maskCtx.putImageData(maskData, 0, 0);
            const resizedMask = new OffscreenCanvas(512, 512),
                resizedCtx = resizedMask.getContext('2d', { willReadFrequently: true });
            resizedCtx.imageSmoothingEnabled = false;
            resizedCtx.drawImage(
                maskCanvas,
                ((x - rx) * 512) / side,
                ((y - ry) * 512) / side,
                (w * 512) / side,
                (h * 512) / side,
            );
            const pixels = inputCtx.getImageData(0, 0, 512, 512).data,
                maskPixels = resizedCtx.getImageData(0, 0, 512, 512).data,
                N = 512 * 512,
                data = new Float32Array(4 * N);
            for (let i = 0; i < N; i++) {
                const erased = maskPixels[i * 4] > 127;
                for (let c = 0; c < 3; c++) data[c * N + i] = erased ? 0 : pixels[i * 4 + c] / 255;
                data[3 * N + i] = erased ? 1 : 0;
            }
            const input = new ort.Tensor('float32', data, [1, 4, 512, 512]);
            let result;
            const inferStart = performance.now();
            try {
                result = await session.run({ [spec.input]: input });
            } catch (error) {
                if (provider !== 'webgpu') throw error;
                await session.release();
                session = null;
                await initialize('wasm');
                result = await session.run({ [spec.input]: input });
                sessionMode = job.mode;
            } finally {
                input.dispose();
            }
            inferenceMs += performance.now() - inferStart;
            const output = result[spec.output];
            if (output.dims.join(',') !== '1,3,512,512') throw Error('Saída LaMa incompatível.');
            const predicted = new OffscreenCanvas(512, 512),
                predictedCtx = predicted.getContext('2d'),
                prediction = predictedCtx.createImageData(512, 512);
            for (let i = 0; i < N; i++) {
                for (let c = 0; c < 3; c++) {
                    const value = Number(output.data[c * N + i]);
                    if (!Number.isFinite(value)) throw Error('LaMa retornou pixels inválidos.');
                    prediction.data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, value)) * 255);
                }
                prediction.data[i * 4 + 3] = 255;
            }
            predictedCtx.putImageData(prediction, 0, 0);
            for (const tensor of Object.values(result)) tensor.dispose();
            const repaired = new OffscreenCanvas(w, h),
                repairedCtx = repaired.getContext('2d', { willReadFrequently: true });
            repairedCtx.drawImage(
                predicted,
                ((x - rx) * 512) / side,
                ((y - ry) * 512) / side,
                (w * 512) / side,
                (h * 512) / side,
                0,
                0,
                w,
                h,
            );
            const repairedPixels = repairedCtx.getImageData(0, 0, w, h).data,
                original = ctx.getImageData(x, y, w, h);
            for (let i = 0; i < patch.mask.length; i++)
                if (patch.mask[i]) {
                    for (let c = 0; c < 3; c++) original.data[i * 4 + c] = repairedPixels[i * 4 + c];
                    original.data[i * 4 + 3] = 255;
                }
            ctx.putImageData(original, x, y);
        }
        const cleaned = canvas.transferToImageBitmap();
        self.postMessage(
            {
                type: 'result',
                cleaned,
                metrics: {
                    elapsedMs: performance.now() - start,
                    initializationMs,
                    inferenceMs,
                    patches: job.patches.length,
                    provider,
                    model: spec.id,
                    modelBytes: spec.bytes,
                },
            },
            [cleaned],
        );
    } catch (error) {
        self.postMessage({ type: 'error', message: `Falha na limpeza com IA: ${error.message || error}` });
    } finally {
        (image || (job.image instanceof ImageBitmap ? job.image : null))?.close();
        busy = false;
    }
};
