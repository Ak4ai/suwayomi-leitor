# Tradução local OPUS-MT — teste no navegador

Testes executados em 7 de outubro de 2026 no Edge, em WASM com duas threads. Imagem/OCR: Sorcerer Supreme #1, página 20, 11 falas, mais a frase de várias sentenças que falhava no MyMemory. Não houve chamadas a Google, MyMemory ou Gemini. Nas execuções instrumentadas, nenhum host externo recebeu requisições: runtime, configuração e pesos foram servidos localmente.

## Modelos

| Modelo | Revisão | Arquivos preparados |
|---|---|---:|
| Xenova/opus-mt-en-ROMANCE, q8 | `9d2ba69ac80c8e8453c3d9a1e2323a0e7b8ca3cd` | 122,4 MB |
| Douglasrambo/opus-mt-tc-big-en-pt-onnx, q8 | `738ee4cce801ce7c519954e4b78d02d5057b6740` | 518,5 MB |

O compacto tem aproximadamente 113 MB de pesos; o restante são arquivos do tokenizer/configuração. O maior tem cerca de 516,5 MB de pesos. Runtime: Transformers.js 3.8.1, isolado do ONNX Runtime usado pelo OCR/inpainting. Esses tamanhos não representam o pico de RAM, que não foi medido.

