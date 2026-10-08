# Testes de desempenho WebGPU no PC

Data: 06/10/2026. Edge 154 headless, Windows, adaptador Intel gen-12lp, ONNX Runtime Web 1.30.0. O adaptador anuncia `shader-f16`. Somente a `imagensinputteste/7.jpg` estava disponível. Não houve chamadas de tradução nem alterações no padrão do leitor.

## Procedimento

Cada configuração teve cinco execuções: uma inicial e quatro com sessões prontas. Os testes ocorreram em sequência, com ordem fixa. O primeiro teste usa média; os testes seguintes usam mediana. Não há intervalos estatísticos de confiança. Frequência do processador, temperatura e outros processos não foram controlados, portanto ganhos pequenos e diferenças entre rodadas exigem confirmação.

Nos testes 2 a 4, detector e detector de linhas permanecem em WASM com quatro threads; as variantes alteram o reconhecedor. Cada execução refaz a detecção, os recortes e os tensores da página inteira: 15 regiões e 46 linhas. O total inclui decodificação da imagem, preparação, inferência, transferência dos resultados e CTC. Exclui carregamento inicial dos modelos detector/linhas e renderização/tradução. Criação das sessões de reconhecimento e compilação de formatos ocorrem na primeira execução, descartada da mediana aquecida.

Textos e caixas são comparados com a variante FP32 da mesma rodada. Igualdade na amostra não comprova precisão em novas páginas nem correção do OCR original. Os testes de captura também comparam cada lote da página, para detectar resultados antigos reutilizados.

## 1. GPU em apenas uma etapa

| Configuração | Média total com sessões prontas |
|---|---:|
| WASM, quatro threads | **2,03 s** |
| GPU somente no detector de linhas | 3,22 s |
| GPU somente no reconhecedor | 4,75 s |
| Automático em todos os modelos | 5,18 s |

Os três primeiros modos encontraram 15 regiões; Automático encontrou 16. Todos fizeram 46 chamadas de reconhecimento. O texto permaneceu estável entre execuções de cada configuração, sem demonstrar igualdade entre provedores. Não houve fallback por erro. A configuração `webgpu + wasm` não identifica em qual dispositivo cada nó foi executado.

Conclusão nesta rodada: usar GPU apenas nas linhas ou no reconhecimento não superou WASM. O teste anterior com GPU apenas no detector também não havia trazido ganho.

## 2. Formatos fixos, buffers reutilizados e captura

| Variante da página inteira | Mediana total | Comparação dos textos |
|---|---:|---|
| FP32, reconhecimento sequencial | 3,90 s | Referência |
| FP32, lotes por largura arredondada a 64 | 4,03 s | Igual |
| FP32, buffers fixos e lotes de 8 por largura | 6,55 s | Igual |
| Captura, vários formatos | Sem resultado válido | Erro ao repetir; tentativa posterior repetiu textos |
| Captura, um formato de largura 704 | 5,72 s, **inválido** | 39 das 46 posições diferiram em alguma execução |

Buffers fixos sem captura usaram sete sessões e 16,5 MB de buffers de entrada GPU, além das cópias em CPU, pesos e temporários. Não foi medida a memória total da GPU. Lotes incompletos receberam preenchimento até oito itens, aumentando o trabalho. Esta combinação não isola o efeito de reutilizar um buffer de entrada: muda também lote, preenchimento e especialização das sessões.

A primeira tentativa de captura baixava saídas gerenciadas pelo runtime. A segunda usou buffers de entrada e saída explicitamente prealocados e leitura por `copyBufferToBuffer`, evitando que `getData()` mudasse a localização do tensor de saída. Ainda assim, múltiplas sessões falharam com `Required member is undefined`; o formato único executou, mas retornou textos do primeiro lote em outros recortes. Não foi determinada a causa exata, e não se afirma que seja limitação geral de WebGPU. **Estas variantes ficam rejeitadas para o leitor**, mesmo quando a execução termina sem erro.

O teste pequeno anterior com oito recortes não revelou esse problema no processamento completo. A comparação de todos os lotes foi necessária para detectá-lo. As medições inválidas não são ganhos de desempenho utilizáveis.

