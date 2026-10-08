# Batman — Bbato, capítulo 1

Teste local em 6 de outubro de 2026. Obra da biblioteca: manga 337, capítulo 62, 43 páginas. Não é o Absolute Batman da GlobalComix.

Abra o capítulo em http://127.0.0.1:4567/manga/337/chapter/62. Para usar nosso leitor, abra http://127.0.0.1:3003/chapter.html e informe esse endereço no campo do capítulo.

## OCR real do capítulo inteiro

- WASM com quatro threads; 43 páginas processadas.
- Aproximadamente 36,9 segundos somando o OCR, sem incluir download e tradução.
- 331 regiões reconhecidas; 301 selecionadas pelo filtro. Esses números não medem acurácia.
- Nenhuma imagem atingiu o critério de miniatura que pausa a tradução. Muitas páginas têm apenas cerca de 500 × 730 pixels.
- Página 2 sem trecho selecionado; não foi comprovado que exista uma fala perdida nela.

Nas páginas 11 e 21, conferidas visualmente, as palavras foram majoritariamente preservadas. Houve perda de pontuação; na página 21, “I, now...” ficou apenas “now”. A ordenação geométrica também pode diferir da ordem de leitura. Não há referência humana para todas as 43 páginas, portanto não calculamos uma taxa de acerto do capítulo.

## Tradução e renderização

Teste real com Google experimental, sem chave, nas páginas 11 e 21: os nove e seis trechos selecionados, respectivamente, receberam tradução. Não foi testada a tradução das 43 páginas.

Com a renderização atual, a página 11 inseriu zero traduções na imagem e a página 21 inseriu duas. Falas que não cabem ficam disponíveis no painel; nomes idênticos ao original não precisam de substituição.

O experimento `ReadableLettering` duplica apenas a escala de renderização das imagens menores que 1000 pixels de largura, mantendo o OCR na resolução original. Inseriu sete e cinco traduções, respectivamente, mas a inspeção dos PNGs mostrou restos de inglês em alguns balões. Por isso, permanece restrito ao comparativo: o leitor continua usando `Lettering`.

Prioridade seguinte: melhorar a cobertura da máscara de limpeza e o encaixe do português nos balões pequenos, conferindo os pixels do resultado. Aumentar a resolução de renderização não recupera detalhes ausentes da imagem original.

## Ajuste de fonte proporcional

Após a revisão do usuário, removemos o mínimo fixo de 12 pixels: o limite inferior passa a acompanhar a altura estimada das letras originais, com margem e espaçamento também proporcionais. A busca continua escolhendo o maior tamanho que cabe nas linhas do balão; não há redução fixa aplicada a todas as falas.

No novo teste real, `Lettering` inseriu oito traduções na página 11 e cinco na página 21, mantendo o nome Bruce. As imagens permanecem na resolução original. A inspeção visual confirmou o encaixe, mas também restos de inglês, inclusive no balão “You're still...” e na legenda “can't feel...”. Portanto, a contagem de textos aplicados não representa sucesso da limpeza. Ainda precisamos corrigir a máscara. Este ajuste não foi validado em todos os mangás ou em todas as 43 páginas.

## Reprodução e evidências

### Renderização automática (7 de outubro)

A opção manual Original/2× foi removida. O leitor calcula uma escala contínua para aproximar o lado menor de 1200 pixels, limitada a 3× e 12 milhões de pixels na imagem ampliada. Páginas com lado menor já igual ou superior a 1200 pixels permanecem em 1×. Uma página de 500×730 é renderizada em aproximadamente 2,4×. A preferência manual antiga deixa de ser usada.

A fonte continua ajustada ao espaço do balão. OCR, avaliação da qualidade e cache mantêm a resolução original; upscale não recupera falas vazias. O aviso existente para miniaturas continua pausando a tradução por padrão, com explicação de que uma fonte em melhor resolução é necessária. Essa heurística não comprova que toda imagem abaixo do limite seja ilegível. O estado do leitor informa a escala automática. Esta alteração não teve nova execução de testes.

