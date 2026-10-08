# Leitura antecipada de capítulos — protótipo

Implementado em 06/10/2026. Abra **http://127.0.0.1:3003/chapter.html** após iniciar `npm run ocr:web`. Também há um link na página de teste original.

O servidor de teste agora é local: **http://127.0.0.1:4567**. Instalação, amostras disponíveis e comandos em [SUWAYOMI-LOCAL.md](SUWAYOMI-LOCAL.md). Banco e biblioteca foram conferidos após reiniciar o servidor. Os relatos de problemas com Fly.io abaixo descrevem os testes anteriores.

Análise de Absolute Batman Vol. 1 (179 páginas) em [ABSOLUTE-BATMAN-TEST.md](ABSOLUTE-BATMAN-TEST.md): a API entregou dez páginas em resolução normal e 169 miniaturas. O leitor agora informa a resolução baixa e pausa antes da tradução, com opção experimental de continuar. Foram corrigidas associação de caixas de balão e leitura de componentes minúsculos, e os motivos de manter a tradução somente no painel passaram a ser exibidos.

## Correções após o teste do leitor — 06/10/2026

### Respostas parciais e espera no MyMemory

Reproduzido com a fala fornecida pelo usuário: `I DON'T KNOW. I'M...JUST ONE PERSON. I DON'T KNOW HOW TO FIX THE WORLD.`. O serviço devolveu `Não sei como.` com `match: 0.44`, referente a `I don't know how to.`. O código anterior aceitava a primeira resposta não vazia, portanto uma correspondência parcial era salva como tradução completa.

Agora MyMemory aceita candidatos cuja frase de origem corresponde ao trecho solicitado, normalizando caixa, apóstrofos e pontuação final. Quando não há lista de candidatos, somente uma resposta com índice 1 pode passar, ainda sujeita ao teste de comprimento. Respostas muito curtas para falas longas são consideradas suspeitas, não prova matemática de erro; traduções concisas legítimas podem ser recusadas. O serviço pode não ter uma tradução completa para diálogos novos. Não foi confirmada geração automática de tradução completa neste exemplo, mesmo solicitando `mt=1`.

Uma resposta parcial é recusada e mostrada no painel como **Resposta recusada**; os outros balões da página continuam sendo tentados. A página fica com falha explícita se restarem falas não traduzidas, preservando as que deram certo. Erros de rede/cota interrompem a tentativa e deixam uma mensagem nas falas pendentes, em vez de permanecerem indefinidamente em **Aguardando tradução**. Cada requisição MyMemory/Google tem limite de 15 segundos, incluindo leitura do JSON. Cancelamento do usuário continua imediato.

O cache MyMemory ganhou a versão `memory-coverage-v2`, para não reaproveitar respostas parciais antigas. O cache de OCR e as traduções Gemini existentes continuam válidos. Traduções MyMemory concluídas na nova versão têm marca de validação para permitir retomada parcial.

Adicionada opção **Google — experimental, sem chave**, selecionada explicitamente pelo leitor. Usa `translate.googleapis.com/translate_a/single` como endpoint de compatibilidade, diferente da API Google Cloud paga; disponibilidade e limites podem mudar. Não há troca silenciosa de provedor. No teste real, a frase inteira retornou `NÃO SEI. EU SOU... APENAS UMA PESSOA. NÃO SEI COMO RESOLVER O MUNDO.`. Preservou as três frases, mas a escolha lexical ainda merece revisão; este teste não estabelece fidelidade geral do tradutor.

Testes: `node tools/translation-quality-check.mjs` verifica rejeição da resposta parcial observada, resposta curta, aceitação de correspondência completa, timeout e cancelamento. `node tools/translation-coverage-browser.cjs` simula a resposta parcial MyMemory, confirma que o balão seguinte continua, e testa Google de verdade com a frase fornecida pelo usuário. Nenhuma chave Gemini real foi usada nesses testes.

