import { suspiciouslyShort } from './translation-quality.js';
export class LocalTranslator {
    constructor({ target = 'pt_BR', variant = 'compact' } = {}) {
        this.worker = null;
        this.rejectPending = null;
        this.lastMetrics = null;
        this.target = target;
        this.variant = variant;
    }
    stop() {
        this.worker?.terminate();
        this.worker = null;
        const reject = this.rejectPending;
        this.rejectPending = null;
        reject?.(new DOMException('Tradução local cancelada', 'AbortError'));
    }
    async translate(items, signal, onProgress = () => {}, onSegment = () => {}) {
        signal?.throwIfAborted();
        if (this.rejectPending) throw Error('Outra tradução local está em andamento.');
        this.worker ??= new Worker(new URL('./translation-local-worker.js', import.meta.url), { type: 'module' });
        const worker = this.worker,
            result = new Map();
        return new Promise((resolve, reject) => {
            let finished = false;
            const timer = setTimeout(() => {
                finish(reject, new Error('Tradução local excedeu 3 minutos.'));
                this.stop();
            }, 180000);
            const abort = () => this.stop();
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
            this.rejectPending = (error) => finish(reject, error);
            signal?.addEventListener('abort', abort, { once: true });
            worker.onerror = (event) => {
                finish(reject, new Error(event.message || 'Falha no worker de tradução local.'));
                this.stop();
            };
            worker.onmessage = ({ data }) => {
                if (data.type === 'progress') onProgress(data.message);
                if (data.type === 'segment') {
                    const source = items.find((item) => item.id === data.id)?.sourceText || '';
                    if (suspiciouslyShort(source, data.translation)) {
                        finish(reject, new Error('OPUS-MT retornou uma tradução suspeitamente incompleta.'));
                        this.stop();
                        return;
                    }
                    result.set(data.id, data.translation);
                    onSegment(data.id, data.translation);
                }
                if (data.type === 'result') {
                    this.lastMetrics = data.metrics;
                    finish(resolve, result);
                }
                if (data.type === 'error') {
                    finish(reject, new Error(data.message));
                    this.stop();
                }
            };
            worker.postMessage({
                items: items.map(({ id, sourceText }) => ({ id, sourceText })),
                target: this.target,
                variant: this.variant,
            });
        });
    }
}
