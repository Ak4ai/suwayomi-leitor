# Experimento de OCR no navegador

## Suwayomi Server local — 06/10/2026

Servidor oficial v2.4.2366 instalado em `.local-server`, com dados persistentes no projeto, biblioteca em `http://127.0.0.1:4567/library` e duas amostras locais. O protótipo de capítulos já usa esse servidor. Reinicialização e persistência verificadas, além de OCR/tradução reais e navegação pelo navegador. Comandos e limites em [SUWAYOMI-LOCAL.md](SUWAYOMI-LOCAL.md).

## Resposta parcial do MyMemory — 06/10/2026

Reproduzida a perda de conteúdo informada pelo usuário: a resposta `Não sei como.` vinha de uma frase parcialmente semelhante, com índice 0,44. Agora a resposta é recusada, não salva como concluída; os outros balões são tentados e a falha fica explícita. MyMemory/Google têm timeout de 15 s por chamada. Acrescentado Google experimental sem chave no leitor de capítulos, com teste real preservando as três frases do exemplo. Cache MyMemory anterior invalidado sem apagar OCR ou cache Gemini. Detalhes e limitações em [CHAPTER-READER.md](CHAPTER-READER.md).

## Correções de capturas, tradução e preferências — 06/10/2026

No leitor de capítulos, acrescentados filtros de ruído com inspeção dos trechos ignorados, escopo somente balões, repetição da tradução em páginas prontas, reexecução explícita do OCR e retomada de páginas com falha. Gemini repete somente erros transitórios, até três tentativas. Preferências e modelo são lembrados; a chave pode ser salva localmente com opção de apagar. MyMemory passou a usar um endpoint HTTPS alternativo do mesmo serviço, testado de verdade no Edge com tradução concluída. Detalhes e limitações em [CHAPTER-READER.md](CHAPTER-READER.md).

## Leitura de capítulos com preparação antecipada — 06/10/2026

Disponível em `http://127.0.0.1:3003/chapter.html`: importação de várias imagens e abertura de capítulos pela API Suwayomi, fila serial com prioridade da página atual, preparação de próximas páginas ou capítulo inteiro, pausa, cache IndexedDB, alternância com original e narração. Mantidos V5 inglês, WASM e GPU. Instruções e limites em [CHAPTER-READER.md](CHAPTER-READER.md).

Testado OCR real nas 31 páginas do capítulo interno 134: soma de 55,59 s em WASM e 128,42 s em Automático, sem tradução. Fila, cache e interface passaram nos testes controlados. Tradução real MyMemory foi bloqueada pela conexão/certificado neste ambiente. Posteriormente a API Fly.io deixou de listar o capítulo e respondeu com biblioteca vazia; a abertura remota requer dados disponíveis no servidor. Esta etapa é o protótipo local conectado à API, com integração no leitor React nativo prevista para depois.

## Fidelidade e comparação com PP-OCRv6 — 06/10/2026

Comparados V5 inglês atual, V6 Tiny e V6 Small com uma transcrição visual da `7.jpg`. O Tiny reduziu o tempo completo de 1,509 s para 1,200 s em WASM, com dois espaços perdidos em falas e uma letra errada no texto decorativo. V5/Small acertaram 42 das 45 linhas únicas; Tiny acertou 39. Pontuação parcialmente fora dos recortes gera três linhas com diferenças comuns aos modelos. Mantido V5 como padrão. Metodologia, tempos WASM/WebGPU, erros e comandos em [OCR-FIDELITY.md](OCR-FIDELITY.md). Relatório visual local em `ocr-runs/recognition-fidelity-report.html`.

## Quatro testes adicionais no PC — 06/10/2026

