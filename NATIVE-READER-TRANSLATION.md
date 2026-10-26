# Tradução no leitor do Suwayomi

A primeira integração usa a WebUI modificada do projeto, sem abrir o protótipo `chapter.html`.

O módulo em `public/ocr-web` é carregado pelo navegador com uma entrada `<script type="module">` e entrega sua API à interface por um evento. Isso evita o erro do Vite ao importar recursos de `public` a partir de `src`. A API também permanece disponível para recarregamento dos componentes durante desenvolvimento.

## Abrir

Na pasta do projeto:

```powershell
npm run suwayomi:start
corepack pnpm install --frozen-lockfile
corepack pnpm reader:dev
```

Abra http://127.0.0.1:5173/library e abra um capítulo normalmente. A WebUI original instalada no servidor continua em 4567; as alterações desta implementação estão na WebUI de desenvolvimento em 5173.

No menu lateral do leitor, há **Traduzir automaticamente** e **Mostrar informações da tradução**. Os mesmos controles aparecem no diálogo de configurações, acessível também no celular. Em **Configurar tradução**, selecione Google sem chave, MyMemory ou Gemini, com chave e seleção de modelo. A chave só é persistida com a opção de lembrar ativada; fica em texto simples no armazenamento local. Preferências do protótipo em 3003 não migram automaticamente para 5173: são origens diferentes.

## Fluxo e painel

- Processa, numa fila serial, as páginas na tela ou a até meia tela de distância, mais as duas seguintes e a anterior. Ordem: página atual, as seguintes, depois a anterior. No modo webtoon/contínuo, uma página começa a ser traduzida ao se aproximar da borda de baixo, e não só quando seu topo chega ao topo da tela. Imagens descartadas da memória são restauradas do cache assim que a página volta para perto da tela (`public/ocr-web/native-queue.js`, verificado por `node tools/native-queue-check.mjs`). A medição só conta páginas do capítulo atual (`data-ihc-src` igual à URL da página): o leitor também monta páginas pré-carregadas dos capítulos vizinhos, e o índice delas (por exemplo, 122 do capítulo anterior) esticava a janela até o fim do capítulo. Com isso a fila seguia traduzindo páginas distantes e as páginas para as quais o leitor voltava, cujas imagens tinham sido liberadas, ficavam sem tradução e sem animação até a fila chegar nelas.
- Mantém o original até gerar o PNG traduzido; desligar a opção restaura o original.
- Reutiliza OCR, tradução, fontes, máscara e ampliação automática já existentes.
- Cancela processamento ao sair ou mudar de capítulo e libera URLs de imagens renderizadas.
- Nenhuma etapa pesada roda na thread da interface. OCR (`worker.js`), tradução local e LaMa já tinham workers próprios; limpeza dos balões, diagramação do texto e codificação PNG/SVG rodam em `render-worker.js` com `OffscreenCanvas` (o LaMa vira um worker aninhado dele). Sem `OffscreenCanvas`/`FontFace` em workers, o desenho volta para a página. O OCR usa 4 threads só com 8+ núcleos, senão 2, para sobrar CPU para rolagem e decodificação. Cada página do leitor assina só o próprio estado (`usePageTranslation`), então mensagens de progresso não re-renderizam o capítulo inteiro. A fila notifica o React no máximo a cada 50 ms; o botão de controles só escuta `enabled`/`showInfo` e o painel só re-renderiza aberto. A imagem traduzida é decodificada (`img.decode()`) antes do fade, então a troca não trava a rolagem. Exibir SVG ainda roda na thread da interface: prefira **SVG leve** (fundo JPEG, ~2 MB por página em vez de ~14 MB; ver `SVG-READER.md`). Verificação: `node tools/render-worker-check.cjs` (com o servidor na 3003) compara saída e maior travada de quadro na página e no worker.
- Balões traduzidos (`BalloonOverlay.tsx`): o desenho devolve o contorno interno de cada balão redesenhado (`balloonOutline` em `lettering.js`, a partir das faixas de papel usadas no encaixe, suavizadas por mediana). Balões redesenhados ganham um brilho azul difuso em volta do bloco de texto (`balloon-glow.js`), feito como uma seleção suavizada no Photoshop: um retângulo por linha, expandido e desfocado (0,5 × fonte), com uma faixa larga e fraca em torno do contorno de 50%, desfocada de novo (0,22 × fonte) para parecer luz, não linha. É gerado duas vezes: em volta do texto traduzido e em volta do texto original (linhas do OCR), porque o original costuma ser maior; ao clicar no balão o leitor troca o texto e faz o crossfade entre os dois brilhos (o do original em âmbar). Não segue o recorte do balão, que pode ser irregular (por exemplo, após a limpeza com IA); o contorno do balão serve só para esmaecer o brilho onde o texto encosta na borda. Cada balão tem sua própria imagem pequena por texto ("sprite", com margem para o brilho chegar a zero), posicionada no leitor pelo retângulo normalizado: nada é recortado e o brilho de um balão vizinho nunca aparece dentro do outro, o que acontecia quando um PNG da página inteira era recortado por um retângulo em volta de cada balão. Na página de teste, 11 + 11 sprites somam ~290 + ~300 KB. Opacidade 75%, 100% com o mouse em cima. Verificação: `node tools/balloon-glow-check.cjs` (servidor na 3003). Uma camada SVG torna cada balão clicável: clique ou Enter/Espaço alterna entre tradução e original, sem trocar de página; o foco do teclado mostra um contorno. O original é a própria imagem já carregada, recortada pelo contorno — nada é renderizado de novo. Ele é um `<img>` com a mesma URL e o mesmo `crossOrigin` do leitor, recortado com `clip-path: polygon()`, e por isso vem do cache de imagens. Um `<image>` dentro do SVG fazia outra requisição, que o isolamento entre origens (COOP/COEP) bloqueava quando a API está em outra origem, como no `reader:dev` (5173 → 4567); nesse caso o clique e a animação não mostravam nada. Com **Animar tradução ao exibir a página** (padrão ligado), toda vez que a página aparece (inclusive logo após ser traduzida, ao voltar a ela no modo página única ou ao rolar de volta no webtoon) os balões começam no original e passam para a tradução um a um, na ordem de leitura (550 ms cada, 140 ms entre eles); dispara com um terço da página ou meia tela visível. Quem decide é a chave do leitor, não a preferência `prefers-reduced-motion` do sistema: o Windows a liga sempre que "Efeitos de animação" está desligado, o que escondia a animação pedida. **Destacar balões traduzidos** (padrão ligado) controla só o contorno; o clique funciona sempre. Cache de renderização v9 (`RENDER_CACHE` em `native-reader.js`; inclui contornos e os sprites de brilho). Suba a versão sempre que o desenho mudar: páginas já abertas vêm do IndexedDB.
- Mantém uma janela de imagens renderizadas em memória; OCR e tradução ficam no cache IndexedDB.
- O painel de status é fixo na margem esquerda, com altura limitada e rolagem interna. Não entra no fluxo abaixo da página.
- Quando a margem lateral não comporta o painel, usa um indicador recolhível sobre a área de leitura. Não há espaço garantido em páginas largas, leitura dupla ou celulares.
- Mostra falas, erros e motivos de traduções mantidas apenas nas informações. Permite tentar novamente a página em caso de falha.