- Mantido PP-OCRv5 inglês, o melhor equilíbrio observado na comparação existente. Acrescentado filtro de números/símbolos e códigos curtos fora de balões, reconhecimento incerto e detecções duplicadas. O limiar heurístico de confiança é 0,65; não é probabilidade calibrada. Números dentro de balões confiáveis continuam disponíveis. **Trechos ignorados — conferir OCR** mostra o que foi filtrado e o motivo; é possível desativar o filtro ou escolher **Somente balões**. Os resultados brutos permanecem no cache. Não há garantia de eliminar todos os falsos positivos.
- Tradução usa uma nova identidade de cache com versão do filtro e escopo, evitando reaproveitar traduções antigas de capturas que agora são ignoradas.
- **Tentar tradução novamente** funciona também em páginas prontas, sem refazer o OCR; **Refazer OCR e tradução** ignora o resultado OCR salvo. Continuar a fila recoloca páginas com falha na preparação. Esses controles respeitam as configurações atuais, inclusive troca de modelo/provedor.
- Gemini recebe até três tentativas para falhas de rede ou HTTP 500/502/503/504, com espera de um e dois segundos. Cota, autenticação e modelo indisponível não são repetidos automaticamente. Falha final pausa a fila, apresenta o erro da página e preserva o OCR.
- Preferências são salvas em localStorage: modo, threads, alcance da preparação, servidor/link, tradutor/modelo, filtros e visualização. **Lembrar chave neste navegador** também salva a chave Gemini, conforme solicitado pelo usuário; o campo informa que o armazenamento local não é criptografado. Desmarcar a opção remove o valor persistido; **Apagar chave** remove o valor e interrompe os trabalhos ativos. A chave não integra o cache de resultados, logs ou JSON exportado.
- MyMemory passou a usar `https://mymemory.translated.net/api/get`, mantendo o endereço antigo como alternativa somente em falha de conexão. Um erro de cota/HTTP não é contornado com outro endereço. O endpoint alternativo respondeu com CORS e HTTPS válidos no teste real do Edge: `Hello, how are you?` → `Olá, como você está?`. A verificação TLS permanece habilitada.

Verificações adicionais: `node tools/ocr-quality-check.mjs`, `node tools/chapter-recovery-check.cjs`, `node tools/mymemory-live-check.cjs`. Passaram também os testes existentes de fila, cache, interface e lettering. O teste de recuperação do Gemini simula 503 e confirma as três tentativas, repetição manual, reexecução do OCR, preferências após recarregar e remoção da chave; não utiliza uma chave real nem gera chamadas pagas.

## Abrir e ler

1. Em **Link do capítulo**, cole o endereço do Suwayomi e clique em **Abrir este link**. O campo vem preenchido com `http://127.0.0.1:4567/manga/1/chapter/1`, a amostra local da página de referência.
2. Escolha WASM ou GPU, threads e tradutor. Para Gemini, informe sua chave e carregue os modelos disponíveis. O modelo selecionado é lembrado; a chave também é lembrada quando a opção correspondente está marcada.
3. Clique em **Começar / continuar**. A página original pode ser lida imediatamente; a tradução aparece quando fica pronta.
4. Use **Anterior / Próxima** ou a lista de páginas. A página escolhida tem prioridade entre os trabalhos pendentes.

Também é possível importar várias imagens de um capítulo. Os nomes são ordenados numericamente, por exemplo `9.jpg` antes de `10.jpg`. Esta primeira versão não importa arquivos CBZ/CBR.

O padrão prepara a página atual e até três páginas seguintes. **Capítulo inteiro** percorre todas em sequência. As páginas já prontas permanecem disponíveis. Ao avançar, a janela de preparação acompanha a leitura. Há pausa, retomada, repetição de uma página com falha, alternância com o original, fonte maior e narração do português.

A integração disponível nesta etapa é a página experimental local conectada à API do Suwayomi. O leitor React nativo e a instalação WebUI do Fly.io ainda precisam incorporar essa fila numa etapa posterior. O protótipo não atualiza automaticamente o progresso de leitura na conta Suwayomi.

## Funcionamento

- Um worker OCR por sessão, reutilizando os modelos entre páginas; uma página processada por vez.
- Imagens e OCR processados no navegador. O Fly.io fornece metadados e páginas pelo servidor existente.
- Texto enviado ao MyMemory ou Gemini escolhido. Preparar o capítulo inteiro pode consumir cota ou gerar cobrança no Gemini.
- Cache IndexedDB separado para OCR e tradução. A identidade inclui SHA-256 da imagem, hashes dos três modelos, versão do pipeline/runtime, modo de processamento, idioma, tradutor e modelo de tradução. Nome do arquivo e número do capítulo não substituem a identidade do conteúdo.
- O cache de tradução parcial permite retomar MyMemory sem repetir as falas concluídas. Falha na tradução pausa a fila; o OCR já concluído fica salvo. Falhas de uma página no OCR ficam registradas, e páginas seguintes podem continuar.
- Credenciais não são escritas nos resultados. A chave pode ser salva separadamente nas preferências locais. As imagens não são persistidas pelo cache de resultados; até três downloads recentes ficam em memória, além da imagem atualmente decodificada.
- O cache em memória de resultados é limitado a 100 entradas. IndexedDB fica sujeito à cota/remoção do navegador. O botão de limpeza apaga os resultados persistidos, preservando as páginas já abertas na sessão.
- Ao mudar o capítulo, trabalhos antigos são abortados e seus resultados não podem alterar a nova fila. Pausar durante OCR encerra o worker; continuar pode exigir nova inicialização. Pausar entre páginas conserva as sessões já prontas.

