/* IHC OCR prototype. Tesseract.js recognizes English locally in a web worker. */
const element = (id) => document.getElementById(id);
let source = null;
let imageUrl = null;
let activeWorker = null;
let runId = 0;
let busy = false;

function setBusy(value) {
    busy = value;
    for (const id of ['file', 'example', 'mode']) element(id).disabled = value;
    element('recognize').disabled = value || !source;
    element('cancel').disabled = !value;
}

async function selectImage(blob, name) {
    element('error').hidden = true;
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
        await image.decode();
        if (image.naturalWidth * image.naturalHeight > 25000000) {
            throw new Error('Imagem muito grande. Reduza para até 25 milhões de pixels ou recorte um balão.');
        }
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = url;
        source = blob;
        element('preview').src = url;
        element('preview').hidden = false;
        element('filename').textContent = name;
        element('result').value = '';
        element('download').disabled = true;
        element('confidence').textContent = '';
        element('progress').value = 0;
        element('status').textContent = 'Imagem pronta. Clique em Reconhecer texto.';
    } catch (error) {
        URL.revokeObjectURL(url);
        showError(error.message || 'Não foi possível abrir a imagem.');
    }
    setBusy(false);
}

function showError(message) {
    element('error').textContent = message;
    element('error').hidden = false;
}

element('file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file || busy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
        showError('Selecione PNG, JPEG ou WebP de até 15 MB.');
        event.target.value = '';
        return;
    }
    setBusy(true);
    await selectImage(file, file.name);
});

element('example').addEventListener('click', () => {
    setBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = 'bold 48px Arial';
    ['HELLO, MY FRIEND!', 'WE CAN READ THIS STORY TOGETHER.', 'LET US GO HOME.'].forEach((text, index) => ctx.fillText(text, 45, 110 + index * 130));
    canvas.toBlob(async (blob) => {
        if (blob) await selectImage(blob, 'Exemplo gerado: três frases em inglês');
        else { setBusy(false); showError('Não foi possível gerar o exemplo.'); }
    }, 'image/png');
});

element('recognize').addEventListener('click', async () => {
    if (!source || busy) return;
    const id = ++runId;
    let worker;
    setBusy(true);
    element('error').hidden = true;
    element('result').value = '';
    element('download').disabled = true;
    element('confidence').textContent = '';
    element('progress').value = 0;
    element('status').textContent = 'Carregando motor e modelo de inglês…';
    try {
        if (!globalThis.Tesseract) throw new Error('O motor OCR não carregou. Verifique a conexão e recarregue a página.');
        worker = await Tesseract.createWorker('eng', 1, {
            logger: ({ status, progress }) => {
                if (id !== runId) return;
                if (status === 'recognizing text') {
                    element('progress').value = Math.round(progress * 100);
                    element('status').textContent = `Reconhecendo texto: ${Math.round(progress * 100)}%`;
                }
            },
        });
        if (id !== runId) return;
        activeWorker = worker;
        await worker.setParameters({ tessedit_pageseg_mode: element('mode').value });
        const { data } = await worker.recognize(source);
        if (id !== runId) return;
        element('result').value = data.text.trim();
        element('download').disabled = !data.text.trim();
        element('progress').value = 100;
        element('confidence').textContent = `Confiança estimada pelo OCR: ${Math.round(data.confidence)}%. Não é garantia de precisão.`;
        element('status').textContent = data.text.trim() ? 'Concluído. Confira e corrija o texto antes de baixar.' : 'Nenhum texto reconhecido. Tente um recorte maior e mais nítido do balão.';
    } catch (error) {
        if (id === runId) {
            element('status').textContent = 'O reconhecimento não foi concluído.';
            showError(`Falha no OCR: ${error.message || 'tente novamente com uma imagem menor.'}`);
        }
    } finally {
        if (worker) await worker.terminate().catch(() => {});
        if (id === runId) { activeWorker = null; setBusy(false); }
    }
});

element('cancel').addEventListener('click', () => {
    ++runId;
    if (activeWorker) void activeWorker.terminate().catch(() => {});
    activeWorker = null;
    element('status').textContent = 'Reconhecimento cancelado.';
    element('progress').value = 0;
    setBusy(false);
});

element('result').addEventListener('input', () => { element('download').disabled = !element('result').value.trim(); });
element('download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([element('result').value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'texto-ingles.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => {
    ++runId;
    if (activeWorker) void activeWorker.terminate();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
});
