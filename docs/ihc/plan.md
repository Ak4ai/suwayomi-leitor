# Plano do projeto: leitor web com OCR local e tradução inglês → português

Atualizado em 29/09/2026, após revisão da proposta WebGPU.

Teste de Absolute Batman em 06/10/2026: capítulo correto é Vol. 1: The Zoo, ID 61, 179 páginas. Verificadas todas as dimensões: dez imagens 1988×3057 e 169 imagens 280×431. OCR executado nas dez páginas grandes; não foi publicada fidelidade percentual sem transcrição de referência. Corrigidos vínculo rígido entre caixa de texto/balão e artefatos minúsculos; acrescentados aviso de resolução, pausa antes de traduzir miniaturas, opção experimental e motivos de tradução somente no painel. A variante de corte entre linhas piorou palavras e ficou desativada. Imagens em resolução normal são necessárias para avaliar as demais páginas. Detalhes em `suwayomi-leitor/ABSOLUTE-BATMAN-TEST.md`.

Migração dos testes para servidor local em 06/10/2026: instalado Suwayomi Server oficial v2.4.2366, checksum validado, Java 21 e pasta persistente `.local-server/data`. Biblioteca local com página de referência e amostra parcial de nove páginas do Spider-Man. O protótipo acessou API/imagens locais e concluiu OCR/tradução real, aplicando 11 balões na referência. Banco/biblioteca preservados após reinicialização. Fly.io respondeu com biblioteca vazia, impedindo recuperação da edição completa. Instruções em `suwayomi-leitor/SUWAYOMI-LOCAL.md`.

Em 06/10/2026 foi reproduzida uma resposta parcial MyMemory relatada pelo usuário, referente a outra frase com índice 0,44. Acrescentadas validação de correspondência completa, recusa de respostas suspeitamente curtas, limite de 15 s por chamada, continuidade de outros balões em falha de cobertura e mensagens explícitas para falas não concluídas. Cache MyMemory versionado para remover reaproveitamento de traduções truncadas. Google experimental sem chave disponível mediante seleção explícita, com a frase inteira verificada no teste real. A qualidade geral e disponibilidade deste endpoint ainda requerem avaliação.

Correções do leitor de capítulos em 06/10/2026: filtros de falsos positivos com acesso ao OCR ignorado; opção somente balões; refazer tradução e OCR de página pronta; retomada de erros e tentativas limitadas para falhas transitórias do Gemini; persistência de preferências/modelo e chave opcional local, solicitada pelo usuário. MyMemory voltou a concluir tradução no teste real após usar endpoint HTTPS alternativo do mesmo serviço. Testes controlados de qualidade, cache, retomada, preferências e interface aprovados. Mantido V5 inglês e ambos os modos WASM/GPU.

Em 06/10/2026 foi criado o protótipo de capítulos em `suwayomi-leitor/public/ocr-web/chapter.html`: fila serial, prioridade pela página aberta, preparação antecipada, pausa e cache IndexedDB de OCR/tradução. Conexão pela API ao capítulo interno 134 do Fly.io, identificado como Ultimate Spider-Man #133, 31 páginas. OCR completo executado em WASM e GPU; testes controlados de fila/cache/interface aprovados. MyMemory real bloqueado por erro de conexão/certificado; depois a API do servidor passou a retornar biblioteca vazia. Detalhes em `suwayomi-leitor/CHAPTER-READER.md`. Integração no leitor React nativo é a próxima etapa, após validar o protótipo com capítulo disponível e tradutor acessível.

Comparação com referência textual visual concluída em 06/10/2026: na única página disponível, PP-OCRv6 Tiny acelerou o pipeline completo WASM em aproximadamente 20%, mas perdeu dois espaços em falas e confundiu NEW com NEM em uma placa. V5 inglês atual e V6 Small tiveram a mesma transcrição; Small ficou mais lento. Mantido V5 como padrão. Referência, taxas CER/WER, velocidades WASM/WebGPU e resultados lado a lado registrados em `suwayomi-leitor/OCR-FIDELITY.md`. Novas páginas ainda são necessárias para concluir sobre generalização.

Rodada de quatro testes no PC concluída em 06/10/2026, registrada em `suwayomi-leitor/GPU-PERFORMANCE.md`: GPU apenas nas linhas/reconhecimento não superou WASM; buffers fixos ficaram mais lentos; captura de grafo foi rejeitada por erro e textos repetidos; argmax GPU reduziu transferência sem acelerar o total; FP16 reduziu o modelo e o reconhecimento, mas não o tempo completo da página na rodada final. Igualdade dos textos conferida na única imagem disponível; novas páginas e medições intercaladas continuam necessárias antes de adotar uma variante. Nenhuma nova otimização experimental foi ativada no leitor.