Executados GPU por etapa, formatos fixos/captura na página inteira, argmax dos caracteres na GPU e reconhecedor convertido para FP16. Resultados e comandos em [GPU-PERFORMANCE.md](GPU-PERFORMANCE.md). WASM com quatro threads continuou mais rápido nesta amostra. A captura apresentou erros e textos repetidos, portanto foi rejeitada. Argmax GPU reduziu a saída baixada em 219 vezes sem ganho no total. FP16 reduziu o modelo em aproximadamente 49% e a etapa de reconhecimento em aproximadamente 16%, mas não acelerou a página inteira na repetição final. Mantido o padrão do leitor; modelos experimentais não substituem os originais.

## Experimentos de otimização WebGPU no PC — 06/10/2026

Mantido o comportamento do leitor. Os testes isolam o reconhecedor com os mesmos 46 recortes salvos da execução Automático da `7.jpg`; não incluem detector, detecção de linhas ou tradução. O modelo original aceita lote e largura variáveis, conforme metadados inspecionados via ONNX Runtime Python. Nenhum modelo foi alterado.

`node tools/ocr-gpu-batch-check.cjs` compara três execuções por variante. Média das duas últimas, incluindo montagem de tensores, inferência, leitura dos resultados e decodificação CTC:

| Variante | Chamadas | Tempo de reconhecimento |
|---|---:|---:|
| Uma linha por chamada | 46 | 2,66 s |
| Lotes de até 8, mesma largura | 26 | 2,62 s |
| Lotes de até 8, larguras arredondadas a 64 | 10 | 2,57 s |
| Lotes de até 8, larguras arredondadas a 128 | 7 | 2,87 s |
| Intervalos de 64, entrada via buffer GPU | 10 | 2,61 s |

Todos os textos da última execução de cada variante coincidiram com a execução sem lotes. A primeira rodada, com larguras exatas, havia mostrado ganho de aproximadamente 6%; a segunda mostrou aproximadamente 2%. Isso indica que ganhos pequenos precisam de mais repetições. Os intervalos aumentam apenas o preenchimento, mas podem alterar o reconhecimento em outras amostras. Entrada GPU explícita ainda recebe pixels preparados na CPU e requer upload; não elimina essa transferência nem o download das probabilidades. Esta implementação cria buffers por chamada e não mede reutilização de buffers de entrada entre lotes.

`node tools/ocr-gpu-batch-check.cjs --capture` testa captura de grafo com oito recortes de largura 320, dimensões fixadas, entrada GPU persistente e saída GPU baixada para CTC. Execução normal aquecida: média 359 ms; captura aquecida: média 349 ms. Textos idênticos e teste de alteração do conteúdo do buffer aprovado (linhas em ordem inversa). O ganho de aproximadamente 3% é pequeno, e essa medição exclui preparo/upload inicial dos recortes e criação das sessões. Não representa processamento de uma página inteira. A captura requer sessões adicionais para outros formatos, portanto não foi incorporada ao fluxo do leitor.

Relatórios: `ocr-runs/gpu-batch-check.json` e `ocr-runs/gpu-capture-check.json`. Código experimental em `tools/gpu-recognizer-worker.js`, servido somente pelo interceptador do teste. Resultados do Edge headless no PC, ordem fixa e uma imagem; sem conclusão para S23 ou qualidade em outras páginas. Referência das opções: [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).

## Avaliação dos provedores por etapa — 05/10/2026

`node tools/ocr-provider-check.cjs` compara quatro configurações, com uma execução inicial e duas reutilizando sessões, sem tradução. Relatório completo em `ocr-runs/provider-check.json`. A interface e o JSON agora informam tempo acumulado em `session.run` por modelo (`metrics.inferenceMs`) e número de chamadas (`metrics.calls`). `otherMs` inclui decodificação da imagem, preparação dos tensores, pós-processamento e mensagens. Esses tempos não são perfis de kernels e não separam transferências de execução da GPU.

Resultados no Edge 154 headless, Windows, adaptador WebGPU Intel gen-12lp. Média das duas execuções com sessões prontas, em segundos:

