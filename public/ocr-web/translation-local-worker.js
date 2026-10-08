let pipeline, env;
let translator,
    spec,
    busy = false,
    variant;
const progress = (message) => self.postMessage({ type: 'progress', message });
const sentenceSplitter = new Intl.Segmenter('en', { granularity: 'sentence' });
async function initialize(modelVariant) {
    if (translator && variant === modelVariant) return false;
    await translator?.dispose();
    translator = null;
    spec = null;
    ({ pipeline, env } = await import('./translation-vendor/transformers.web.min.js'));
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL('./translation-models/', import.meta.url).href;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.wasmPaths = new URL('./translation-vendor/', import.meta.url).href;
    env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
    spec = await (
        await fetch(
            new URL(
                modelVariant === 'big' ? './translation-model-big.json' : './translation-model.json',
                import.meta.url,
            ),
        )
    ).json();
    let last = 0;
    translator = await pipeline('translation', spec.id, {
        device: 'wasm',
        dtype: 'q8',
        local_files_only: true,
        revision: spec.revision,
        progress_callback: (event) => {
            if (performance.now() - last > 250) {
                progress(
                    event.status === 'progress'
                        ? `Carregando OPUS-MT: ${event.file} · ${Math.round(event.progress || 0)}%`
                        : 'Inicializando OPUS-MT local…',
                );
                last = performance.now();
            }
        },
    });
    variant = modelVariant;
    return true;
}
async function translateSentence(source, prefix) {
    const input = await translator.tokenizer(`${prefix || spec.prefix} ${source}`, { truncation: false });
    const tokenCount = input.input_ids.data.length;
    if (tokenCount > 480) throw Error('Frase longa demais para o modelo local; divida o texto antes de traduzir.');
    const maximum = Math.min(256, Math.max(64, tokenCount * 3));
    const output = await translator.model.generate({
        ...input,
        max_new_tokens: maximum,
        num_beams: 1,
        do_sample: false,
    });
    try {
        const ids = Array.from(output.data, Number),
            eos = translator.model.config.eos_token_id;
        if (ids.length >= maximum + 1 || ids.at(-1) !== eos)
            throw Error('O modelo local não concluiu a frase; tradução recusada para evitar corte.');
        const text = translator.tokenizer.batch_decode(output, { skip_special_tokens: true })[0]?.trim();
        if (!text) throw Error('O modelo local retornou texto vazio.');
        return text;
    } finally {
        output.dispose?.();
        for (const value of Object.values(input)) value.dispose?.();
    }
}
self.onmessage = async ({ data: job }) => {
    if (busy) return;
    busy = true;
    try {
        const start = performance.now(),
            cold = await initialize(job.variant || 'compact'),
            initializationMs = performance.now() - start,
            rows = [];
        for (const [index, item] of job.items.entries()) {
            progress(`OPUS-MT: traduzindo fala ${index + 1} de ${job.items.length}`);
            const source = item.sourceText.replace(/\s+/g, ' ').trim(),
                sentences = [...sentenceSplitter.segment(source)].map((s) => s.segment.trim()).filter(Boolean),
                translated = [],
                before = performance.now();
            for (const sentence of sentences)
                translated.push(
                    await translateSentence(sentence, job.target === 'pt' ? spec.prefixPt || '>>pt<<' : spec.prefix),
                );
            const translation = translated.join(' '),
                row = { id: item.id, translation, elapsedMs: performance.now() - before, sentences: sentences.length };
            rows.push(row);
            self.postMessage({ type: 'segment', ...row });
        }
        self.postMessage({
            type: 'result',
            rows,
            metrics: {
                elapsedMs: performance.now() - start,
                initializationMs,
                cold,
                provider: 'wasm',
                threads: env.backends.onnx.wasm.numThreads,
                model: spec.id,
                revision: spec.revision,
                bytes: spec.bytes,
            },
        });
    } catch (error) {
        self.postMessage({ type: 'error', message: `Falha na tradução local: ${error.message || error}` });
    } finally {
        busy = false;
    }
};
