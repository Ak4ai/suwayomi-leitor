# Texto SVG no leitor — etapa experimental

## Usar

Na WebUI modificada (5173), abra o leitor, **Configurar tradução → Desenho do texto → SVG (texto vetorial · experimental)** e salve. Canvas permanece disponível e é o padrão. A opção fica salva neste navegador; ao mudar, as imagens renderizadas são descartadas e reconstruídas com os resultados de OCR/tradução em cache quando disponíveis.

Recarregue completamente com Ctrl+Shift+R depois desta alteração. Para ligar a WebUI, use `corepack pnpm reader:dev` na pasta `suwayomi-leitor`.

## Implementação

Após o usuário confirmar melhora sem contorno, mas considerar as letras finas, ajustamos o reforço para 1,5% do tamanho da fonte, com junções arredondadas. O reforço anterior era de 4,5%. Aplica-se às faces Comic Neue em negrito; a fonte regular permanece sem reforço. Essa calibração ainda depende de conferência na escala de leitura do usuário.

Após a captura com letras pequenas e espaços internos fechados, removemos o contorno adicional das letras SVG, mantendo a fonte bold incorporada. O traço adicional podia reforçar demais as letras quando a página era reduzida para caber na tela. Essa é uma hipótese para o caso mostrado, não um diagnóstico da placa de vídeo. O encaixe conserva suas margens anteriores; a nitidez precisa ser comparada na mesma escala de tela.

O arquivo SVG contém a imagem limpa em PNG e as falas com encaixe aprovado como **contornos vetoriais** (`<path>`), como um PDF desenha texto. As formas das letras são extraídas das fontes Comic Neue/Bangers com `opentype.js` (MIT), copiado por `reader:prepare` para `public/ocr-web/vendor/opentype.module.js`. A posição é a mesma do Canvas: largura de avanço com kerning centralizada em `x`, linha de base em `y`. O texto original de cada balão fica em `<title>`. Sem a biblioteca, o SVG volta a usar `<text>` com a fonte incorporada.

Motivo: imagens SVG com `<text>` eram desenhadas pelo navegador já no tamanho final da tela, com hinting. Com a página reduzida (letras de 7–8 px), o "o" e o "e" fechavam e o texto ficava mais fino e serrilhado que o Canvas, que desenha em escala maior e reduz a imagem inteira. Contornos são preenchidos como qualquer forma vetorial: em tamanho reduzido ficam iguais ao Canvas e, ampliados, continuam nítidos enquanto o Canvas pixeliza (comparação no Edge, página 20 de Sorcerer Supreme). Com contornos, o reforço do traço é o mesmo do Canvas (4,5% no "negrito reforçado", nenhum no negrito comum), já reservado pelo encaixe. O reforço de 1,5% permanece apenas no modo `<text>`: ali, um traço fino sobre glifos com hinting fechava os espaços internos.

## SVG leve

**Desenho do texto → SVG leve (texto vetorial · fundo JPEG)** é a variante recomendada; o SVG com fundo PNG sem perdas continua disponível. Diferenças: o fundo é incorporado em JPEG (qualidade 0,92) em vez de PNG, e cada letra é definida uma vez em `<defs>` (em unidades da fonte) e posicionada com `<use>` dentro de `translate(x y) scale(tamanho/unitsPerEm)`; o reforço do traço é convertido para unidades da fonte. Como o texto continua vetorial por cima, a compressão do JPEG não atinge as letras. O fundo também fica na resolução original da página: a ampliação de até 3× existe só para nitidez das letras do Canvas; aqui `<image>` estica o fundo até o mesmo `viewBox`. Num scan a 30% (596×917), o fundo incorporado cai de 1200×1846 para 596×917, o arquivo de 2,56 para 0,36 MB e a decodificação de 27 para 7 ms; o fundo fica mais suave que a ampliação por vizinho mais próximo do SVG completo, com o texto idêntico (recortes `svg-small-*-zoom.png`).

Medido na página 20 de Sorcerer Supreme (Edge headless, `node tools/svg-light-check.cjs` com o servidor na 3003): 14,1 MB → 2,2 MB, decodificação da imagem 114–118 ms → 21–22 ms, geração 1,05–1,10 s → 0,76–0,78 s; 567 letras usam 78 contornos. O texto sem fundo difere do SVG completo em 0,009% dos pixels de tinta; a diferença média do fundo é 1,06 em 255 por canal. Recortes ampliados (`svg-full-zoom.png`, `svg-light-zoom.png`) foram inspecionados e são visualmente idênticos. O decodificar de SVG roda na thread da interface no Chromium, por isso o arquivo menor reduz as travadas ao rolar.