| Configuração | Total | Detector | Linhas | Leitura |
|---|---:|---:|---:|---:|
| WASM, 1 thread | 4,54 | 0,51 | 1,27 | 2,55 |
| WASM, 4 threads | 2,54 | 0,27 | 0,77 | 1,25 |
| Automático, 4 threads WASM | 7,08 | 1,48 | 1,48 | 3,82 |
| GPU somente no detector, 4 threads WASM | 5,32 | 1,69 | 1,36 | 1,92 |

WASM encontrou 15 regiões; os modos com detector WebGPU encontraram 16. Todas as configurações fizeram 46 chamadas de reconhecimento. O texto foi estável nas duas execuções aquecidas de cada configuração, mas não se afirma igualdade entre provedores nem precisão superior sem referência revisada. Não houve fallback por erro; `webgpu + wasm` continua representando provedores configurados, sem comprovar execução de todos os nós na GPU.

Nesta rodada, WASM com 4 threads foi o mais rápido. Reconhecimento das linhas foi a maior parcela de inferência. A variante com GPU somente no detector não trouxe ganho. A amostra é uma página e a ordem dos testes é fixa; tempos variam entre rodadas, e esta conclusão não estabelece o melhor provedor no S23. O padrão da interface permanece inalterado para permitir comparação no aparelho.

## Comparação experimental de threads WASM — 05/10/2026

O seletor permite comparar 1, 2 e 4 threads, mantendo 1 como padrão. Alterar o número encerra o worker anterior e recria o runtime; em WebGPU a opção afeta somente o trabalho que usa WASM. A resposta do OCR registra `threads` efetivamente utilizadas. Se não houver isolamento entre origens, o worker usa 1 mesmo que a seleção seja maior.

O servidor local fornece `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp`. A versão exportada requer os mesmos cabeçalhos no servidor de hospedagem, além de HTTPS ou localhost; HTTPS sozinho não basta para múltiplas threads. Recarregue a página após esta atualização.

Execute `node tools/ocr-threads-check.cjs` para três reconhecimentos por configuração, sem tradução. O teste compara textos e caixas exatamente, aceitando diferença de confiança inferior a 0,00001. Relatório em `ocr-runs/threads-check.json`. Não substitui medição no S23.

Nesta rodada no Edge/Windows, média das duas execuções com sessões já prontas: 1 thread = 4,81 s; 2 threads = 4,70 s; 4 threads = 3,63 s. Textos e caixas idênticos nos nove reconhecimentos; maior diferença de confiança = 0,000000477. Quatro threads reduziram aproximadamente 24% do tempo nesta rodada. A ordem fixa e a amostra pequena não comprovam o ganho em outros aparelhos; o padrão continua em 1 thread para comparação no celular.

## Reutilização das sessões — 05/10/2026

O worker e as três sessões ONNX permanecem disponíveis entre reconhecimentos na mesma página. Trocar o modo recria as sessões; cancelar, sair da página ou receber um erro na interface encerra o worker. Os modelos continuam ocupando memória enquanto o leitor estiver aberto. Nenhuma resolução, modelo ou limiar de reconhecimento foi alterado.

Teste real no Edge/Windows com `node tools/ocr-session-check.cjs`: WASM inicial 5,86 s (1,37 s de inicialização), segunda execução 4,16 s (sessões reutilizadas), com segmentos e textos idênticos. Uma troca para Automático e retorno a WASM também recriou as sessões corretamente. Resultado em `ocr-runs/session-check.json`. A redução observada foi aproximadamente 29% nesta comparação única; não é uma estimativa garantida para o S23. O painel mostra se os modelos foram reutilizados e o tempo de preparação.

## Limpeza leve e lettering — 05/10/2026

### Estilo por balão, sem modelo adicional