Atualização experimental em 06/10/2026: foco temporário nas medições do PC. Testados lotes de reconhecimento, agrupamento de larguras, entrada por buffer GPU e captura de grafo estático, mantendo os modelos originais. Os ganhos medidos foram pequenos e variaram entre rodadas; preenchimento mais amplo também aumentou o tempo. Os textos coincidiram na amostra testada, sem comprovar generalização. Mantido o comportamento atual do leitor. Scripts, limitações e resultados registrados em `suwayomi-leitor/OCR-WEB.md`, seção de otimização WebGPU no PC.

## 1. Decisão e objetivo

**Arquitetura candidata: aplicação web/PWA com detecção e OCR no dispositivo via ONNX Runtime Web e tradução opcional pela Gemini API com chave do usuário.** O objetivo é eliminar um servidor próprio para inferência de OCR. A escolha definitiva depende dos testes descritos neste plano.

A direção é consistente com ajustes. Não assumir custo zero, execução integral na GPU, velocidade nativa, precisão superior ao Tesseract ou funcionamento completamente offline sem evidências. Gemini continua sendo processamento em nuvem.

A exigência anterior de execução nativa no celular passa a ser tratada, nesta proposta web, como processamento de OCR no próprio aparelho. Navegador/PWA não é um aplicativo Android/iOS nativo. Se APK e APIs nativas forem obrigatórios, a alternativa é Android com ML Kit e/ou ONNX Runtime Mobile.

### Público e recorte de IHC

- Pessoas que leem em português, mas não conhecem o inglês dos quadrinhos.
- Pessoas não alfabetizadas ou com baixa alfabetização, que podem acompanhar as falas por áudio. Esse grupo exige controles, instruções e avaliação próprios; não presumir que um estudo com leitores alfabetizados representa ambos.
- Primeiro par de idiomas: **inglês → português**.
- Leitura visual, narração opcional e alternância original/tradução vinculadas a cada fala.
- Deficiência visual não é o foco central deste recorte.

Pergunta candidata: como a apresentação da tradução com narração opcional influencia a compreensão e a experiência de leitura de quadrinhos em inglês pelo público delimitado? Refinar com literatura e orientação docente. OCR e tradução são componentes da solução, não uma contribuição científica presumida.

`proposta/main.tex` foi alinhado ao público, idiomas e pergunta atuais: leitor web inglês → português, tradução visual e narração, com avaliação separada para barreiras linguísticas e de alfabetização. O texto distingue o protótipo existente das etapas planejadas de limpeza de balões, lettering e avaliação de IHC.

## 2. Verificação da arquitetura sugerida

| Afirmação | Avaliação e ajuste |
|---|---|
| “Arquitetura definitiva” | Candidata até executar os modelos exatos nos navegadores e aparelhos-alvo. |
| “Zero custo no Fly.io” | Não sustentado. Fly.io cobra recursos e transferência. Retirar OCR do servidor não elimina hospedagem, armazenamento e tráfego. [1] |
| “Bastam detector de balões e reconhecedor” | Incompleto para balões com múltiplas linhas: precisa localizar/recortar linhas e decodificar o reconhecedor com seu dicionário. |
| “INT8 roda via WebGPU” | Compatibilidade depende de operadores, opset, tipos e quantização. INT8 não garante aceleração nem menor latência. [2][3] |
| “Velocidade nativa no iPhone” | Hipótese a medir. Safari 26 trouxe WebGPU, mas isso não valida automaticamente nosso modelo e todos os aparelhos. [4] |
| “Gemini com chave do usuário via fetch” | Candidato para experimento BYOK; verificar autenticação, CORS e cotas. A chave fica acessível ao contexto da página. Para produção, Google recomenda protegê-la em backend. [5] |
| “Canvas faz inpainting” | Preenchimento uniforme é composição simples. Reconstruir textura ou desenho exige outra técnica/modelo e máscara adequada. |
| “Precisão muito superior ao Tesseract” | Não demonstrado. Medir contra transcrições revisadas em várias páginas com critérios iguais. |

## 3. Arquitetura proposta

