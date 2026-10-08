# Laboratório de OCR em inglês

O comparador com quatro métodos locais, adaptadores Google/Gemini e importação de resultados externos está documentado em [OCR-COMPARISON.md](OCR-COMPARISON.md). Execute `npm run ocr:compare` para abrir a versão comparativa na porta 3002.

Primeiro experimento funcional do projeto IHC. Extrai texto inglês de PNG/JPEG/WebP com Tesseract.js 6.0.1 no navegador, permite revisão manual e baixa o texto em UTF-8. Tradução para português é a próxima etapa.

## Executar

Na pasta `suwayomi-leitor`:

```powershell
npm run ocr:dev
```

Abra http://127.0.0.1:3001. Esse comando usa somente Node e não exige instalar as dependências React da WebUI nem iniciar Suwayomi-Server. Encerre com Ctrl+C.

1. Clique em **Usar exemplo em inglês** ou selecione uma imagem local.
2. Escolha página com textos espalhados ou recorte de um balão.
3. Clique em **Reconhecer texto**.
4. Confira, edite e baixe o resultado.

O exemplo é gerado com canvas e contém: `HELLO, MY FRIEND!`, `WE CAN READ THIS STORY TOGETHER.` e `LET US GO HOME.`

## Integração e limites

- Os arquivos estão em `public/ocr/`: com a WebUI servida normalmente, abra `ocr/index.html` sob sua URL base. O experimento ainda não adiciona um botão ao leitor, nem recebe automaticamente a página do capítulo.
- O motor, WebAssembly e dados de inglês são obtidos pela internet. A imagem é processada no navegador; não há envio para uma API de OCR ou tradução. O cache do navegador pode reduzir downloads, mas não há garantia de funcionamento offline.
- Aceita uma imagem de cada vez, até 15 MB e 25 milhões de pixels. Não aceita PDF/CBZ diretamente.
- O modo de página usa segmentação de texto esparso; a ordem retornada não garante a sequência narrativa dos balões. Para resultados melhores, experimente recortes de um balão com texto nítido.
- Fontes estilizadas, texto inclinado, contornos e desenhos podem prejudicar o reconhecimento. A confiança é uma estimativa do motor, não uma medida validada de qualidade para mangás.
- Cancelar descarta o resultado e encerra o worker disponível. Se o motor ainda estiver sendo inicializado, ele será encerrado ao concluir essa inicialização.
- A página experimental está em português; internacionalização e integração React serão feitas ao incorporar o recurso ao leitor.

## Validação realizada

Executado OCR real no Edge headless com Playwright: as três frases do exemplo foram reconhecidas. Verificados edição do resultado, evento de download, ausência de overflow horizontal em largura de 390 px e bloqueio de arquivos externos à lista do servidor de teste. Sintaxe JavaScript verificada com Node.

Ainda falta avaliar páginas reais de quadrinhos e executar em Android/iOS. A WebUI completa não foi compilada neste incremento.

Documentação do motor: https://github.com/naptha/tesseract.js
