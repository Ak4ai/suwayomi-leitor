# Comparador de reconhecimento de HQs

Abra **http://127.0.0.1:3002** após executar `npm run ocr:compare` em `suwayomi-leitor`. O laboratório anterior continua disponível em `npm run ocr:dev` (porta 3001).

## O que está implementado

| Método | Execução | Escopo exato |
|---|---|---|
| Tesseract.js 6.0.1 | Navegador | Inglês, página inteira, PSM 11; referência inicial |
| PP-OCRv5 | Python, CPU, ONNX Runtime via RapidOCR 3.9.2 | Detector mobile + reconhecedor inglês mobile; não é a distribuição nativa PaddlePaddle |
| Comic Translate detector + PP-OCRv5 | Python, CPU | Pesos `detector-v4-s_int8.onnx` do RT-DETR-v2 de ogkalu; regiões de texto (classes 1/2), NMS, recortes e PP-OCRv5 |
| CTD + PP-OCRv5 | Python, CPU | Pesos `comictextdetector.pt.onnx` publicados pelo manga-image-translator beta-0.2.1; saída de blocos, NMS, recortes e PP-OCRv5 |
| Cloud Vision TEXT_DETECTION | API Google | Adaptador implementado; requer chave e API habilitada |
| Cloud Vision DOCUMENT_TEXT_DETECTION | API Google | Variante separada para comparar no mesmo material |
| Gemini com visão | API Google | Transcrição literal; modelo explicitamente configurado pelo usuário; tradução desabilitada no prompt |
| Lens/Circle to Search | Importação manual | Não há integração/API oficial do produto neste laboratório |
| ML Kit Android/iOS | Importação manual | Requer execução no SDK móvel; não roda dentro desta WebUI |
| Comic Translate / manga-image-translator completos | Importação manual | Permite comparar a saída dos aplicativos originais com nossas adaptações |
| Modelo próprio/outro | Importação manual | Aceita texto de um experimento externo; nenhum modelo foi treinado neste trabalho |

**Os dois caminhos de detectores especializados não são os aplicativos completos.** Não reproduzimos toda a segmentação, agrupamento, ordenação, OCR, tradução, inpainting ou composição tipográfica desses projetos. CTD usa sua saída de blocos, não as máscaras e o agrupamento completo de linhas do upstream. A lista ordenada por posição vertical/horizontal é aproximada; não resolve a ordem narrativa de painéis.

## Uso

1. Selecione a mesma imagem usada nos testes anteriores (`../imagensinputteste/7.jpg`).
2. Selecione os métodos. Por padrão, somente os quatro locais são marcados.
3. Opcionalmente, informe uma transcrição correta em inglês para calcular CER e WER.
4. Execute. Os métodos são processados um por vez; uma falha fica registrada e não elimina os demais resultados.
5. Escolha um resultado no seletor para ver as caixas numeradas sobre a imagem. Abra os detalhes para comparar textos brutos.
6. Exporte o relatório JSON. Inclui hash da imagem, versões, texto, coordenadas, tempo, erros e referência usada. A imagem não é embutida no relatório.

Você pode repetir a execução na mesma imagem para observar o efeito de inicialização/cache. Selecionar outra imagem limpa a comparação e a referência. “Parar após método atual” interrompe a fila, sem interromper uma inferência já em andamento.

## Instalação reproduzível (Windows, Python 3.12)

```powershell
python -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r tools/ocr_compare/requirements.txt
.\.venv-ocr\Scripts\python.exe tools/ocr_compare/prepare.py
npm run ocr:compare
```

O script de preparação baixa os modelos para `.ocr-models` e registra SHA-256 em `manifest.json`. Os pesos principais somam aproximadamente 120 MB. Ambiente Python e modelos são ignorados pelo Git. As versões diretas estão fixadas em `requirements.txt`; o ambiente instalado nesta implementação está descrito em `requirements-lock.txt`.

O servidor serve somente os arquivos do comparador, escuta em `127.0.0.1:3002` e recebe a imagem enviada pelo formulário. Não instala dependências da WebUI principal nem exige Suwayomi-Server. Ainda não é uma integração à tela de capítulos.

Os modelos Python executam localmente após o download. Tesseract usa um script CDN e pode baixar seu modelo inglês na primeira execução. Acesso pelo telefone à rede local não foi habilitado; o teste de layout mobile usou o navegador desktop em largura de 390 px.

## Configurar serviços Google (opcional)

Copie `.env.ocr.example` para `.env.ocr`, preencha as variáveis e reinicie `npm run ocr:compare`:

- `GOOGLE_VISION_API_KEY`: chave de um projeto com Cloud Vision habilitada e configuração de cota/faturamento apropriada.
- `GEMINI_API_KEY`: chave da Gemini API.
- `GEMINI_MODEL`: ID de um modelo com entrada de imagem disponível na conta. Não é escolhido automaticamente.

O arquivo é ignorado pelo Git e carregado pelo iniciador Node. As chaves não são entregues ao navegador. Marque os métodos e habilite o envio à nuvem na tela para usá-los. Essas chamadas enviam a imagem ao provedor e podem consumir cota; reconhecimento em nuvem não foi executado nesta implementação por falta de credenciais.

## Como comparar com Lens e ML Kit

Execute o reconhecimento sobre a mesma imagem no aplicativo/dispositivo e copie **o inglês reconhecido**, antes de traduzir ou corrigir. Use “Resultados externos”, identifique dispositivo/versão e cole o texto. Não atribuímos tempo automático nem coordenadas a essas importações. A associação à imagem depende do usuário e é identificada como manual no relatório.

Colar a tradução portuguesa produziria uma comparação inválida com OCR inglês. O comparador mede extração, não qualidade de tradução.

## Métricas e interpretação

- CER: distância de edição de caracteres / quantidade de caracteres da referência.
- WER: distância de edição de palavras / quantidade de palavras da referência.
- Normalização: NFKC, maiúsculas, pontuação substituída por espaço, espaços repetidos reduzidos. CER inclui esses espaços normalizados.
- Ambas penalizam omissões, substituições, acréscimos e diferenças de ordem; podem superar 100%. Não são uma porcentagem de confiança do modelo.
- Sem referência, os valores ficam vazios. Resultados com falha não recebem nota zero.
- Defina o escopo da referência: todos os textos visíveis versus somente falas. Motores gerais podem reconhecer letreiros/capas que um detector de balões ignora. Isso precisa ser considerado na interpretação ou avaliado num conjunto separado de recortes.
- As caixas podem representar palavras, linhas ou blocos; sua contagem não é uma taxa de detecção de balões.
- Tempo total é medido pelo navegador e inclui a requisição/worker; `elapsedMs` do servidor exclui upload. Inicialização de modelos é incluída quando necessária; PP-OCRv5 é reutilizado pelos caminhos especializados. O relatório registra modelos já carregados. Não tratar uma execução como benchmark definitivo.
- Para comparar qualidade de forma mais robusta, use várias páginas, transcrição revisada e repetições. Depois escolha quais métodos merecem entrar na integração com o leitor.

## Verificação realizada

Na `7.jpg` (1988 × 3057), os quatro métodos locais executaram de verdade, sem recortes manuais. O relatório está em `ocr-runs/comparativo-7.json` neste workspace (ignorado pelo Git). Uma execução observou cerca de 3,97 s Tesseract, 2,35 s PP-OCRv5, 10,41 s RT-DETR + OCR e 49,75 s CTD + OCR. Esses tempos não são garantia de desempenho em outro dispositivo ou de melhor precisão.

Não foi criada uma referência completa da HQ; portanto não há ranking de CER/WER para essa imagem. Os serviços de nuvem tiveram somente testes de contrato com respostas simuladas, identificados como tais. Lens, ML Kit e os aplicativos completos não foram executados.

Verificados também exportação, sobreposição de caixas, importação de texto externo sem executar HTML, ausência de overflow horizontal em 390 px, restrição dos endpoints e isolamento de falhas.

```powershell
node tools/ocr_compare/test_metrics.mjs
.\.venv-ocr\Scripts\python.exe tools/ocr_compare/test_engines.py
```

## Fontes e proveniência

- [Comic Translate](https://github.com/ogkalu2/comic-translate) e [pesos do detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector), revisão `16e8a62`; modelo com licença Apache-2.0 na model card.
- [Comic Text Detector](https://github.com/dmMaze/comic-text-detector) e [release dos pesos](https://github.com/zyddnys/manga-image-translator/releases/tag/beta-0.2.1). Pesos são baixados da distribuição upstream, não incluídos no repositório.
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [RapidOCR](https://github.com/RapidAI/RapidOCR) e [Tesseract.js](https://github.com/naptha/tesseract.js).
- [Cloud Vision OCR](https://docs.cloud.google.com/vision/docs/ocr), [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [ML Kit](https://developers.google.com/ml-kit/vision/text-recognition/v2).

As fontes documentam os componentes; os resultados locais são evidência somente da execução adaptada descrita acima. Antes de redistribuir pesos, mantenha os termos e atribuições das respectivas fontes.