```text
Hospedagem estática HTTPS → interface, runtime, modelos e metadados
                                      ↓
                         Navegador do leitor / PWA
                                      ↓
                    Imagem local ou origem com CORS válido
                                      ↓
                 Worker: detecção de balões/regiões de texto
                                      ↓
                  Localização de linhas + recorte/retificação
                                      ↓
                    Reconhecedor inglês + decodificação CTC
                                      ↓
             Texto e coordenadas → agrupamento/ordem/revisão
                                      ↓
                Gemini API: falas com IDs, inglês → português
                                      ↓
                 Camada visual traduzida + narração opcional
```

O modo final de OCR web não deverá chamar o Python do comparador. O backend atual permanecerá como referência experimental para verificar a portabilidade.

### 3.1 Modelos e processamento

Partir dos arquivos já baixados em `suwayomi-leitor/.ocr-models`, fixando revisão, checksum, runtime e parâmetros.

| Componente | Artefato candidato | Tamanho observado | Função |
|---|---|---|---|
| Detector especializado | `detector-v4-s_int8.onnx`, localmente `rtdetr.onnx` | ~11,1 MB | Detectar balões e regiões de texto; interpretar classes e associar texto ao balão. |
| Detector de linhas | `ch_PP-OCRv5_det_mobile.onnx` | ~4,8 MB | Localizar linhas nos recortes antes do reconhecimento; validar no material inglês. |
| Reconhecedor inglês | `en_PP-OCRv5_rec_mobile.onnx` | ~7,9 MB | Reconhecer recortes preparados com normalização e decodificação correspondentes. |
| Dicionário/decodificador | Metadados/lista de caracteres compatível | Adicional | Converter índices em caracteres e tratar repetições/blank CTC e espaços. |

Valores de arquivo não representam RAM/VRAM nem incluem runtime, WASM, interface, imagens ou voz. Variantes FP16/FP32 terão outros tamanhos. `paddleocr_rec_en.onnx` no texto sugerido era um nome genérico, não um artefato específico verificado.

No comparador atual, recortes do detector especializado passam novamente pela detecção de texto PP-OCRv5. Um reconhecedor de linha não deve receber diretamente um balão com várias linhas. Estudar segmentação geométrica para retirar o terceiro modelo somente após demonstrar qualidade equivalente.

Portar para JavaScript/TypeScript: redimensionamento, normalização, tensores, interpretação das caixas/classes, filtragem de sobreposições, recorte de linhas, retificação quando necessária, CTC e associação às coordenadas originais. O ONNX não contém automaticamente toda a lógica Python.

Preservar legendas e textos fora dos balões quando relevantes. Separar as políticas “somente falas” e “todos os textos visíveis”. Ordenação geométrica y/x não resolve a sequência narrativa de quadros.

### 3.2 Execução WebGPU e WASM

- Fixar uma versão de `onnxruntime-web` e validar os grafos exatos com imagens reais.
- Verificar HTTPS/localhost, `navigator.gpu`, criação do adapter e da sessão; a disponibilidade de WebGPU não garante execução integral na GPU.
- Conferir operadores, opset, tipos e nós executados em CPU. Consultar a matriz da versão adotada. [2][3]
- Se necessário, obter/exportar variante FP16/FP32 e comparar resultados; renomear o arquivo INT8 não converte o modelo.
- Implementar tentativa controlada com WASM quando WebGPU/modelo não executar. Validar também essa rota. Se ambas falharem, informar indisponibilidade e preservar leitura original.
- Usar worker, limitar concorrência, liberar tensores/sessões e tratar perda do dispositivo GPU, interrupção e retomada da aba.
- Não presumir multithreading WASM: validar isolamento de origem e cabeçalhos exigidos pela configuração, inclusive o efeito sobre recursos externos.

### 3.3 Download e cache

- Baixar modelos sob demanda ao habilitar o recurso, mostrando progresso, tamanho e opção de tentar novamente.
- Manifesto versionado com URLs, hashes, revisões e parâmetros; distribuir também WASM e dicionários necessários.
- Cache Storage pode armazenar artefatos; IndexedDB pode guardar índices, resultados e/ou blobs. Evitar duplicação desnecessária de pesos.
- Tratar cota, falta de espaço, limpeza e remoção automática. Persistência solicitada ao navegador não é garantia de armazenamento permanente. [6]
- Cache OCR: hash da imagem + revisão do modelo + configuração. Cache de tradução acrescenta idiomas, modelo e versão do prompt.
- OCR poderá funcionar offline após cache completo. Tradução nova via Gemini exige conexão; traduções salvas podem ser reutilizadas.