Fontes e licenças: [compacto ONNX](https://huggingface.co/Xenova/opus-mt-en-ROMANCE), [original Helsinki-NLP](https://huggingface.co/Helsinki-NLP/opus-mt-en-ROMANCE) (Apache-2.0), [maior ONNX](https://huggingface.co/Douglasrambo/opus-mt-tc-big-en-pt-onnx) (CC-BY-4.0, conversão de Helsinki-NLP por Douglasrambo). Manifestos locais registram revisão, tamanho e hashes por arquivo.

## Configuração do experimento

- Modelo compacto: prefixo de idioma `>>pt_BR<<`, também comparado com `>>pt<<`.
- Modelo maior: prefixo `>>pob<<` para português brasileiro.
- Decodificação gulosa, sem amostragem, com `num_beams: 1`.
- As falas são divididas em sentenças com Intl.Segmenter e os resultados são reunidos. Isso evita perder as sentenças seguintes em modelos que tendem a traduzir somente a primeira.
- Não há truncamento silencioso de entrada. Saídas que chegam ao limite de geração ou não terminam com EOS são recusadas.
- Esses controles não detectam toda omissão ou troca de sentido: o modelo pode terminar normalmente e ainda traduzir incorretamente.
- Foram comparados texto OCR original em caixa alta e texto com capitalização normalizada. A normalização pode alterar nomes e siglas e permanece uma opção explícita no laboratório, não uma correção automática universal.

## Medições

| Variante | Inicialização | Tradução das 11 falas após carregar |
|---|---:|---:|
| Compacto, caixa alta, pt_BR | 2,57 s | 8,35 s |
| Compacto, capitalização normalizada, pt_BR | 3,00 s | 7,02 s |
| Compacto, capitalização normalizada, pt | 2,43 s | 8,60 s |
| Maior, caixa alta, pt_BR | 48,18 s | 12,22 s |
| Maior, capitalização normalizada, pt_BR | 30,95 s | 18,76 s |

São execuções distintas, não um benchmark estatístico controlado. O primeiro controle completo inclui ainda sua própria inferência e pode demorar significativamente mais que a inicialização: na execução maior normalizada, o controle levou cerca de 75 s ao todo. Não medimos no S23, não testamos WebGPU e não concluímos velocidade garantida a partir destes valores.

## Qualidade observada

O modelo compacto errou vários termos e sentidos em caixa alta. Exemplos: “frightened child” virou “criança apaixonada” e “cloak” virou “armário”. A capitalização normalizada corrigiu esses exemplos, mas não resolveu o vocabulário da HQ: “ward of witchcraft” foi traduzido como uma ala/pavilhão e “Sorceress Supreme” como “sorceresse suprema”. Algumas falas perderam sentido, e a saída em português geral omitiu parte de uma cláusula.

O modelo maior também teve erros graves com caixa alta. Com capitalização normalizada, traduziu corretamente os termos “manto”, “criança assustada”, “Você finge força” e “feiticeira suprema”. Ainda interpretou mal “ward of witchcraft” e traduziu Doom como substantivo comum (“desgraça”). A referência humana é usada para revisão, não para exigir uma única tradução literal.

A frase de controle saiu completa no maior normalizado: “Não sei. Eu sou... apenas uma pessoa. Não sei como consertar o mundo.” Isso comprova cobertura desse exemplo, não fidelidade de todas as falas.

Há também erro no OCR de origem: `MASTERS..ATRUE`, que contém falta de espaço/pontuação. É necessário separar erros de OCR dos erros do tradutor na avaliação.

**Decisão:** manter os dois modelos em um laboratório de teste, sem substituir o tradutor padrão nem integrar o compacto como alternativa confiável automática. O maior é candidato para avaliação adicional, mas tem custo alto de download/memória e erros de nomes/contexto.

## Testar manualmente

Com a WebUI modificada ativa: http://127.0.0.1:5173/ocr-web/translation-local.html.

O servidor do laboratório desta execução está em http://127.0.0.1:3008/translation-local.html. Escolha modelo, variante de português e se deseja adaptar caixa alta. A tela mostra entrada usada e métricas. Foi executado também um teste de interação do formulário, com tradução concluída e resultado em português.

Preparação, na pasta `suwayomi-leitor`:

```powershell
npm run translation:setup
npm run translation:setup:big
node tools/ocr-web-server.mjs --port=3008
```

Os dois setups já foram executados nesta máquina. Modelos e vendor estão ignorados pelo Git. O modelo grande é opcional.

Reproduzir comparativos em outro terminal:

```powershell
node tools/opus-browser-check.cjs http://127.0.0.1:3008/chapter.html
node tools/opus-browser-check.cjs http://127.0.0.1:3008/chapter.html sentence
node tools/opus-browser-check.cjs http://127.0.0.1:3008/chapter.html sentence pt
node tools/opus-browser-check.cjs http://127.0.0.1:3008/chapter.html original pt_BR big
node tools/opus-browser-check.cjs http://127.0.0.1:3008/chapter.html sentence pt_BR big
```

Relatórios em `ocr-runs/sorcerer-supreme-1/opus*-check.json`. A primeira execução não tinha captura de hosts externos; as execuções posteriores registram esse indicador. Não há dependência de chaves de API nesses testes.


## Integração no leitor nativo

OPUS-MT agora está disponível em **Configurar tradução > Tradutor > OPUS-MT local (experimental)**, com modelos compacto e maior. A normalização de maiúsculas pode ser desligada; o painel conserva o texto OCR original. Modelo, normalização e fornecedor possuem chaves distintas de cache de tradução. O worker é reutilizado entre páginas e cancelado ao desativar ou sair do leitor.

A fila nativa segue até o final do capítulo, priorizando a página atual, as seguintes e depois as anteriores ainda pendentes. Processa uma página por vez. Imagens finalizadas são guardadas no IndexedDB e liberadas da memória fora da janela de leitura; registros de conclusão impedem repetição na fila. Ao retornar, a imagem é restaurada do cache. Se o navegador recusar armazenamento, o retorno pode exigir novo redesenho usando o OCR/tradução em cache. Erros continuam pausando a fila para evitar requisições repetidas a fornecedores indisponíveis.

Preparar assets em outra máquina: `npm run translation:setup` e, para o modelo maior, `npm run translation:setup:big`. O modelo maior deriva do OPUS-MT Helsinki-NLP e da exportação Douglasrambo, sob CC BY 4.0, conforme referências deste documento. Continua experimental devido à qualidade observada nos comparativos.

Esta integração não recebeu um novo teste de execução nesta alteração; os resultados acima são do laboratório anterior.
