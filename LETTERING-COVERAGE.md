# Limpeza e renderização sem outro modelo

Alteração de 7 de outubro de 2026, compartilhada pelo protótipo e pelo leitor nativo.

## O que foi implementado

- Estimativa do fundo em RGB com ajuste robusto de um plano de cor por canal. Suporta cores uniformes e variações suaves lineares, incluindo degradês; avalia cobertura e distribuição espacial para rejeitar fundos irregulares.
- Preenchimento de cada pixel da máscara com a cor estimada naquela posição, em vez de uma única cor para toda a região.
- Escolha de letras claras ou escuras por luminância e contraste. Um vermelho escuro deixa de ser considerado claro somente porque seu canal vermelho é alto.
- Interior do balão obtido pela região de fundo conectada e preenchimento de buracos fechados. As concavidades ligadas ao exterior são preservadas, evitando a antiga aproximação por faixa entre o primeiro e o último pixel de cada linha.
- Recuperação limitada de letras conectadas ao contorno usando as caixas OCR e presença de fundo em lados opostos do traço.
- Legendas e regiões sem balão detectado podem usar uma área inferida a partir do texto, com critérios de fundo mais rigorosos; não são recusadas apenas por faltar a caixa de balão.
- O encaixe busca faixas efetivamente livres dentro da máscara, incluindo regiões deslocadas em relação ao centro original.
- No painel do leitor nativo, **Atualizar imagem** permite refazer o processamento da página. Resultados completos de OCR/tradução são reutilizados quando disponíveis no cache.

Implementação principal: `public/ocr-web/lettering-surface.js` e `lettering.js`. Nenhum modelo adicional, chave, serviço externo ou dependência de processamento foi introduzido.

## Limites

### Reconstrução clássica e verificação da máscara

Acrescentamos uma segunda passagem que recupera traços de tinta dentro do suporte OCR e de um interior afastado do contorno. A recuperação respeita a polaridade das letras (claras/escuras), não cresce fora do balão e mantém proteção junto à borda. Pequenas ilhas de papel separadas por traços finos podem ser ligadas na região de texto antes de construir o interior; isso ajuda imagens pequenas onde letras e contorno se encostam.

O campo de fundo uniforme, linear ou curvo continua sendo a base. Agora aplicamos correções limitadas de cor por difusão a partir dos pixels de papel visíveis na fronteira da máscara, para reduzir emendas. Somente os pixels mascarados são compostos sobre a imagem; a origem permanece intacta. Regiões grandes têm limite de memória/iterações e podem usar apenas o campo de fundo.

A qualidade geométrica fica disponível em `cleanupQuality`: pixels mascarados, traços recuperados, tinta próxima à margem protegida, amostras de fronteira e erro médio de cor. Esses indicadores não são uma taxa de remoção de palavras; não detectam texto que o OCR deixou de localizar.

Validação no navegador com dados salvos, sem chamadas de tradução: cinco páginas do Batman (5, 7, 11, 21, 30) mantiveram 10, 6, 8, 5 e 8 traduções aplicadas, respectivamente, sem recusas no painel na amostra. A inspeção das páginas 7 e 11 confirmou manutenção do contorno do caso anterior e redução da sobra “Going out”, embora persistam pequenos traços junto à borda na página 11. A página 20 de Sorcerer Supreme manteve os 11 textos de referência completos no SVG. Isso não valida todos os capítulos nem fundos ilustrados.

Reprodução: `node tools/local-inpaint-check.cjs`, `node tools/svg-lettering-check.cjs` e `node tools/svg-lettering-unit-check.mjs`, com o servidor do protótipo em 3003. Os testes unitários verificam também recuperação de tinta não mascarada, proteção da borda e preservação dos pixels de origem.

### Caso real: Sorcerer Supreme, página 20

A imagem salva tem 11 trechos, incluindo seis balões amarelos (`s2`, `s5`, `s6`, `s8`, `s9`, `s10`). A análise anterior recusava todos os amarelos: os tons distribuídos do fundo não cabiam no ajuste espacial de cor e a cobertura ficava entre aproximadamente 20% e 30%.

Adicionamos um fallback para famílias de cores que variam em direção ao branco, com restrições de cobertura e distribuição espacial. Na análise dos pixels desses seis balões, a cobertura passou a aproximadamente 66–72%, e todos deixaram de ser recusados na estimativa do fundo. A limpeza utiliza interpolação a partir do papel visível mais próximo em oito direções. Não adiciona modelo, não reconstrói ilustrações e não garante preservar exatamente a textura original.

Essa análise de fundo foi executada sobre os pixels reais salvos; a renderização final e seu encaixe não foram validados nesta correção. Aceitar o fundo não comprova que os onze trechos serão desenhados na imagem.

Isso amplia a cobertura; não torna o leitor universal. Texturas, transparências sobre desenhos, degradês não lineares fortes, letras misturadas à ilustração e contornos abertos podem impedir uma máscara confiável. Nesses casos, a tradução continua no painel com um motivo. O encaixe e a remoção dos caracteres ainda dependem das caixas e linhas encontradas pelo OCR. A reconstrução suave não inventa detalhes de uma ilustração.

A recuperação do contorno e os limiares de cobertura são heurísticos. Ainda podem preservar resíduos de letras ou alterar um detalhe próximo à borda. Esta alteração não teve nova execução de testes nem validação visual; não há taxa de acerto comprovada para cores ou formatos.

## Usar no leitor

Recarregue completamente a WebUI com Ctrl+Shift+R e reabra o capítulo. Não é necessário invalidar o cache de OCR/tradução para testar a nova renderização. O painel de informações, na direita, apresenta os motivos dos casos que permanecem apenas em texto. A WebUI em 5173 serve o novo módulo automaticamente; o servidor separado do protótipo em 3003 precisa reiniciar para incluir arquivos novos em sua lista de recursos.