### 3.4 Gemini com chave do usuário

Para protótipo controlado, avaliar BYOK: cada usuário fornece sua chave e o navegador chama o provedor diretamente. Isso evita uma chave compartilhada da equipe no bundle, mas não torna a chave secreta diante de scripts da página, extensões ou ferramentas do navegador. A recomendação oficial para produção é proteger as chaves em backend. [5]

- Manter a chave apenas em memória por padrão, com ação para removê-la. Não incluí-la em URLs, logs, relatórios, service worker ou cache. Não embutir chave da equipe no código.
- Validar a autenticação vigente, restrições de chave, CORS/preflight e chamada na origem HTTPS final. `no-cors` não resolve acesso à resposta.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, com ID de modelo válido. `/models/gemini...` não especifica um endpoint completo. [7]
- Enviar texto por padrão, não a imagem: `{pageId, sourceLanguage, targetLanguage, segments: [{id, text}]}`. Solicitar traduções mantendo todos os IDs.
- Validar estrutura, contagem e IDs, detectar truncamento e oferecer nova tentativa. Tratar falas como conteúdo a traduzir, nunca como instruções do sistema.
- Tratar cota, autenticação e indisponibilidade sem perder o OCR. Renderizar a resposta como texto, nunca HTML arbitrário.
- A chave do usuário vincula o consumo ao projeto dele; não torna a API gratuita por definição.

Se a publicação exigir chave gerenciada pela equipe, mover somente a tradução para um proxy autenticado com limites. Isso adiciona backend, mas não GPU própria. Para 100% offline, seria necessário substituir Gemini por tradutor local e reavaliar download, memória, qualidade e compatibilidade; fica fora do primeiro incremento web.

### 3.5 Renderização e voz

- Manter original intacto e desenhar tradução em camada reversível.
- Primeira versão: painel/overlay associado à fala; original acessível e mesmo ID para texto, foco e áudio.
- Em balões uniformes, estudar máscara do texto e preenchimento pela cor de fundo. Caixa de detecção não é máscara de balão: pintar o retângulo pode apagar contorno, cauda ou arte.
- Ajustar quebra de linhas, fonte e tamanho mínimo. Oferecer painel expandido se o português não couber.
- Não chamar preenchimento simples de inpainting generativo. Texturas, transparência e texto sobre arte ficam em overlay; LaMa/AOT-GAN são evolução posterior com modelo/custo adicional.
- Canvas faz composição; manter texto e controles também no DOM para seleção, semântica e interação.
- Narração opcional com reproduzir, pausar, repetir e velocidade. Validar voz portuguesa no dispositivo; não prometer voz offline sem teste.

## 4. Suwayomi, imagens e hospedagem

**Hospedar a Suwayomi-WebUI estaticamente não substitui Suwayomi-Server.** Biblioteca, fontes, capítulos e outras funções existentes dependem da API. OCR no cliente remove somente a inferência do servidor, não essas funções. [8]

Dois modos planejados:

1. **Demonstração autônoma:** imagens locais/conjunto estático autorizado, biblioteca e progresso locais. A rota deve funcionar sem os guards/requisições obrigatórios do servidor. Prioridade para validar hospedagem estática.
2. **Leitor conectado:** Suwayomi-Server existente fornece biblioteca/fontes; OCR permanece no navegador. Custos e infraestrutura desse servidor continuam. Hospedagem estática não executa extensões de fontes.

Imagens locais usam File API. Imagens remotas precisam de CORS apropriado ou mesma origem. Exibir uma imagem não garante acesso aos pixels: canvas contaminado impede leitura/exportação. Se uma fonte exigir proxy, haverá componente dinâmico adicional. [9]

Fly.io é apenas candidato; esta revisão não contrata nem publica nada. Recursos e transferência são cobrados, incluindo distribuição de modelos/capítulos. Estimar consumo; se orçamento zero for indispensável, comparar hospedagem estática com franquia gratuita e seus limites antes de escolher. [1]

Objetivo correto: **OCR no dispositivo, sem GPU própria de servidor e com custo operacional reduzido a validar**. Não usar “zero custo no Fly.io”, “sem nuvem” ou “totalmente offline” na arquitetura com Gemini.

## 5. Estado real do workspace

