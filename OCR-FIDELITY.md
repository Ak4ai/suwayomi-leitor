# Comparação dos reconhecedores e fidelidade

06/10/2026. Comparados o PP-OCRv5 Mobile inglês atual e os modelos oficiais PP-OCRv6 Tiny e Small, sem substituir os modelos do leitor.

## Referência e metodologia

A única imagem disponível foi `imagensinputteste/7.jpg`. O assistente conferiu visualmente a transcrição da página original; não houve segundo anotador independente. A referência revisável, com SHA-256 da imagem e caixas, está em `tools/fixtures/reference-7.json`.

São 46 recortes horizontais processados. Um é uma detecção duplicada da legenda METROPOLIS e fica fora da pontuação, resultando em **45 linhas únicas, 496 caracteres e 98 palavras**, incluindo espaços/pontuação. Dessas, 41 linhas são de balões, três de legendas e uma de texto decorativo. Os modelos usam os mesmos recortes, a mesma altura 48, largura proporcional e preenchimento mínimo 320. Textos da página que o detector não encontrou não entram na avaliação: estes números não medem a cobertura de toda a página.

A comparação normaliza maiúsculas/minúsculas, apóstrofos tipográficos, reticências Unicode e espaços consecutivos. Mantém pontuação e separação entre palavras:

- **CER**: número de inserções, remoções e substituições de caracteres dividido pelos caracteres da referência; menor é melhor.
- **WER**: distância de edição entre sequências de palavras, dividida pelas palavras da referência. Uma palavra unida à seguinte pode contar como mais de uma edição. Pontuação também diferencia tokens; não interpretar como porcentagem de palavras cujo significado está errado.
- **Linhas exatas**: quantidade de linhas que coincidem após a normalização.
- Há pontuação fora ou parcialmente cortada nas caixas de METROPOLIS., ...IF YOU e ...YOU COULD. Os cinco caracteres ausentes comuns aos modelos têm relação com esses recortes; a avaliação contra o texto original conserva esses erros e os identifica no relatório. Não atribuir automaticamente essa diferença ao reconhecedor.

Os dicionários de cada modelo foram verificados contra o número de classes de saída: 438 no V5 inglês, 6.906 no V6 Tiny e 18.710 no V6 Small. O Tiny tem 4.462.639 bytes e o Small 21.159.378 bytes, contra 7.872.351 bytes do V5 inglês. Os V6 são multilíngues, enquanto a referência atual é especializada em inglês; não se trata de comparar versões igualmente especializadas.

## Tempos e fidelidade

Ambiente: Edge 154 headless, Windows, Intel gen-12lp, ONNX Runtime Web 1.30.0, isolamento entre origens habilitado. WASM usa quatro threads. Não houve tradução ou envio da imagem para serviços externos.

Para reconhecimento isolado, duas passagens usam ordem dos modelos direta e inversa. Cada configuração executa três vezes por passagem, descartando a primeira de cada sessão: mediana de quatro execuções aquecidas. Os dados dos recortes são preparados antes da medição. O tempo inclui montagem dos tensores, inferência, download quando aplicável e CTC.

| Reconhecedor | WASM | WebGPU | WebGPU + argmax GPU | Linhas exatas | CER | WER |
|---|---:|---:|---:|---:|---:|---:|
| V5 Mobile inglês | 1,024 s | 2,778 s | 2,778 s | **42/45** | **1,01%** | **3,06%** |
| V6 Tiny | **0,440 s** | **0,745 s** | **0,676 s** | 39/45 | 1,61% | 8,16% |
| V6 Small | 1,908 s | 2,719 s | 2,447 s | **42/45** | **1,01%** | **3,06%** |

Os textos ficaram estáveis nas seis execuções de cada combinação, e a pontuação de fidelidade foi a mesma em WASM, WebGPU e WebGPU com argmax para cada modelo. O argmax na GPU não modificou os textos desta amostra.

