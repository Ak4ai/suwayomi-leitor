import { LocalTranslator } from './translation-local.js';
import { translate, translateMyMemory, translateGoogle, clearMyMemoryTranslations } from './translation.js';
import { selectSegments } from './ocr-quality.js';
import { imageQuality } from './image-quality.js';
const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Cancelado', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
export class ChapterCache {
    constructor(memoryLimit = 100) {
        this.memoryLimit = memoryLimit;
        this.memory = new Map();
        this.db = null;
        this.epoch = 0;
    }
    async open() {
        if (this.db) return this.db;
        this.db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('ihc-chapter-results', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('results');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(() => null);
        return this.db;
    }
    async get(key) {
        if (this.memory.has(key)) return structuredClone(this.memory.get(key));
        const db = await this.open();
        if (!db) return null;
        return new Promise((resolve) => {
            const request = db.transaction('results').objectStore('results').get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    }
    async put(key, value) {
        if (this.memoryLimit) this.memory.set(key, structuredClone(value));
        if (this.memory.size > this.memoryLimit) this.memory.delete(this.memory.keys().next().value);
        const db = await this.open();
        if (!db) return false;
        return new Promise((resolve) => {
            const transaction = db.transaction('results', 'readwrite');
            transaction.objectStore('results').put(value, key);
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
            transaction.onabort = () => resolve(false);
        });
    }
    async clear() {
        this.epoch++;
        this.memory.clear();
        const db = await this.open();
        if (db)
            await new Promise((resolve, reject) => {
                const tx = db.transaction('results', 'readwrite');
                tx.objectStore('results').clear();
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
    }
}
export class ChapterEngine {
    constructor() {
        this.cache = new ChapterCache();
        this.localTranslator = new LocalTranslator();
        this.worker = null;
        this.workerKey = '';
        this.manifest = null;
    }
    stop() {
        this.localTranslator.stop();
        this.worker?.terminate();
        this.worker = null;
        this.workerKey = '';
    }
    async ocr(image, settings, signal, onProgress) {
        signal.throwIfAborted();
        const key = `${settings.mode}:${settings.threads}`;
        if (this.workerKey !== key) this.stop();
        if (!this.worker) {
            const url = new URL('./worker.js', import.meta.url);
            url.searchParams.set('threads', settings.threads);
            this.worker = new Worker(url, { type: 'module' });
            this.workerKey = key;
        }
        const worker = this.worker;
        return new Promise((resolve, reject) => {
            const finish = (fn, value) => {
                signal.removeEventListener('abort', abort);
                worker.onmessage = null;
                worker.onerror = null;
                fn(value);
            };
            const abort = () => {
                this.stop();
                finish(reject, new DOMException('Cancelado', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
            worker.onerror = (event) => {
                this.stop();
                finish(reject, new Error(event.message || 'Falha no worker OCR.'));
            };
            worker.onmessage = ({ data }) => {
                if (data.type === 'progress') onProgress(data.message);
                if (data.type === 'error') {
                    this.stop();
                    finish(reject, new Error(data.message));
                }
                if (data.type === 'result') finish(resolve, data.result);
            };
            worker.postMessage({ image, mode: settings.mode });
        });
    }
    async process(job, image, settings, signal, update) {
        signal.throwIfAborted();
        if (!crypto.subtle) throw new Error('OCR requer HTTPS ou localhost.');
        const started = performance.now(),
            cacheEpoch = this.cache.epoch,
            put = (key, value) =>
                cacheEpoch === this.cache.epoch ? this.cache.put(key, value) : Promise.resolve(false),
            hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer())), (n) =>
                n.toString(16).padStart(2, '0'),
            ).join('');
        this.manifest ??= await (await fetch(new URL('./models.json', import.meta.url), { signal })).json();
        const signature = [
            this.manifest.pipelineVersion,
            this.manifest.runtimeVersion,
            ...Object.values(this.manifest.models).map((m) => m.sha256),
        ].join(':');
        const translationVersion =
            settings.provider === 'opus'
                ? `opus-v1:${settings.opusVariant || 'compact'}:${settings.opusNormalize !== false}:`
                : settings.provider === 'mymemory'
                  ? 'memory-coverage-v2:'
                  : settings.provider === 'google'
                    ? 'google-compat-v1:'
                    : '';
        const ocrKey = `ocr:${signature}:${settings.mode}:${hash}`,
            translationKey = `translation:${translationVersion}quality-v1:${settings.scope || 'all'}:${settings.filterNoise !== false}:en:pt-BR:prompt-v1:${settings.provider}:${settings.provider === 'gemini' ? settings.model : ''}:${ocrKey}`;
        let result = job.forceOCR ? null : await this.cache.get(ocrKey),
            ocrCached = !!result;
        if (!result) {
            update({ status: 'ocr', message: 'Reconhecendo texto…' });
            result = await this.ocr(image, settings, signal, (message) => update({ message }));
            await put(ocrKey, result);
        }
        signal.throwIfAborted();
        result = { ...result, ...selectSegments(result.segments, settings.scope, settings.filterNoise) };
        result.imageQuality = imageQuality(result.width, result.height);
        if (result.imageQuality.small && !settings.allowSmallImages) {
            for (const segment of result.segments) segment.translationError = result.imageQuality.message;
            update({ result, message: result.imageQuality.message });
            const error = new Error(result.imageQuality.message);
            error.code = 'LOW_IMAGE_RESOLUTION';
            error.pauseQueue = true;
            throw error;
        }
        const cached = job.forceTranslate ? null : await this.cache.get(translationKey);
        if (cached?.complete) {
            return { ...cached.result, cacheHit: true, totalMs: performance.now() - started };
        }
        if (cached?.result) result = cached.result;
        update({ status: 'translating', result, message: 'Traduzindo…', ocrCached, forceOCR: false });
        if (!result.segments.some((s) => s.sourceText.trim())) {
            await put(translationKey, { complete: true, result });
            return { ...result, totalMs: performance.now() - started, cacheHit: false, ocrCached };
        }
        const apply = (id, text) => {
            const segment = result.segments.find((s) => s.id === id);
            if (segment) {
                segment.translation = text;
                segment.translationProvider = settings.provider;
                segment.translatedSource = segment.sourceText;
                segment.translationMemoryValidated = settings.provider === 'mymemory';
                delete segment.translationError;
                delete segment.translationCandidate;
            }
        };
        const onFailure = (id, error) => {
            const segment = result.segments.find((s) => s.id === id);
            if (segment) {
                segment.translation = '';
                segment.translationError = error.message;
                segment.translationCandidate = error.candidate || '';
                update({ result });
            }
        };
        try {
            if (job.forceTranslate && settings.provider === 'mymemory') clearMyMemoryTranslations(result.segments);
            let translations;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const progress = (message) => update({ message }),
                        completed = (id, text) => {
                            apply(id, text);
                            update({ result });
                        };
                    this.localTranslator.variant = settings.opusVariant || 'compact';
                    const localItems =
                        settings.provider !== 'opus' || settings.opusNormalize === false
                            ? result.segments
                            : result.segments.map((s) => ({
                                  ...s,
                                  sourceText: s.sourceText
                                      .replace(/\s+/g, ' ')
                                      .toLowerCase()
                                      .replace(/\bi\b/g, 'I')
                                      .replace(
                                          /(^|[.!?]\s+)([a-z])/g,
                                          (_, prefix, letter) => prefix + letter.toUpperCase(),
                                      ),
                              }));
                    translations =
                        settings.provider === 'opus'
                            ? await this.localTranslator.translate(localItems, signal, progress, completed)
                            : settings.provider === 'gemini'
                              ? await translate(result.segments, settings.key, settings.model, signal)
                              : settings.provider === 'google'
                                ? await translateGoogle(result.segments, signal, progress, completed)
                                : await translateMyMemory(result.segments, signal, progress, completed, onFailure);
                    break;
                } catch (error) {
                    if (
                        signal.aborted ||
                        settings.provider !== 'gemini' ||
                        attempt === 2 ||
                        !([500, 502, 503, 504].includes(error.httpStatus) || error.isNetworkError)
                    )
                        throw error;
                    update({ message: `Gemini temporariamente indisponível; nova tentativa ${attempt + 2} de 3…` });
                    await wait(1000 * (attempt + 1), signal);
                }
            }
            for (const [id, text] of translations) apply(id, text);
            signal.throwIfAborted();
            await put(translationKey, { complete: true, result });
            return { ...result, totalMs: performance.now() - started, cacheHit: false, ocrCached };
        } catch (error) {
            for (const segment of result.segments)
                if (!segment.translation?.trim() && !segment.translationError)
                    segment.translationError = signal.aborted ? 'Tradução pausada; continue a fila.' : error.message;
            update({ result });
            await put(translationKey, { complete: false, result });
            update({ forceTranslate: false });
            if (!signal.aborted) error.pauseQueue = true;
            throw error;
        }
    }
}
