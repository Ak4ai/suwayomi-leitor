import { LocalTranslator } from './translation-local.js';
const $ = (id) => document.getElementById(id),
    translator = new LocalTranslator();
let controller;
$('translate').onclick = async () => {
    const original = $('input').value.trim();
    if (!original) {
        $('status').textContent = 'Digite o texto em inglês.';
        return;
    }
    translator.variant = $('model').value;
    translator.target = $('target').value;
    controller = new AbortController();
    const source = $('case').checked
        ? original
              .replace(/\s+/g, ' ')
              .toLowerCase()
              .replace(/\bi\b/g, 'I')
              .replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase())
        : original;
    $('translate').disabled = true;
    $('cancel').disabled = false;
    $('result').textContent = '';
    $('details').textContent = '';
    try {
        const result = await translator.translate(
            [{ id: 'demo', sourceText: source }],
            controller.signal,
            (message) => ($('status').textContent = message),
        );
        $('result').textContent = result.get('demo');
        $('status').textContent = 'Tradução concluída. Confira o sentido das falas.';
        $('details').textContent = JSON.stringify({ source, ...translator.lastMetrics }, null, 2);
    } catch (error) {
        $('status').textContent = controller.signal.aborted ? 'Tradução cancelada.' : error.message;
    } finally {
        $('translate').disabled = false;
        $('cancel').disabled = true;
    }
};
$('cancel').onclick = () => controller?.abort();
window.addEventListener('pagehide', () => translator.stop());
