# Texto SVG no leitor — etapa experimental

## Usar

Na WebUI modificada (5173), abra o leitor, **Configurar tradução → Desenho do texto → SVG (texto vetorial · experimental)** e salve. Canvas permanece disponível e é o padrão. A opção fica salva neste navegador; ao mudar, as imagens renderizadas são descartadas e reconstruídas com os resultados de OCR/tradução em cache quando disponíveis.

Recarregue completamente com Ctrl+Shift+R depois desta alteração. Para ligar a WebUI, use `corepack pnpm reader:dev` na pasta `suwayomi-leitor`.

## Implementação

Após o usuário confirmar melhora sem contorno, mas considerar as letras finas, ajustamos o reforço para 1,5% do tamanho da fonte, com junções arredondadas. O reforço anterior era de 4,5%. Aplica-se às faces Comic Neue em negrito; a fonte regular permanece sem reforço. Essa calibração ainda depende de conferência na escala de leitura do usuário.

Após a captura com letras pequenas e espaços internos fechados, removemos o contorno adicional das letras SVG, mantendo a fonte bold incorporada. O traço adicional podia reforçar demais as letras quando a página era reduzida para caber na tela. Essa é uma hipótese para o caso mostrado, não um diagnóstico da placa de vídeo. O encaixe conserva suas margens anteriores; a nitidez precisa ser comparada na mesma escala de tela.

O arquivo SVG contém a imagem limpa em PNG e elementos `<text>` para as falas que tiveram encaixe aprovado. As fontes Comic Neue/Bangers utilizadas são incorporadas como dados, assim como o PNG, pois imagens SVG carregadas por `<img>` não devem depender de recursos externos. O documento mantém as dimensões originais da página; seu `viewBox` usa a escala interna de renderização. A imagem do quadrinho continua sendo raster: somente as letras são vetoriais.

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

Se executado, salva SVG, PNG Canvas, PNG SVG, recorte ampliado e relatório nessa pasta. Verifica carregamento do SVG como imagem, fontes incorporadas, texto completo e recursos externos. A tentativa neste ambiente foi bloqueada por `browserType.launch: spawn EPERM` ao lançar o Edge. O comparativo visual, portanto, ainda está pendente; não há resultado real de nitidez ou contagem de balões aplicados nesta etapa.

## Próximas etapas

### Validação posterior: amarelos da página 20

Com o lançamento do Edge permitido, `svg-lettering-check.cjs` foi executado no navegador. Canvas e SVG aplicaram os 11 trechos da referência, mantendo o texto completo e as dimensões originais, com fontes incorporadas e sem recursos externos no SVG. A imagem SVG rasterizada foi inspecionada visualmente. O SVG gerado tem aproximadamente 13,6 MB: o fundo PNG incorporado contribui significativamente para o tamanho.

Os destaques quase brancos do papel amarelo eram confundidos com obstáculos, fragmentando as faixas livres e deslocando linhas. Agora esses destaques são aceitos como papel em fundos claros; em fundos escuros, branco ainda pode ser texto. A máscara dos fundos tonais também cobre um halo proporcional à altura da linha, recortado pelo interior e protegido do contorno. O limite de área apagada considera essa expansão, evitando recusar um balão denso apenas porque a limpeza também cobriu o halo.

A reconstrução nesses fundos usa um campo suave quadrático estimado dos pixels de papel, em vez de copiar os pixels mais próximos, o que podia reproduzir estruturas parecidas com letras antigas. Esse campo admite variações curvas/radiais suaves e é uma aproximação do fundo; não recupera exatamente os detalhes originais. Após a correção, os grandes espaços irregulares e os resíduos claros mais evidentes do exemplo diminuíram. Os testes unitários e as regressões geométricas também passaram. Isso valida o exemplo com traduções de referência, não todos os estilos de balão nem a tradução exata da sessão do usuário.

Continuar polindo a máscara e o encaixe sem modelos adicionais, usando os casos reais. Depois implementar um método de inpainting com IA como escolha separada do renderizador (SVG/Canvas), com download e custo de processamento próprios. Essa opção de IA ainda não está implementada; OCR e tradução Gemini existentes não substituem o inpainting.