O encaixe agora usa a largura clara disponível em cada linha do balão e a altura estimada das letras originais, buscando letras maiores com margem para o contorno e os acentos. A sugestão automática prioriza negrito; **Negrito reforçado** acrescenta um traço fino sobre Comic Neue Bold, sem baixar outra fonte ou modelo. Regular continua disponível no ajuste manual. Traduções mais extensas podem precisar de letras menores para caber.

Validação desta revisão: `node tools/lettering-visual.cjs readability-final`, com as mesmas falas salvas da `7.jpg`. As 11 traduções continuam aplicadas; passaram as verificações de estilos, restauração do original, ordem de composição e largura móvel simulada. Pranchas em `ocr-runs/lettering-readability-final/`. A avaliação no S23 real continua pendente.

Abra **Estilo deste balão** no cartão de uma fala. Fonte, espessura e inclinação podem seguir a sugestão automática ou ser ajustadas separadamente. **Restaurar sugestão** remove os ajustes daquele balão. As mudanças são locais, não repetem OCR/tradução, não apagam o texto revisado e são incluídas no JSON exportado (`letteringStyle` e `letteringSuggestion`). Não há persistência automática após recarregar a página.

Fontes servidas localmente, com licenças OFL: Comic Neue regular, bold, italic e bold italic; Bangers regular como opção estreita de traço forte. Bangers não possui variante regular de espessura fina, portanto o controle de peso fica desabilitado para ela; a inclinação adicional pode ser sintetizada pelo navegador. Os cinco arquivos totalizam aproximadamente 316 KB, incluindo a fonte já existente. Nenhum modelo neural foi baixado.

A sugestão geométrica aproveita os componentes da máscara antes da limpeza: proporção largura/altura, aproximação da espessura por área/perímetro e deslocamento entre as partes superior/inferior da letra. Medianas reduzem influência de pontuação e caracteres atípicos. Com menos de quatro componentes adequados, usa Comic Neue bold normal e informa ausência de evidência suficiente. Esses critérios são heurísticos, não identificação da fonte nem confiança estatística calibrada. Aplicam-se ao balão inteiro; ênfases em palavras individuais ainda não são preservadas automaticamente.

Teste visual de estilos no Edge: `node tools/lettering-visual.cjs styles-final`. Inspecionados `ocr-runs/lettering-styles-final/font-comparison.png` e as pranchas da página. Passaram troca entre regular/bold/italic/Bangers, restauração do estilo sugerido, exportação dos ajustes, preservação do original, independência da ordem de composição e largura móvel simulada. As 11 falas traduzidas continuam aplicadas. O teste reutiliza a mesma imagem, OCR e traduções salvos, sem chamadas de IA; não comprova generalização da sugestão para outras fontes/páginas nem execução em S23 real.

A visualização traduzida usa Comic Neue Bold (arquivo e licença OFL distribuídos localmente) e centralização com ajuste de linhas/tamanho. Desmarcar **Mostrar tradução nos balões** restaura a imagem original. A preferência de tamanho está sujeita ao espaço disponível e ao limite de legibilidade.

O módulo `public/ocr-web/lettering.js` usa as caixas de balão e linhas existentes para estimar um fundo claro uniforme, separar componentes de letras dos contornos e ampliar a máscara em até dois pixels para reduzir resíduos, protegendo os demais componentes detectados. Somente os pixels mascarados são preenchidos com a cor estimada; não se desenha um retângulo branco. Regiões sem balão, com fundo incerto ou sem espaço para a tradução permanecem originais, com motivo indicado no painel. A máscara é heurística e pode confundir detalhes com letras; a alternância permite conferir o original. Este modo não reconstrói fundos ilustrados e não recupera a fonte original.

Nenhum modelo neural foi acrescentado. A fonte possui cerca de 56 KB. A implementação foi revisada após teste visual da `7.jpg` no Edge/Windows; o S23 ainda precisa de avaliação própria. Reinicie `npm run ocr:web` caso o servidor tenha iniciado antes da inclusão dos arquivos da fonte e módulo.

