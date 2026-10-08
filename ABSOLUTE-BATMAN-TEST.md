# Absolute Batman: análise do capítulo 1

Teste em 06/10/2026 no servidor local. A obra **Absolute Batman (2024-)** já estava na biblioteca, ID 33, fonte GlobalComix inglês.

## Capítulo correto

O capítulo 1 apontado pelo usuário é **Absolute Batman Vol. 1: The Zoo**, ID interno **61**, com **179 páginas**:

**http://127.0.0.1:4567/manga/33/chapter/61**

O diagnóstico inicial havia usado a edição isolada **Absolute Batman #1**, ID 58, com 44 páginas. Esses arquivos estão separados e não são apresentados como avaliação do volume de 179 páginas.

## Problema principal confirmado nas 179 páginas

Todas as páginas do volume foram verificadas pela API local, lendo as dimensões do JPEG:

| Páginas | Resolução entregue | Quantidade |
|---|---|---:|
| 1–10 | 1988 × 3057 | 10 |
| 11–179 | 280 × 431 | **169** |

Os pedidos de imagem foram bem-sucedidos, mas as últimas 169 imagens são pequenas demais para recuperar com fidelidade as letras desses balões. O número de páginas nos metadados não garante resolução normal de todas elas. Aumentar a imagem para exibição não recupera detalhes perdidos.

Não foi determinada a causa da resolução reduzida entre o provedor, a extensão e os dados servidos. Não foram testadas formas de contornar restrições da fonte. Para avaliar essas páginas corretamente, precisamos de um arquivo/fonte que forneça imagens em resolução normal. O usuário foi solicitado a disponibilizar esse material.

## OCR e causas adicionais

Executado OCR real nas dez páginas grandes do volume, com V5 inglês, WASM e quatro threads. Soma dos tempos de OCR: **22,56 s**; 56 regiões brutas e 44 selecionadas após filtros. São capas, créditos e início da história; não representam o capítulo inteiro nem uma taxa de acerto textual. Há erros de letras/capitalização em texto estilizado, mesmo em resolução normal. Não foi construída uma referência revisada de todas essas falas, portanto não há CER/WER publicado para o volume.

A edição isolada de 44 páginas foi usada inicialmente para examinar casos de recorte e associação. Dois problemas de implementação foram reproduzidos:

1. **Associação rígida de balão:** `NO WEAKNESS.` teve caixa de texto `[454,1537,665,1582]` e balão `[439,1543,664,1608]`. A tolerância antiga de cinco pixels falhava por um pixel no topo e o trecho podia desaparecer em **Somente balões**. A associação agora considera o centro do texto e pelo menos 80% de sua área dentro da caixa do balão, escolhendo o menor candidato compatível. Quando há classificação `bubble-text` sem contorno associado, o texto continua no painel; um contorno não é inventado para limpeza.
2. **Componente minúsculo como letra:** no bloco `Amir left Kabul...`, um recorte de três por três pixels virou `A`, com confiança 0,07. Componentes com área inferior a 16 pixels e altura inferior a quatro são removidos antes de reconhecer linhas. Isso não é correção linguística de palavras.

Foi experimentado cortar sobreposição vertical entre caixas de linha. A variante removeu alguns resíduos, mas piorou outras palavras (`something's`, `you too well`, entre outras) nas páginas conferidas. **Essa variante não foi ativada no fluxo normal.** O modelo reconhecedor permanece o mesmo.

## Mudanças no leitor

- **Aviso de imagem pequena:** visível já ao abrir uma miniatura.
- Por padrão, imagens com menor dimensão abaixo de 480 e maior dimensão abaixo de 800 pausam a preparação antes da tradução. Essa heurística também pode atingir um recorte pequeno legítimo, não identifica a causa de baixa resolução.
- **Permitir imagens pequenas — teste experimental** permite tentar mesmo assim; não promete recuperação de informação.
- **Motivo da tradução ficar no painel:** fundos/contornos incertos, falta de contorno e texto sem espaço legível agora são explicados junto à fala. Um balão não pintado não significa necessariamente texto ignorado pelo OCR.
- Nova identificação `web-2-balloon-association` para o pipeline, evitando reutilizar OCR antigo sem as correções.
- Resultados brutos, classificação e caixas de detecção disponíveis nos relatórios de teste.

## Testes e artefatos

```powershell
node tools/batman-regression-check.mjs
node tools/thumbnail-browser-check.cjs
node tools/batman-volume-browser-check.cjs
node tools/absolute-batman-ocr-check.cjs corrected 10 61
```

Passaram associação nas bordas, descarte do artefato minúsculo, manutenção de fala identificada sem contorno, identificação de miniatura, bloqueio antes de chamar tradutor e ativação explícita do modo experimental. O teste real do leitor abriu o volume com 179 páginas, navegou para a página 11, informou 280 × 431 e pausou a fila **sem fazer chamadas de tradução**. Sem erros JavaScript.

Também passaram as regressões existentes de fila, cache, repetição do Gemini, preferências e lettering da `7.jpg`.

Relatórios em `ocr-runs/absolute-batman-volume-1/`: `resolution-all.json`, `corrected-001.json` a `corrected-010.json`, `corrected-summary.json`, `low-resolution-warning.png`. Metadados do volume em `ocr-runs/absolute-batman-volume-1.json`. Diagnóstico inicial da edição isolada, incluindo a variante de recorte rejeitada, em `ocr-runs/absolute-batman-1/`. Todos são arquivos locais ignorados pelo Git.