- Base: `suwayomi-leitor`, branch `ihc-leitor-traducao`, remoto upstream; não é fork publicado.
- Proposta: `proposta/main.tex`.
- Laboratório inicial: `public/ocr/`, `npm run ocr:dev`, porta 3001, Tesseract.js no navegador.
- Comparador: `public/ocr-compare/` e `tools/ocr_compare/`, `npm run ocr:compare`, porta 3002. Detectores especializados/PP-OCRv5 executam no Python da máquina, não no navegador.
- Executados na `imagensinputteste/7.jpg`: Tesseract, PP-OCRv5, RT-DETR + PP-OCRv5 e CTD + PP-OCRv5. São adaptações dos componentes, não os aplicativos completos.
- Relatório: `suwayomi-leitor/ocr-runs/comparativo-7.json`; instruções: `suwayomi-leitor/OCR-COMPARISON.md`; pesos/hashes: `.ocr-models/manifest.json`.
- Uma execução desktop registrou ~4 / 2,4 / 10,4 / 49,8 segundos respectivamente. Não extrapolar para smartphone/WebGPU. Sem referência revisada, não há ranking validado de precisão.
- Cloud Vision/Gemini possuem adaptadores no backend comparativo, sem execução real por falta de credenciais. Lens/ML Kit aceitam importação manual de resultados.
- Ainda não implementados: ONNX no navegador, cache frontend dos modelos, Gemini direto, preenchimento de balões e integração ao leitor. Build completo da WebUI e execução real em S23/iPhone continuam pendentes.

## 6. Etapas e critérios de avanço

### A — Prova de ONNX no navegador: próxima tarefa

1. Fixar runtime e servir pesos/recursos por HTTPS ou localhost.
2. Executar os modelos de detecção e reconhecimento com os mesmos dados usados no Python.
3. Portar pré/pós-processamento e CTC, comparando texto/caixas com a referência Python.
4. Identificar operadores incompatíveis, verificar execução efetiva GPU/CPU e testar WASM; selecionar variante de pesos se necessário.
5. Mostrar imagem, regiões e inglês reconhecido numa rota independente do backend Python.

**Critério:** OCR ponta a ponta com o servidor de comparação desligado, resultados registrados e falhas tratadas. Não prometer desempenho antes dessa prova.

### B — Qualidade e desempenho

- Usar pelo menos dez páginas variadas, transcrições revisadas e política explícita sobre falas, legendas e letreiros.
- Medir CER/WER, falas omitidas, regiões falsas, agrupamento e ordem com os mesmos critérios.
- Executar no S23, iPhone e desktop, registrando aparelho, SO e navegador. Medir download inicial, inicialização, tempo por página em repetições, responsividade e memória quando mensurável.
- Testar página grande, retomada, cache removido, ausência de WebGPU e falta de rede.

**Critério:** evidências para escolher modelos e dispositivos suportados. Se web local falhar, reavaliar Android ML Kit/ONNX sem descartar dados do comparador.

### C — Tradução e apresentação

- Validar Gemini BYOK na origem final com texto mínimo e modelo explicitamente escolhido.
- Implementar tradução por IDs, revisão, cache e tratamento de erros.
- Implementar overlay, alternância e áudio; preenchimento uniforme só onde a máscara for confiável.

**Critério:** associação correta de falas/traduções, chave ausente de artefatos/logs/exportações, progresso preservado após falhas e controle de áudio/leitura pelo usuário.

### D — Integração e IHC

- Integrar à WebUI nos modos autônomo/conectado e verificar build do frontend.
- Alinhar proposta, pergunta e literatura.
- Comparar tradução textual com/sem narração em tarefas de compreensão; avaliar separadamente as necessidades de baixa alfabetização/não alfabetização.
- Registrar compreensão, esforço, preferência e dificuldades; separar falhas de interface das de OCR/tradução. Planejar participantes/procedimentos com orientação docente.
- Avaliar hospedagem/custos antes de publicar e documentar aparelhos/navegadores efetivamente testados.

## Implementação do laboratório web — 29/09/2026

Implementada página independente em `suwayomi-leitor/public/ocr-web`, disponível com `npm run ocr:web` em http://127.0.0.1:3003. Instruções em `suwayomi-leitor/OCR-WEB.md`.