O documento declara as mesmas dimensões do PNG gerado pelo Canvas (a escala interna de renderização, até 3× a página original), igual ao seu `viewBox`. Antes ele declarava as dimensões originais: em digitalizações pequenas, como as de 500×650, o modo "ajustar à tela" do leitor (que só reduz páginas, sem esticar) exibia o SVG menor que o Canvas, como se tivesse aplicado um zoom out. A imagem do quadrinho continua sendo raster: somente as letras são vetoriais.

Canvas e SVG compartilham análise do fundo, máscara, estilo e cálculo de linhas. As letras não são pintadas no PNG quando SVG é escolhido. Os textos são escapados para XML. O SVG mantém negrito, itálico e o reforço do traço; pode ser salvo como artefato independente pelo comparativo.

O encaixe agora também procura posições verticais alternativas no interior do balão, mantendo o limite de fonte e verificando as faixas livres de cada linha. Essa mudança tenta resolver recusas causadas por centralização rígida, sem reduzir indiscriminadamente o tamanho das letras.

## Verificações e resultados disponíveis

```powershell
node tools/svg-lettering-unit-check.mjs
node tools/batman-regression-check.mjs
```

Executados: verificações de estrutura/escape do SVG, dimensões originais, tratamento de amarelo com variação tonal, concavidades e buracos fechados da máscara, encaixe com posição deslocada e regressões geométricas anteriores. O teste de encaixe usa métricas sintéticas, não as fontes renderizadas num navegador. Esses resultados não comprovam nitidez, ausência de resíduos ou encaixe de todos os balões reais.

Comparativo visual preparado para a página 20 de Sorcerer Supreme:

```powershell
npm run ocr:web
node tools/svg-lettering-check.cjs
```

Usa a imagem e o OCR reais já salvos em `ocr-runs/sorcerer-supreme-1`, e traduções de referência escritas para o teste em `tools/fixtures/sorcerer-page20-translations.json`. Não usa a chave Gemini nem chama um tradutor. Não reproduz necessariamente a tradução exata que foi recusada no navegador do usuário.

Se executado, salva SVG, PNG Canvas, PNG SVG, recorte ampliado e relatório nessa pasta. Verifica carregamento do SVG como imagem, dimensões iguais às do Canvas, letras em contornos (sem `<text>`), texto completo e recursos externos. A tentativa neste ambiente foi bloqueada por `browserType.launch: spawn EPERM` ao lançar o Edge. O comparativo visual, portanto, ainda está pendente; não há resultado real de nitidez ou contagem de balões aplicados nesta etapa.

## Próximas etapas

### Validação posterior: amarelos da página 20

Com o lançamento do Edge permitido, `svg-lettering-check.cjs` foi executado no navegador. Canvas e SVG aplicaram os 11 trechos da referência, mantendo o texto completo e as dimensões originais (à época; hoje o SVG usa as dimensões do Canvas), com fontes incorporadas e sem recursos externos no SVG. A imagem SVG rasterizada foi inspecionada visualmente. O SVG gerado tem aproximadamente 13,6 MB: o fundo PNG incorporado contribui significativamente para o tamanho.

Os destaques quase brancos do papel amarelo eram confundidos com obstáculos, fragmentando as faixas livres e deslocando linhas. Agora esses destaques são aceitos como papel em fundos claros; em fundos escuros, branco ainda pode ser texto. A máscara dos fundos tonais também cobre um halo proporcional à altura da linha, recortado pelo interior e protegido do contorno. O limite de área apagada considera essa expansão, evitando recusar um balão denso apenas porque a limpeza também cobriu o halo.

A reconstrução nesses fundos usa um campo suave quadrático estimado dos pixels de papel, em vez de copiar os pixels mais próximos, o que podia reproduzir estruturas parecidas com letras antigas. Esse campo admite variações curvas/radiais suaves e é uma aproximação do fundo; não recupera exatamente os detalhes originais. Após a correção, os grandes espaços irregulares e os resíduos claros mais evidentes do exemplo diminuíram. Os testes unitários e as regressões geométricas também passaram. Isso valida o exemplo com traduções de referência, não todos os estilos de balão nem a tradução exata da sessão do usuário.

Continuar polindo a máscara e o encaixe sem modelos adicionais, usando os casos reais. Depois implementar um método de inpainting com IA como escolha separada do renderizador (SVG/Canvas), com download e custo de processamento próprios. Essa opção de IA ainda não está implementada; OCR e tradução Gemini existentes não substituem o inpainting.