### Teste visual reproduzível

Com o laboratório ativo em localhost:3003, execute na pasta do projeto:

```powershell
node tools/lettering-visual.cjs final
```

Requer Edge, Playwright na instalação isolada `node_modules/ocr-check` e os artefatos locais `ocr-runs/web-local-7.json`, `ocr-runs/gemini-live-7.json` e `../imagensinputteste/7.jpg`. Para preparar a dependência: `npm install --prefix node_modules/ocr-check playwright`. O teste reutiliza OCR e tradução salvos, sem requisições a serviços de tradução. A etapa de interface substitui o worker pelo resultado salvo; não é uma nova avaliação do reconhecimento.

Gera `ocr-runs/lettering-final/`: página traduzida, três pranchas com original/máscara vermelha/limpeza/tradução, captura da interface e relatório JSON. Inspecionar as imagens faz parte da avaliação: uma contagem de regiões aplicada não comprova qualidade visual.

Na primeira execução, a heurística anterior recusou todos os balões. Após revisão, a máscara usa componentes conectados, protege componentes grandes ou ligados às bordas, inclui pontuação dentro da região de texto e preenche somente os pixels mascarados. A composição transparente impede que um recorte de balão restaure inglês sobre outro já traduzido. Foram inspecionadas as pranchas e a página inteira: 11 balões traduzidos; 3 regiões sem balão permanecem originais e o fragmento `CK?`, sem tradução diferente, também é preservado.

Verificações aprovadas: restauração exata do original, resultado independente da ordem de composição desta amostra, importação/ativação do botão na interface, alternância original/tradução e ausência de transbordamento horizontal na largura de 390 px. Nenhum erro JavaScript registrado. Isso não substitui testes em outros quadrinhos, fundos texturizados ou aparelhos reais. Detalhes isolados de arte dentro de caixas incorretas ainda podem ser confundidos com letras.

## Tradução sem chave e acesso pelo Tailscale

### Seleção de modelo Gemini pela chave

Diagnóstico real de `gemini-2.5-flash-lite`: o Google retornou HTTP 404 informando que o modelo não está mais disponível para novos usuários e indicando `gemini-3.5-flash-lite`. Isso demonstra que `models.list` não garante acesso à geração. O seletor agora restringe a listagem a famílias estáveis de texto Flash/Flash-Lite/Pro e aliases `latest`, excluindo previews e modelos especializados. A tradução apresenta o detalhe do erro Google sem a chave; HTTP 404 desabilita aquela opção até recarregar a lista. Nenhum teste de geração é feito automaticamente para cada modelo, pois consumiria cota. O substituto indicado pelo Google ainda não foi validado nesta alteração.

Selecione Gemini, cole a chave e clique em **Carregar modelos**. O seletor consulta `models.list` diretamente no Google, incluindo paginação, e apresenta modelos Gemini com `generateContent`, filtrando famílias especializadas conhecidas (imagem, voz etc.). Escolha explicitamente um modelo antes da tradução. A listagem não garante cota nem suporte ao formato JSON usado pelo tradutor.