- Importação local; RT-DETR → detecção PP-OCRv5 de linhas → reconhecimento inglês/CTC em Web Worker, com runtime e pesos servidos localmente.
- Cache Storage dos modelos com verificação SHA-256; modo automático WebGPU/WASM e modo CPU explícito; cancelamento por encerramento do worker.
- Revisão, reordenação e exclusão de falas; tradução opcional Gemini BYOK por IDs, validação da resposta, chave apenas na sessão; exportação JSON sem chave.
- Sobreposição reversível em caixas brancas e narração via navegador. Não há inpainting nem máscara confiável para apagar o fundo.
- Teste real de `7.jpg` em Edge/Windows: WASM com 15 regiões em cerca de 6,7 s; automático com WebGPU + WASM configurados, 16 regiões em 11,4 s. Medidas exploratórias de uma execução por modo, não benchmark nem comprovação de execução integral na GPU. Arte e fragmentos ainda geram falsos positivos.
- Testes de CTC, agrupamento horizontal, NMS e contrato Gemini simulado passaram. Exportação estática executada. Nenhuma tradução real com credencial foi feita.

Pendências: pós-processamento robusto de linhas/rotação, avaliação com referência, cache de resultados, reabertura offline/PWA, aparelhos Android/iOS reais, Gemini na origem publicada e integração à WebUI. O agrupamento atual de linhas é uma aproximação JavaScript, não o pipeline completo dos projetos de origem.

## 7. Fontes da revisão

Estilos de lettering adicionados em 05/10/2026: controles por balão para fonte (Comic Neue/Bangers), peso e inclinação, sugestão por medidas geométricas dos componentes originais e opção de restaurá-la. Sem modelo neural adicional; cinco arquivos de fonte locais somam aproximadamente 316 KB. Testes visuais e de interação preservaram as 11 falas aplicadas na `7.jpg`, a restauração do original e os ajustes exportados. A sugestão é aproximada, por balão inteiro; identificação exata de fontes e ênfase em palavras individuais permanecem fora da implementação atual.

Validação visual posterior em 05/10/2026: criado `tools/lettering-visual.cjs`, que reutiliza OCR/traduções salvos e gera pranchas de original, máscara, limpeza e resultado. A versão anterior recusava todos os balões da `7.jpg`; a revisão por componentes conectados passou a aplicar 11 traduções, preservando três regiões sem balão e um trecho sem alteração. A inspeção das pranchas revelou e orientou também a correção de sobreposição entre recortes. Passaram verificações de restauração do original, independência da ordem de composição, fluxo da interface e largura móvel simulada. Artefatos em `ocr-runs/lettering-final/`; não representa validação em novos quadrinhos ou no S23 real.

Em 05/10/2026 foi implementado o primeiro modo de limpeza leve e lettering em `public/ocr-web/lettering.js`: máscara heurística de letras em fundos claros uniformes, preservação da imagem original, fonte Comic Neue Bold local, centralização e ajuste de linhas/tamanho. A interface informa por região quando a tradução fica apenas no painel e permite alternar com o original. Não foi acrescentado modelo neural. A implementação ainda requer avaliação visual e de desempenho no navegador/S23; não equivale a inpainting de fundos ilustrados.

Atualização de acesso/tradução: adicionada opção MyMemory sem chave, com requisições diretas do navegador, limite de tamanho por trecho, cache em memória e preservação de falas concluídas após falha. Requer internet e está sujeita às cotas do provedor; validação real pendente. Tentativa de HTTPS privado por Tailscale Serve bloqueada por timeout de acesso ao servidor de coordenação do Tailscale; publicação ainda não concluída. Instruções em `suwayomi-leitor/OCR-WEB.md`.

Consultadas em 29/09/2026. Revalidar compatibilidade e condições dos serviços na implementação/publicação.

1. [Fly.io: cobrança por recursos e transferência](https://docs.fly.io/about/pricing/).
2. [ONNX Runtime Web: WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
3. [Operadores WebGPU suportados](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md).
4. [WebKit: WebGPU no Safari 26, inclusive iOS](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
5. [Gemini: uso e proteção de chaves](https://ai.google.dev/gemini-api/docs/api-key).
6. [Cotas e remoção de armazenamento no navegador](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
7. [Gemini: geração de texto](https://ai.google.dev/gemini-api/docs/text-generation).
8. [Suwayomi-Server: funcionalidades e arquitetura](https://github.com/Suwayomi/Suwayomi-Server/blob/master/README.md).
9. [Canvas e imagens de outras origens](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).
10. [Comic Translate](https://github.com/ogkalu2/comic-translate#how-it-works) e [pesos RT-DETR-v2](https://huggingface.co/ogkalu/comic-text-and-bubble-detector).
11. [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [RapidOCR](https://github.com/RapidAI/RapidOCR) e arquivos locais `.venv-ocr/Lib/site-packages/rapidocr/ch_ppocr_rec`, inspecionados para confirmar o decodificador CTC e o dicionário.