O acesso à API usa a mesma operação `fetchChapterPages` utilizada pelo WebUI para obter a lista de imagens. A fila carrega as imagens individualmente; não solicita download permanente do capítulo no servidor.

## Capítulo usado e testes reais

O link informado pelo usuário foi identificado pela API como **Ultimate Spider-Man #133**, obra 5, capítulo interno 134, com **31 páginas** em inglês. A edição tem muitas páginas silenciosas, além de apresentação e material editorial. Sua mediana não representa um capítulo com balões em todas as páginas.

Foi executado OCR real em todas as 31 páginas, uma vez em WASM com quatro threads e uma vez em Automático/WebGPU com alternativa WASM:

| Execução | Soma dos tempos de OCR das 31 páginas | Mediana por página após a primeira |
|---|---:|---:|
| WASM | **55,59 s** | 0,33 s |
| Automático / GPU | 128,42 s | 1,04 s |

Esses números incluem inicialização na primeira página, mas excluem download das imagens, tradução e renderização. Há 19 páginas sem texto reconhecido e 12 com texto. As páginas editoriais com letras pequenas são mais lentas e mostram erros/duplicações de detecção; não foram revisadas com referência de fidelidade para este capítulo. Os provedores configurados não garantem execução de todos os nós na GPU. Medição única, ordem fixa, sem controle térmico.

Acesso real à API, imagem remota, navegação, isolamento entre origens e largura móvel simulada passaram no primeiro teste. O teste real de tradução da capa pelo MyMemory falhou antes de concluir a primeira fala: o navegador recusou a conexão, e uma verificação adicional em Python retornou certificado autoassinado não confiável. A fila pausou e manteve o OCR. **Não houve tradução real concluída das 31 páginas**, e esta etapa não testou Gemini com uma chave real.

Depois desses testes, a API passou a responder com biblioteca e capítulos vazios; `fetchChapterPages` do mesmo link retornou `Collection is empty`. A interface agora apresenta uma mensagem curta de capítulo indisponível. A causa da mudança de dados no Fly.io não foi determinada. O teste de abertura remota depende de o capítulo estar presente no servidor; a importação local continua disponível.

## Verificações reproduzíveis

```powershell
node tools/chapter-queue-check.mjs
node tools/chapter-cache-check.cjs
node tools/chapter-ui-flow-check.cjs
node tools/chapter-browser-check.cjs
node tools/chapter-ocr-check.cjs
node tools/chapter-live-check.cjs
```

- **Fila:** execução serial, prioridade ao mudar de página, cancelamento, troca de capítulo e pausa por erro de cota.
- **Cache:** IndexedDB real, recuperação após recarregar, nenhuma nova chamada de OCR/tradução ao reutilizar resultado, retomada de tradução parcial. OCR e tradução simulados neste teste.
- **Interface:** duas imagens idênticas da `7.jpg`, ordem numérica, segundo resultado pelo cache, tradução com textos salvos, original restaurado, pausa e largura móvel simulada. Sem chamadas externas de tradução; não é medição de mangá completo.
- **Abertura remota:** API e imagens reais do capítulo indicado; depende dos dados atuais no Fly.io.
- **OCR completo:** todas as páginas do capítulo em WASM e Automático, sem tradução.
- **Tradução real:** janela pequena com MyMemory. Pode pausar por rede/cota; o relatório registra a falha e resultados parciais.

Passou também a regressão do lettering da página de teste original, preservando as 11 traduções, estilos e restauração do original.

Artefatos locais ignorados pelo Git: `ocr-runs/chapter-ocr-134.json`, `chapter-live-134.json`, `suwayomi-chapter-134.json`, `chapter-interface.png` e `chapter-translated-interface.png`. Nove imagens do capítulo ficaram salvas em `ocr-runs/chapter-134-page-*.jpg`, permitindo importação local; não foram incluídas nos arquivos públicos do projeto.