### Investigação adicional antes de desligar o PC

Corrigindo o diagnóstico anterior: a segunda fala rosa no alto da página 30 **foi detectada**. O detector retornou uma região [186,54,282,77] com confiança 0,933 e balão correspondente. A etapa posterior produziu zero linhas/texto, e o filtro a ignorou por estar vazia; não era ausência de detecção do balão.

Teste real no navegador, sem tradução, com a mesma imagem PNG nas escalas 1× e 2×: na original a região continuou vazia; ampliada com Canvas e suavização padrão, o pipeline reconheceu integralmente “Even without your arm / and covered with dirt”, com confiança de aproximadamente 0,986 e 0,989 por linha. Isso mostra que uma segunda tentativa ampliada pode recuperar esse caso. O upscale de renderização disponível no leitor não altera o OCR, portanto não recupera essa fala sozinho. O experimento não foi incorporado automaticamente ao leitor nem validado em todo o capítulo.

Os tempos de 2468 ms em 1× e 728 ms em 2× não permitem concluir que ampliar é mais rápido: a primeira execução inicializa sessões e a segunda as reutiliza. Uma implementação futura deve tentar novamente somente regiões vazias ou incertas, remapear coordenadas e invalidar o cache OCR correspondente. A imagem ampliada não recupera detalhes ausentes; pode mudar o comportamento da detecção de linhas.

Reprodução: `node tools/bbato-recognition-upscale-check.cjs`. Evidência local: `ocr-runs/bbato-batman-1/recognition-upscale-check.json`. A auditoria da máscara nas 43 páginas também foi atualizada em `cleanup-audit.json`; contagens de regiões disponíveis não provam ausência de resíduos nem qualidade visual de todo o capítulo.

### Correção das cinco recusas de encaixe

A escolha do fundo conectado por um ponto próximo ao centro podia cair no espaço interno de uma letra (O/e/a). Esse componente pequeno limitava a máscara, deixando tinta original que restringia os spans de renderização. A escolha agora examina os componentes de fundo dentro da caixa do balão e seleciona o maior, evitando confundir o espaço interno de uma letra com o interior do balão.

No novo teste real das páginas 5, 7, 11, 21 e 30 não houve recusa de aplicação apenas no painel, nos modos original e 2×. Os cinco casos anteriormente recusados (“Thank you…”, “Huh? Really? Thanks”, “Thanks…”, “now” e “Ugh”) receberam tradução na imagem. Contagens aplicadas: 10, 6, 8, 5 e 8, respectivamente; os demais trechos selecionados tinham tradução igual ao original. A inspeção dos PNGs ampliados das páginas 7, 11, 21 e 30 confirmou o encaixe e preservação do contorno do balão da captura. Persistem limitações de detecção, resíduos pontuais e possibilidade de escolha errada quando o fundo externo tem a mesma cor do balão; isso não comprova acerto de todos os balões do capítulo.

### Captura da página 7: blocos sobre o contorno

A captura enviada pelo usuário (`Captura de tela 2026-10-06 221437.png`) corresponde ao balão sobre o projeto de redesenvolvimento da página 7. A recuperação por caixas das linhas atravessava o contorno curvo. Agora identificamos o fundo conectado ao centro do texto e delimitamos seu interior por linha da imagem; a recuperação e a expansão da máscara são recortadas por esse interior. A proteção anterior baseada em traços longos foi retirada porque preservava também trechos de letras.

O comparativo real foi ampliado para as páginas 5, 7, 11, 21 e 30. A inspeção da página 7 confirmou a remoção dos blocos que ultrapassavam o contorno no balão indicado. Persistem resíduos pontuais e falas no painel por falta de encaixe seguro, inclusive na página 11; não tratamos o conjunto como renderização perfeita. O método continua heurístico e pode falhar quando o fundo vaza por um contorno aberto para outra região de cor semelhante.

