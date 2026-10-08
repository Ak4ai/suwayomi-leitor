const { chromium } = require('../node_modules/ocr-check/node_modules/playwright');
const fs = require('node:fs/promises');
(async () => {
    const mode = process.argv[2] || 'wasm',
        complex = process.argv[3] === 'complex',
        strategy = process.argv[4] || 'all',
        browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.goto('http://127.0.0.1:3004/chapter.html');
        const raw = JSON.parse(await fs.readFile('ocr-runs/sorcerer-supreme-1/020.json', 'utf8')),
            translations = JSON.parse(await fs.readFile('tools/fixtures/sorcerer-page20-translations.json', 'utf8'));
        const segments = raw.filtered.segments
                .filter((s) =>
                    (process.argv[3] === 'sample' ? ['s1', 's9', 's10', 's11'] : ['s2', 's6']).includes(s.id),
                )
                .map((s) => ({ ...s, translation: translations[s.id] })),
            data = (await fs.readFile('ocr-runs/sorcerer-supreme-1/020.jpg')).toString('base64');
        const report = await page.evaluate(
            async ({ data, segments, mode, complex, strategy }) => {
                const { AIInpainter, prepareAIPatches } = await import('./inpaint-ai.js'),
                    { renderLetteringSVG } = await import('./lettering-svg.js'),
                    { loadLetteringFonts } = await import('./lettering.js');
                await loadLetteringFonts();
                let blob = await (await fetch('data:image/jpeg;base64,' + data)).blob();
                if (complex) {
                    const sample = document.createElement('canvas');
                    sample.width = 256;
                    sample.height = 256;
                    const ctx = sample.getContext('2d');
                    for (let y = 0; y < 256; y += 8)
                        for (let x = 0; x < 256; x += 8) {
                            ctx.fillStyle = `rgb(${(x * 7 + y * 13) % 255},${(x * 17 + y * 3) % 255},${(x * 5 + y * 19) % 255})`;
                            ctx.fillRect(x, y, 8, 8);
                        }
                    ctx.font = 'bold 24px sans-serif';
                    ctx.fillStyle = 'white';
                    ctx.fillText('HELLO WORLD', 40, 135);
                    blob = await new Promise((resolve) => sample.toBlob(resolve));
                    segments = [
                        {
                            id: 'complex',
                            sourceText: 'HELLO WORLD',
                            translation: 'Olá mundo',
                            box: [36, 103, 219, 144],
                            bubble: null,
                            lines: [{ box: [36, 103, 219, 144], text: 'HELLO WORLD', confidence: 0.99 }],
                        },
                    ];
                }
                const image = await createImageBitmap(blob),
                    inpainter = new AIInpainter();
                try {
                    const prepared = prepareAIPatches(image, segments, { strategy });
                    if (complex && !prepared.patches.some((p) => p.coarse))
                        throw Error('Complex fallback not exercised');
                    const ai = await inpainter.process(image, blob, segments, {
                        mode,
                        strategy,
                        signal: AbortSignal.timeout(180000),
                    });
                    try {
                        const original = document.createElement('canvas');
                        original.width = image.width;
                        original.height = image.height;
                        original.getContext('2d').drawImage(image, 0, 0);
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        canvas.getContext('2d').drawImage(ai.background, 0, 0);
                        const a = original.getContext('2d').getImageData(0, 0, image.width, image.height).data,
                            b = canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data,
                            mask = new Uint8Array(image.width * image.height);
                        for (const patch of [...prepared.patches, ...prepared.localPatches])
                            for (let y = 0; y < patch.h; y++)
                                for (let x = 0; x < patch.w; x++)
                                    if (patch.mask[y * patch.w + x])
                                        mask[(patch.y + y) * image.width + patch.x + x] = 1;
                        let outsideChanges = 0,
                            changedMasked = 0;
                        for (let i = 0; i < mask.length; i++)
                            if (
                                a[i * 4] !== b[i * 4] ||
                                a[i * 4 + 1] !== b[i * 4 + 1] ||
                                a[i * 4 + 2] !== b[i * 4 + 2]
                            ) {
                                if (mask[i]) changedMasked++;
                                else outsideChanges++;
                            }
                        const svg = await renderLetteringSVG(image, segments, {
                            background: ai.background,
                            skipCleanup: true,
                            regionOverrides: ai.overrides,
                        });
                        if (outsideChanges || !changedMasked || svg.applied !== segments.length)
                            throw Error('AI compositing/rendering regression');
                        return {
                            metrics: ai.metrics,
                            outsideChanges,
                            changedMasked,
                            applied: svg.applied,
                            coarse: prepared.patches.some((p) => p.coarse),
                            svg: svg.svg,
                            cleaned: canvas.toDataURL(),
                        };
                    } finally {
                        if (ai.ownsBackground) ai.background.close();
                    }
                } finally {
                    image.close();
                    inpainter.stop();
                }
            },
            { data, segments, mode, complex, strategy },
        );
        const root = 'ocr-runs/sorcerer-supreme-1/',
            label = `${mode}-${strategy}${complex ? '-complex' : ''}`;
        await fs.writeFile(root + `ai-${label}.svg`, report.svg);
        delete report.svg;
        await fs.writeFile(root + `ai-${label}-cleaned.png`, Buffer.from(report.cleaned.split(',')[1], 'base64'));
        delete report.cleaned;
        await fs.writeFile(root + `ai-${label}-check.json`, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