## Recursos e limites

### Tradutores sem chave e bloqueio de CORS

No leitor local, Google/MyMemory agora usam um encaminhamento no próprio servidor Vite (5173), ou no servidor do protótipo. Isso resolve a impossibilidade de o navegador ler algumas respostas sem cabeçalho CORS e permite mostrar o status HTTP real. Os destinos são fixos, o texto é limitado a 500 bytes e chaves/API URLs arbitrárias não são aceitas. HTTPS e certificados continuam sendo validados.

No caso da página 3, reproduzimos o bloqueio de CORS na terceira fala. Pelo encaminhamento, o Google retornou HTTP 429. Portanto, o encaminhamento não elimina os limites do Google; após uma resposta 429 há uma pausa local mínima de 60 segundos (ou o Retry-After do serviço). MyMemory respondeu com sucesso numa frase curta pelo encaminhamento, mas suas correspondências parciais e cotas continuam sendo limitações.

Em hospedagem somente estática, o encaminhamento não existe e o cliente tenta a chamada direta. O texto passa pelo servidor local antes do tradutor quando o encaminhamento está disponível, conforme indicado nas configurações. O servidor não registra o texto nessa rota. Após instalar a alteração, reinicie `corepack pnpm reader:dev` caso o Vite não reinicie automaticamente e recarregue a página.

O seletor **Limpeza do texto original** oferece Leve (padrão) e LaMa com IA (experimental), independentemente de SVG/Canvas. O modelo opcional é carregado no navegador, com cache e progresso; veja `AI-INPAINT.md` para os resultados e limites medidos.

Em **Configurar tradução → Desenho do texto**, Canvas e SVG experimental podem ser comparados. SVG incorpora o fundo limpo como PNG e as letras como contornos vetoriais (`<path>`) extraídos das fontes. Veja `SVG-READER.md` para as verificações executadas e a limitação da validação visual neste ambiente.

`reader:prepare` copia os modelos e o runtime locais para `public/ocr-web/models` e `vendor`, ignorados pelo Git. Para distribuir uma build, prepare esses recursos antes de empacotá-la e configure HTTPS/localhost com COOP/COEP no host. A configuração Vite de desenvolvimento fornece os cabeçalhos necessários. O navegador precisa poder acessar as imagens do servidor com CORS.

A tradução automática é assíncrona: a primeira página exige carregar os modelos e executar OCR. Google sem chave permanece experimental. Gemini depende de cota e modelo disponível. O bloqueio de miniaturas permanece ativo e o upscale da renderização não recupera as regiões vazias do OCR.

Não foram adicionados nem executados testes nesta integração. Precisamos conferir visualmente o leitor normal, páginas duplas, mudanças de capítulo e telas estreitas antes de considerar a integração validada.