Editar ou apagar a chave limpa a lista e cancela consultas pendentes. A chave e os modelos consultados permanecem apenas na sessão. A consulta tem limite de 30 segundos e informa falhas de autenticação, conexão e cota. Referência: [Models API](https://ai.google.dev/api/models#method:-models.list). Esta alteração do seletor não passou por novo teste de navegador.

### Tradução automática e teste real

O controle **Traduzir automaticamente após o OCR** vem marcado. Ao concluir o reconhecimento, a página envia as falas ao serviço selecionado. Desmarque para revisar antes do envio. No MyMemory, repetir a tradução mantém falas já concluídas do mesmo texto/provedor, inclusive correções feitas em português. Editar o inglês limpa a tradução correspondente.

Teste real em Edge/Windows com `7.jpg`: 15 respostas HTTP 200 do MyMemory e fluxo OCR → tradução → exportação concluído sem erros JavaScript. Evidência local em `ocr-runs/translation-live-7.json` e `ocr-runs/translation-live-export.json`. Nenhuma chave Gemini usada. A qualidade não é uniforme: `trade` virou `troca` em vez de encadernado e `Y'KNOW...` retornou sem alteração. Textos idênticos ao original agora são sinalizados para revisão; isso também pode ocorrer legitimamente com nomes próprios. Este teste valida o funcionamento, não a qualidade linguística de todas as falas nem a execução no S23.

Testes automatizados: `node tools/ocr_compare/test_translation.mjs` cobre limites UTF-8, reutilização de respostas, preservação de revisão, cota, falhas parciais, cancelamento e resposta inválida. `node tools/ocr_compare/test_web.mjs` continua passando.

A página oferece **MyMemory — online, sem chave** como opção inicial. Após revisar o OCR, clique em **Enviar textos ao MyMemory e traduzir**. Só as falas são enviadas diretamente do navegador ao serviço externo. Não é tradução offline nem ilimitada. Os trechos são divididos em até 500 bytes UTF-8, enviados sequencialmente e reutilizados em memória durante a sessão. Falas concluídas são preservadas se houver falha/cancelamento. Gemini continua disponível no seletor, com chave própria. A integração MyMemory ainda precisa de validação real no S23.

Referências: [API MyMemory](https://mymemory.translated.net/doc/spec.php), [limites de uso](https://mymemory.translated.net/doc/usagelimits.php). Não usamos os endpoints de contribuição de traduções.

Com o servidor local em execução (`npm run ocr:web`), o acesso privado HTTPS é configurado por:

```powershell
tailscale serve --bg --yes http://127.0.0.1:3003
tailscale serve status
```

Abra no S23 o endereço HTTPS informado pelo comando, com o Tailscale conectado nos dois aparelhos. O notebook precisa continuar ligado com o servidor Node ativo. Não é necessário expor uma porta pública nem usar Funnel. Para desligar esta publicação: `tailscale serve --https=443 off`.

Durante a configuração, o notebook apresentou perda de conexão com a coordenação Tailscale e a ativação HTTPS falhou. O nome identificado é `desktop-32f9g6n-1.tail1b5b08.ts.net`, mas o endereço só estará utilizável após o Serve concluir com sucesso. A simples resposta ao ping do S23 não comprova o funcionamento do HTTPS.

## Abrir

Na pasta `suwayomi-leitor`:

```powershell
npm run ocr:web
```

Acesse http://127.0.0.1:3003. Importe `../imagensinputteste/7.jpg`, escolha Automático ou WASM e clique em **Reconhecer texto**. Revise as falas e a ordem usando os campos e setas. Para tradução sem chave, deixe MyMemory selecionado e clique em **Enviar textos ao MyMemory e traduzir**. Para Gemini, selecione-o e informe sua chave e o identificador de um modelo disponível na conta.

O servidor Node distribui arquivos. O OCR roda em um Web Worker com ONNX Runtime Web 1.30.0, sem o backend Python do comparador. Os modelos são armazenados em Cache Storage e verificados com SHA-256 a cada carregamento. Não há persistência automática de páginas/resultados; exporte o JSON para guardá-los. Cancelar o OCR encerra o worker e descarta a execução incompleta.

## Recursos locais necessários

Os recursos já estão preparados neste workspace. Em outra instalação:

1. Prepare os pesos com o procedimento do comparador em `tools/ocr_compare` (consulte `OCR-COMPARISON.md`). São necessários `.ocr-models/rtdetr.onnx`, `.ocr-models/paddle/ch_PP-OCRv5_det_mobile.onnx` e `.ocr-models/paddle/en_PP-OCRv5_rec_mobile.onnx`.
2. Instale o runtime com `npm ci --prefix tools/ocr-web-runtime`.
3. Para regenerar o manifesto a partir dos pesos locais: `.venv-ocr/Scripts/python.exe tools/ocr_compare/prepare_web.py`. O Python só participa desta preparação.

O manifesto público `public/ocr-web/models.json` inclui tamanhos, hashes e o alfabeto CTC. Os três modelos somam aproximadamente 24 MB. Há também download do runtime WASM, que pode ter dezenas de MB: o tamanho dos modelos não representa o download total.

## Fluxo implementado

1. Importação local de JPG, PNG ou WebP, até 15 MB e 25 megapixels.
2. RT-DETR v2 INT8 do Comic Translate: regiões de texto e balões.
3. PP-OCRv5 mobile detector: mapa de texto por região. Pós-processamento JavaScript aproximado com componentes conectados e agrupamento horizontal de palavras.
4. PP-OCRv5 mobile inglês: reconhecimento e decodificação CTC por linha.
5. Revisão editável, mudança de ordem e exclusão de regiões.
6. Gemini opcional: envio apenas de IDs e texto, resposta JSON validada, cancelamento e limite de 120 segundos. Chave em memória/campo de senha, sem armazenamento ou exportação. O usuário deve confiar na origem que serve a página e nos scripts que ela executa.
7. Sobreposição opcional de caixas brancas com português, painel textual e síntese de voz do navegador. Se o texto não couber na caixa, permanece disponível no painel. A imagem original é preservada. Não há inpainting.

No modo automático cada modelo tenta WebGPU quando há adaptador, com alternativa WASM na inicialização e execução. O relatório indica os provedores configurados; isso não prova que todos os operadores executaram na GPU. Use WASM para uma referência explícita de CPU.

## Evidência e limites

Em 29/09/2026, teste real no Edge/Windows com `7.jpg`, usando apenas arquivos estáticos e WASM: **15 regiões em aproximadamente 6,7 segundos**, incluindo inicialização/download local. Os primeiros balões foram extraídos como `YOU MOSTLY / WAIT FOR THE / TRADE?` e `NO, NO, I BUY / SINGLE ISSUES, TOO. / IT DEPENDS ON / THE BOOK.`. Resultado em `ocr-runs/web-local-7.json` (artefato local ignorado pelo Git). Isso não é uma avaliação de acurácia nem medida de desempenho móvel. Há textos da arte e fragmentos indevidos.

Este port não reproduz o pós-processamento completo do PaddleOCR/Comic Translate: não corrige perspectiva/rotação, não usa máscaras precisas de balão e ordena regiões geometricamente. A revisão humana é parte do experimento. Tradução real exige chave; nenhuma chamada paga foi feita durante a implementação. Narração depende das vozes instaladas/disponíveis e pode usar serviços do aparelho.

Ainda pendentes: ensaios em Android/iPhone reais, avaliação com transcrição de referência, cache persistente de resultados, service worker para reabertura offline, testes reais Gemini na origem publicada e integração ao leitor Suwayomi. Este laboratório é uma página separada, não uma PWA instalável completa.

## Exportação estática

```powershell
npm run ocr:web:export
```

Gera `ocr-web-dist/` com a página, runtime e pesos. Sirva a pasta em HTTPS ou localhost; abrir o HTML por `file://` não funciona. Nenhum deploy é feito. OCR não exige servidor de inferência, mas hospedagem/tráfego e Gemini não têm gratuidade garantida. Consulte as licenças dos modelos e runtime antes de redistribuir.

Teste adicional no mesmo Edge: modo automático com WebGPU + WASM configurados, 16 regiões em 11,4 segundos. Houve variação nas detecções em relação a WASM, portanto os modos precisam de avaliação separada. O contrato Gemini foi testado com resposta simulada; CTC, agrupamento de palavras e NMS passaram em 
ode tools/ocr_compare/test_web.mjs. A exportação estática também foi executada.
