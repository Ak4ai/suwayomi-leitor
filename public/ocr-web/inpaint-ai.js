import { Lettering, suggestLettering } from './lettering.js';

function geometry(region) {
    return {
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        spans: region.spans,
        textArea: region.textArea,
        sourceHeight: region.sourceHeight,
        suggestion: region.suggestion,
        ink: region.ink,
    };
}
// Limit grouped crops to 640 px including context: model scale stays >= 0.8.
export function groupAIPatches(patches) {
    const groups = [];
    for (const patch of patches) {
        const candidate = { ...patch, ids: [patch.id] };
        let merged = candidate;
        for (let i = 0; i < groups.length;) {
            const other = groups[i];
            const x = Math.min(merged.x, other.x),
                y = Math.min(merged.y, other.y);
            const w = Math.max(merged.x + merged.w, other.x + other.w) - x;
            const h = Math.max(merged.y + merged.h, other.y + other.h) - y;
            const gapX = Math.max(0, merged.x - other.x - other.w, other.x - merged.x - merged.w);
            const gapY = Math.max(0, merged.y - other.y - other.h, other.y - merged.y - merged.h);
            if (Math.max(w, h) > 576 || Math.hypot(gapX, gapY) > 32) {
                i++;
                continue;
            }
            const mask = new Uint8Array(w * h);
            for (const part of [merged, other])
                for (let yy = 0; yy < part.h; yy++)
                    for (let xx = 0; xx < part.w; xx++)
                        if (part.mask[yy * part.w + xx]) mask[(part.y - y + yy) * w + part.x - x + xx] = 1;
            merged = { x, y, w, h, mask, ids: [...merged.ids, ...other.ids] };
            groups.splice(i, 1);
            i = 0;
        }
        groups.push(merged);
    }
    return groups;
}
export function prepareAIPatches(image, segments, { strategy = 'all' } = {}) {
    const lettering = new Lettering();
    lettering.prepare(image);
    const patches = [],
        overrides = new Map(),
        notes = [],
        localPatches = [];
    let background;
    for (const segment of segments) {
        if (
            !segment.translation?.trim() ||
            segment.translation.trim().toLowerCase() === segment.sourceText.trim().toLowerCase()
        )
            continue;
        if (!segment.lines?.length) {
            notes.push([segment.id, 'Sem linhas reconhecidas; tradução no painel']);
            continue;
        }
        const region = lettering.region(segment);
        if (!region.reason) {
            const pixels = region.mask.getContext('2d').getImageData(0, 0, region.w, region.h).data,
                mask = new Uint8Array(region.w * region.h);
            for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] ? 1 : 0;
            const patch = { id: segment.id, x: region.x, y: region.y, w: region.w, h: region.h, mask };
            if (strategy === 'hybrid' && region.cleanup === 'flat-colour') {
                if (!background) {
                    background = document.createElement('canvas');
                    background.width = image.width;
                    background.height = image.height;
                    background.getContext('2d').drawImage(image, 0, 0);
                }
                background.getContext('2d').drawImage(region.clean, region.x, region.y);
                localPatches.push(patch);
            } else patches.push(patch);
            overrides.set(segment.id, geometry(region));
            continue;
        }
        // Coarse fallback for backgrounds the classical cleaner refuses.
        // Scope is limited to OCR line boxes, not the entire detected balloon.
        const b = segment.box.map(Math.round),
            x = Math.max(0, b[0] - 4),
            y = Math.max(0, b[1] - 4),
            x2 = Math.min(image.width, b[2] + 4),
            y2 = Math.min(image.height, b[3] + 4),
            w = x2 - x,
            h = y2 - y;
        if (w < 8 || h < 8 || w * h > 1500000) {
            notes.push([segment.id, 'Área muito grande ou inválida; tradução no painel']);
            continue;
        }
        const mask = new Uint8Array(w * h),
            bubble = segment.bubble || [x, y, x2, y2];
        for (const line of segment.lines) {
            const a = line.box,
                margin = Math.max(1, Math.min(4, (a[3] - a[1]) * 0.08));
            for (
                let yy = Math.max(y, bubble[1] + 2, Math.floor(a[1] - margin));
                yy < Math.min(y2, bubble[3] - 2, Math.ceil(a[3] + margin));
                yy++
            )
                for (
                    let xx = Math.max(x, bubble[0] + 2, Math.floor(a[0] - margin));
                    xx < Math.min(x2, bubble[2] - 2, Math.ceil(a[2] + margin));
                    xx++
                )
                    mask[(yy - y) * w + xx - x] = 1;
        }
        if (!mask.some(Boolean)) {
            notes.push([segment.id, 'Sem máscara segura; tradução no painel']);
            continue;
        }
        patches.push({ id: segment.id, x, y, w, h, mask, coarse: true });
        const heights = segment.lines.map((line) => line.box[3] - line.box[1]).sort((a, b) => a - b);
        overrides.set(segment.id, {
            x,
            y,
            w,
            h,
            textArea: { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] },
            sourceHeight: heights[Math.floor(heights.length / 2)] * 0.75,
            suggestion: suggestLettering([]),
            ink: '#111',
            spans: Array.from({ length: h }, (_, row) =>
                y + row > b[1] && y + row < b[3] ? { left: b[0] + 2, right: b[2] - 2 } : null,
            ),
            coarse: true,
        });
    }
    return { patches, overrides, notes, background, localPatches };
}