## 3. Pós-processamento dos caracteres na GPU

Implementado um shader WGSL de argmax com redução por grupo de 128 threads. Ele escolhe o caractere vencedor e sua probabilidade em cada posição, preserva o menor índice em empates e baixa apenas esses pares. A remoção de repetidos e símbolos em branco do CTC permanece na CPU.

| Saída por página | Download estimado pelo tamanho dos tensores |
|---|---:|
| Probabilidades completas | 3.885.936 bytes |
| Índice e confiança por posição | **17.744 bytes** |

São 219 vezes menos bytes na saída, aproximadamente 99,54% de redução. Não é uma medição física do tráfego total da GPU: entradas, pesos e operações internas não estão nessa contagem.

Textos e confianças coincidiram exatamente com o FP32 da referência. Também passou um teste determinístico de empates, caracteres repetidos, branco e isolamento entre itens do lote. Mediana total: referência 3,90 s, pós-processamento GPU 4,21 s. A redução dos dados não trouxe aceleração nesta rodada; as 46 chamadas e sincronizações continuam existindo.

## 4. Reconhecedor FP16

Convertido o modelo original, preservando entrada e saída FP32. Os 247 inicializadores de ponto flutuante passaram para FP16. O modelo experimental tem 3.989.468 bytes, contra 7.872.351 do original: aproximadamente **49% menor**. Não há novo treinamento.

A primeira conversão usou limites padrão do conversor e cortou um valor acima de 10.000. Foi feita uma segunda conversão com `min_positive_val=0` e `max_finite_val=65504`, evitando corte adicional dentro do intervalo representável em FP16. A rodada final é a usada abaixo:

| Variante | Mediana total | Mediana do reconhecimento, incluindo preparo dos lotes |
|---|---:|---:|
| FP32 de referência | 3,65 s | 2,69 s |
| FP16 | 3,68 s | **2,25 s** |
| FP16 + argmax GPU | 3,80 s | 2,43 s |

O reconhecimento isolado ficou aproximadamente 16% mais rápido, mas a página inteira não melhorou nesta rodada. Os textos e caixas foram iguais nos cinco reconhecimentos de cada variante; maior alteração da confiança FP16 em relação a FP32 foi 0,00945. Isso não demonstra ausência de perda de precisão em outras páginas. As faixas dos tempos totais se sobrepõem: FP32 3,47–3,92 s; FP16 3,63–3,75 s.

## Reproduzir e inspecionar

Inicie o servidor com `npm run ocr:web`. O servidor deve fornecer isolamento entre origens; os testes precisam de WebGPU no Edge e do Playwright já instalado em `node_modules/ocr-check`.

```powershell
node tools/ocr-provider-check.cjs
.venv-ocr/Scripts/python.exe -m pip install onnx==1.23.2 onnxconverter-common==1.16.0
.venv-ocr/Scripts/python.exe tools/convert-recognizer-fp16.py
node tools/ocr-gpu-advanced-check.cjs
node tools/ocr-gpu-advanced-check.cjs --capture-one-shape
node tools/ocr-gpu-advanced-check.cjs --fp16
node tools/gpu-ctc-check.cjs
```

Os arquivos experimentais são servidos apenas pelas rotas do teste, sem mudar a lista de modelos do leitor. Relatórios locais, ignorados pelo Git:

- `ocr-runs/provider-check.json`: provedores por etapa.
- `ocr-runs/gpu-advanced-check.json`: primeira rodada completa; FP16 ainda com conversão padrão.
- `ocr-runs/gpu-advanced-one-shape-check.json`: captura com buffers fixos de entrada e saída, incluindo diferenças de texto.
- `ocr-runs/gpu-advanced-fp16-check.json`: repetição com conversão FP16 final.
- `ocr-runs/fp16-conversion.json`: parâmetros, tamanhos e SHA-256 da conversão final.

WASM com quatro threads permanece a opção mais rápida observada neste PC. Nenhuma das novas variantes demonstrou uma vantagem consistente no processamento completo que justifique substituir o fluxo atual.

Referências das APIs: [WebGPU e buffers ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html), [conversão FP16](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html).