Foi executado também o pipeline completo com os mesmos detector de balões e detector de linhas, ambos em WASM. São cinco execuções por configuração, descartando a primeira. O tempo inclui decodificação da imagem, detecção, recortes, normalização, reconhecimento e CTC; exclui carregamento inicial das sessões detector/linhas, tradução e renderização. Ordem fixa; variações de temperatura/frequência e outros processos não foram controladas.

| Modelo / execução do reconhecedor | Mediana do OCR da página | Faixa das quatro execuções aquecidas |
|---|---:|---:|
| V5 inglês / WASM | **1,509 s** | 1,487–1,564 s |
| V6 Tiny / WASM | **1,200 s** | 1,104–1,375 s |
| V6 Small / WASM | 2,423 s | 2,370–2,469 s |
| V6 Tiny / WebGPU | 1,918 s | 1,659–2,139 s |

O Tiny reduziu o reconhecimento isolado em aproximadamente 57% no WASM e 73% na GPU, comparado ao V5 do mesmo provedor. No pipeline completo em WASM, a redução foi de aproximadamente **20%**. Os tempos isolados e completos vieram de rodadas diferentes; não somar nem comparar diretamente essas duas tabelas para atribuir o restante do tempo a uma etapa específica.

## Diferenças observadas

Além das três linhas com pontuação ausente comuns aos modelos, o Tiny apresentou:

| Referência | Tiny | Tipo |
|---|---|---|
| `NO, NO, I BUY` | `NO, NO, IBUY` | Espaço perdido |
| `BEFORE. I'LL CHECK` | `BEFORE.I'LL CHECK` | Espaço perdido |
| `NEW` | `NEM` | Letra incorreta no texto decorativo |

O V5 e o Small coincidiram na transcrição desta amostra. Nos balões, o Tiny não acrescentou substituições de letras em relação ao V5, mas perdeu dois espaços. Considerando apenas balões, linhas exatas: V5/Small 39 de 41 e Tiny 37 de 41. CER de balões: 0,86% contra 1,29%. Não significa ausência de erros em outras páginas.

Uma métrica secundária removendo pontuação mantém a diferença de espaços: V5/Small 45 de 45 linhas exatas, Tiny 42 de 45. A remoção de pontuação não deve substituir a avaliação principal.

## Decisão e artefatos

Mantido o reconhecedor atual como padrão. O Tiny é candidato concreto a uma opção rápida, com perda observada de fidelidade. O Small não trouxe benefício nesta página e requer mais download/memória. Testar mais páginas de diferentes fontes e qualidade antes de trocar o padrão.

O relatório local `ocr-runs/recognition-fidelity-report.html` funciona sem servidor, contém a imagem embutida e mostra os recortes e transcrições lado a lado, com filtro de diferenças. Uma captura visual foi inspecionada no Edge.

Reproduzir:

```powershell
npm run ocr:web
# Em outro terminal:
.venv-ocr/Scripts/python.exe tools/prepare-v6-recognizers.py
node tools/ocr-fidelity-check.cjs
node tools/ocr-gpu-advanced-check.cjs --v6
node tools/ocr-fidelity-report.cjs --preview
```

Relatórios JSON em `ocr-runs/recognition-fidelity-check.json`, `ocr-runs/gpu-advanced-v6-check.json` e `ocr-runs/v6-models.json`. Este último registra URLs oficiais, SHA-256, tamanhos, entradas/saídas e dicionários. Modelos experimentais em `.ocr-models/experimental/v6`, servidos apenas pelas rotas dos testes. Os originais permanecem inalterados.

Os arquivos do modelo vieram dos pacotes ONNX oficiais do PaddlePaddle; os dicionários vieram do repositório oficial. Referências: [modelos PP-OCRv6](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.en.md), [configuração Tiny](https://github.com/PaddlePaddle/PaddleOCR/blob/main/configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml), [configuração Small](https://github.com/PaddlePaddle/PaddleOCR/blob/main/configs/rec/PP-OCRv6/PP-OCRv6_small_rec.yml).