export class AIInpainter {
    constructor() {
        this.worker = null;
        this.rejectPending = null;
    }
    stop() {
        this.worker?.terminate();
        this.worker = null;
        const reject = this.rejectPending;
        this.rejectPending = null;
        reject?.(new DOMException('Limpeza cancelada', 'AbortError'));
    }
    async process(image, blob, segments, { signal, mode = 'auto', strategy = 'all', onProgress = () => {} } = {}) {
        signal?.throwIfAborted();
        if (this.rejectPending) throw Error('Já existe uma limpeza com IA em andamento.');
        const start = performance.now();
        const prepared = prepareAIPatches(image, segments, { strategy });
        const patches = groupAIPatches(prepared.patches);
        signal?.throwIfAborted();
        if (!prepared.patches.length)
            return {
                background: prepared.background ? await createImageBitmap(prepared.background) : image,
                overrides: prepared.overrides,
                notes: prepared.notes,
                metrics: {
                    patches: 0,
                    localRegions: prepared.localPatches.length,
                    neuralRegions: 0,
                    elapsedMs: performance.now() - start,
                },
                ownsBackground: !!prepared.background,
            };
        const base = prepared.background ? await createImageBitmap(prepared.background) : null;
        if (signal?.aborted) {
            base?.close();
            signal.throwIfAborted();
        }
        this.worker ??= new Worker(new URL('./inpaint-ai-worker.js', import.meta.url), { type: 'module' });
        const worker = this.worker;
        const result = await new Promise((resolve, reject) => {
            let finished = false;
            const timer = setTimeout(() => {
                finish(reject, new Error('Limpeza com IA excedeu 3 minutos. Tente o modo leve.'));
                this.stop();
            }, 180000);
            const finish = (fn, value) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                worker.onmessage = null;
                worker.onerror = null;
                this.rejectPending = null;
                fn(value);
            };
            const abort = () => this.stop();
            this.rejectPending = (error) => finish(reject, error);
            signal?.addEventListener('abort', abort, { once: true });
            worker.onmessage = ({ data }) => {
                if (data.type === 'progress') onProgress(data.message);
                if (data.type === 'result') finish(resolve, data);
                if (data.type === 'error') {
                    finish(reject, new Error(data.message));
                    this.stop();
                }
            };
            worker.onerror = (event) => {
                finish(reject, new Error(event.message || 'Falha no worker LaMa.'));
                this.stop();
            };
            // Transfer the local background directly; avoid PNG encoding a full page.
            worker.postMessage({ image: base || blob, patches, mode }, base ? [base] : []);
        });
        if (signal?.aborted) {
            result.cleaned.close();
            signal.throwIfAborted();
        }
        // Coarse fallback cannot infer the original lettering style. Choose a
        // readable polarity from the repaired text area rather than guessing.
        const canvas = document.createElement('canvas');
        canvas.width = result.cleaned.width;
        canvas.height = result.cleaned.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(result.cleaned, 0, 0);
        for (const region of prepared.overrides.values())
            if (region.coarse) {
                const pixel = ctx.getImageData(
                    Math.max(0, Math.floor(region.textArea.x + region.textArea.w / 2)),
                    Math.max(0, Math.floor(region.textArea.y + region.textArea.h / 2)),
                    1,
                    1,
                ).data;
                region.ink = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2] < 130 ? '#fff' : '#111';
            }
        return {
            background: result.cleaned,
            overrides: prepared.overrides,
            notes: prepared.notes,
            metrics: {
                ...result.metrics,
                elapsedMs: performance.now() - start,
                localRegions: prepared.localPatches.length,
                neuralRegions: prepared.patches.length,
            },
            ownsBackground: true,
        };
    }
}
