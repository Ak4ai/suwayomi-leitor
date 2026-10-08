# Limpeza opcional com IA

## Usar no leitor

Recarregue a WebUI modificada com Ctrl+Shift+R. No menu do leitor, abra **Configurar tradução → Limpeza do texto original → Com IA — LaMa (experimental)**. Escolha Automático ou WASM e salve. SVG e Canvas funcionam com os dois métodos de limpeza.

O modo **Leve** continua sendo o padrão. Alterar a limpeza refaz as imagens; OCR e tradução completos são reaproveitados do cache quando disponíveis. Se a limpeza falhar, a página mantém o original, o painel apresenta o erro e oferece nova tentativa; não simulamos sucesso com uma troca silenciosa para o modo leve.

## Modelo e privacidade

Modelo opcional: `lama_512_int8.onnx`, exportado por [g-ronimo/lama](https://huggingface.co/g-ronimo/lama), commit `418036c6b541e526cdbb0bead1ec3a87dabede53`. Arquivo de **62.074.990 bytes**, SHA-256 `cab19978adc306622fe37ef60d4a52103b99c98141d499c2a2366a7ed1255dbe`. O card informa licença Apache-2.0. O projeto original é [LaMa](https://github.com/advimman/lama).

O modelo é baixado somente quando há regiões para limpar no modo IA, verificado por checksum e salvo em Cache Storage quando o navegador permite. Não usa chave de API e não envia as imagens para o serviço do modelo. Primeiro procura o arquivo servido localmente; se ausente, baixa a versão fixa do Hugging Face. O custo de download, processamento e memória depende do dispositivo.

Para preparar o modelo no servidor estático local:

```powershell
npm run inpaint:setup
```

O setup já foi executado nesta máquina. `reader:prepare` copia o modelo somente se ele já existe; não inicia um download de IA para quem usa o modo leve. O manifesto está em `public/ocr-web/inpaint-model.json`.

## Fluxo

- Worker separado para manter a interface responsiva, com sessões reaproveitadas.
- Usa as máscaras do método leve quando disponíveis.
- Para fundos recusados pelo método leve, pode usar uma máscara mais ampla, limitada às linhas OCR e à caixa do balão. Essa alternativa pode reconstruir detalhes de desenho dentro dessas caixas; não garante fidelidade de uma ilustração.
- Processa cada recorte com contexto em 512×512, sequencialmente, e copia o resultado apenas nos pixels mascarados.
- Desenho das falas continua separado: utiliza a imagem original para métricas/estilo e o fundo produzido pela IA para renderização.
- Desativar tradução, trocar configurações ou sair do leitor cancela o worker e libera o modelo.
- Se WebGPU falhar na inicialização/execução, tenta WASM. “WebGPU” nas métricas significa provedores configurados WebGPU + WASM; não prova que todos os operadores executaram na GPU.
- O painel mostra tempo e quantidade de recortes. Há timeout de três minutos por página; no celular uma página grande pode ultrapassá-lo.

## Validação executada

Teste real no Edge com dois balões amarelos da página 20 de Sorcerer Supreme, usando a imagem/OCR salvos e traduções de referência, sem chamadas de tradução:

| Modo | Tempo total | Inferência, dois recortes | Pixels alterados fora da máscara | Falas desenhadas |
|---|---:|---:|---:|---:|
| WASM | 15,56 s | 14,00 s | 0 | 2/2 |
| Automático (WebGPU + WASM configurados) | 17,22 s | 15,11 s | 0 | 2/2 |

O fundo limpo foi inspecionado visualmente: removeu as letras dos dois balões e recuperou a região clara central, com pequenos detalhes residuais possíveis. O teste não demonstra superioridade em todos os fundos, vantagem de GPU nem desempenho no S23. Não medimos o pico de memória neste teste.

Também executamos um caso sintético de fundo complexo recusado pela limpeza leve, exercitando a máscara ampla: uma fala desenhada, zero alterações fora da máscara, aproximadamente 8,16 s no total e 6,93 s de inferência em WASM. Esse caso valida o caminho de execução, não a qualidade de reconstrução de uma HQ real.

Reprodução:

```powershell
node tools/ocr-web-server.mjs --port=3004
# Em outro terminal:
node tools/ai-inpaint-browser-check.cjs wasm
node tools/ai-inpaint-browser-check.cjs auto
node tools/ai-inpaint-browser-check.cjs wasm complex
```

Resultados: `ocr-runs/sorcerer-supreme-1/ai-*-check.json`, `ai-*-cleaned.png` e `ai-*.svg`. A pasta é ignorada pelo Git. O servidor de comparação em 3004 tem cache independente da WebUI em 5173.

## Próximos testes

Comparar mais fundos reais (gradientes, textura, transparência e desenho), medir memória e testar no S23. O modo IA em todos os balões continua disponível para comparação; o novo modo híbrido reserva LaMa para fundos difíceis. A máscara continua sendo uma limitação: inpainting não remove letras que ficaram fora dela nem recupera falas ausentes do OCR.


## Fluxo híbrido inspirado no Comic Translate

No leitor, escolher **Configurar tradução > Limpeza do texto original > Híbrido**.

- Fundos classificados como uniformes (`flat-colour`) usam a limpeza leve existente.
- Gradientes, cores irregulares e fundos recusados pelo método leve usam LaMa.
- Recortes separados por até 32 pixels podem compartilhar uma inferência. A união fica limitada a 576 pixels por lado, mais 64 de contexto; assim o agrupamento não reduz a escala do modelo abaixo de 0,8. Recortes individuais maiores continuam sujeitos ao limite 512 do modelo.
- O resultado continua restrito à união das máscaras. Geometria e encaixe do texto permanecem individuais.
- Páginas inteiramente uniformes dispensam a inicialização do modelo. O fundo leve é transferido como ImageBitmap, sem codificar uma página inteira em PNG.

Referência: https://github.com/ogkalu2/comic-translate/blob/main/pipeline/inpainting.py . Adaptamos a ideia de limpeza simples antes da inferência e agrupamento; não reproduzimos sua seleção de inferência em página inteira porque o nosso modelo tem entrada fixa 512.

Comparativo no PC, Edge/WASM, quatro balões reais da página 20 (`s1,s9,s10,s11`), traduções de referência:

| Fluxo | Total | Execuções LaMa | Balões leves | Falas SVG | Alterações fora das máscaras |
|---|---:|---:|---:|---:|---:|
| IA em todos, com agrupamento | 29,57 s | 3 | 0 | 4/4 | 0 |
| Híbrido, com transferência direta | 10,12 s | 1 | 2 | 4/4 | 0 |

Um teste por configuração, incluindo inicialização; não constitui média nem medida do S23. Inspeção visual do fundo híbrido: os dois balões amarelos adjacentes mantiveram contornos e brilho central. A qualidade segue limitada pela máscara e pelo OCR.

```powershell
node tools/ai-inpaint-browser-check.cjs wasm sample all
node tools/ai-inpaint-browser-check.cjs wasm sample hybrid
```