### Recuperação de letras ligadas ao contorno

A máscara agora recupera pixels de componentes preservados somente dentro das caixas das linhas OCR e de um limite interno do balão. Isso permite apagar a parte correspondente às letras sem apagar o componente inteiro, que também contém a borda. O renderizador passa a considerar esse espaço limpo ao encaixar a tradução.

Teste real e inspeção das páginas 5, 11, 21 e 30, em resolução original e ampliada: as sobras evidentes de “Why”, “You're still”, “Going out”, “can't feel” e “than hatred” foram removidas nos resultados ampliados conferidos. Foram aplicadas 10, 8, 5 e 8 traduções, respectivamente; os nomes e interjeições idênticos foram preservados. Persistem pequenos defeitos junto a contornos e falas ausentes da detecção. A recuperação usa caixas retangulares e pode afetar um trecho da borda quando a caixa OCR inclui essa borda; não representa segmentação perfeita do balão.

Uma alternativa com limiar mais alto para separar apenas pixels de tinta forte foi testada e descartada: apagava partes dos contornos claros dos balões cinza e deixava letras em algumas regiões. O limiar anterior foi mantido, com recuperação limitada às linhas OCR.

### Investigação dos fundos e contornos

A auditoria real das regiões das 43 páginas encontrou 37 recusas por fundo não uniforme antes da correção. O critério exigia canais de cor acima de 165: recusava fundos cinza e rosa uniformes, incluindo texto branco em fundo escuro. Removemos a exigência de brilho, mantendo a exigência de uniformidade, e escolhemos texto branco para fundos escuros. Após a alteração, restaram quatro recusas desse tipo (páginas 6, 12, 18 e 38). O teste utiliza as regiões OCR já salvas, sem refazer reconhecimento.

Tradução real e inspeção visual das páginas 5, 11, 21 e 30 confirmaram melhoria em balões cinza e rosa. Porém, ainda existem restos de inglês. A instrumentação da máscara identificou letras conectadas ao contorno: por exemplo, na página 11 a região s3 tem um componente de 109 × 54 pixels; na página 21, s2, um de 91 × 45. Esses componentes alcançam os limites do recorte e são preservados. A baixa resolução pode favorecer essa união; o algoritmo de componentes atual não separa letra e contorno quando eles se tocam. Não basta upscale. Ainda precisamos de uma separação da máscara de texto e do contorno para esses casos; não consideramos a renderização resolvida.

Auditoria reproduzível: `node tools/bbato-cleanup-audit.cjs`, resultado `ocr-runs/bbato-batman-1/cleanup-audit.json`. O comparativo de tradução agora inclui as quatro páginas acima. Também há falas não detectadas (por exemplo, a segunda fala rosa no alto da página 30): precisam de revisão da detecção, independentemente da máscara de limpeza.

O leitor agora permite selecionar **Renderização → Ampliada 2× (experimental)**. Essa opção redesenha imediatamente o resultado existente, sem repetir OCR ou tradução, e salva a preferência. O padrão continua sendo Original. O canvas tem duas vezes a largura e altura (quatro vezes a quantidade de pixels), com ampliação simples sem suavização. A máscara também é calculada nessa escala: os restos de inglês relatados acima continuam sendo uma limitação, não uma correção proporcionada pelo upscale. Esta integração da opção não teve uma nova rodada de testes automatizados.

Com os servidores locais ativos:

```powershell
node tools/chapter-ocr-diagnostics.cjs 62 bbato-batman-1
node tools/bbato-reader-check.cjs
```

Resultados locais em `ocr-runs/bbato-batman-1/`: `summary.json`, JSONs por página, imagens originais, `translation-render-check.json`, `translated-011.png`, `translated-021.png`, `readable-011.png` e `readable-021.png`. Essa pasta é ignorada pelo Git.
