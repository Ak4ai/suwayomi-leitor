# Comparação de pontuação — Sorcerer Supreme #1

Data: 7 de outubro de 2026. Biblioteca local: manga 529, capítulo 67. Foram baixadas e processadas as 27 páginas reais do capítulo: 278 regiões brutas, 261 selecionadas; nenhuma miniatura. Maioria em 1988×3056, com páginas duplas maiores. OCR baseline somou aproximadamente 84,7 segundos, sem download nem tradução.

## Comparação controlada

Nas páginas 7, 12, 17, 18, 23 e 24, mantivemos as mesmas caixas de texto e modelos ONNX. Usamos o código de pré-processamento, DB, extração e associação de linhas do Comic Translate, fixado no commit `8977b91a4f7a40c3917c5a268e9e7d78e1d818da`. As funções puras são carregadas diretamente para evitar instalar a interface desktop. O teste reproduz essa etapa com nossos pesos locais; não é uma execução da aplicação inteira nem de seus motores remotos.

Oito balões foram transcritos a partir das imagens e usados como referência: 318 caracteres após remover espaços e padronizar maiúsculas e aspas tipográficas. Pontuação é contada. São exemplos escolhidos por apresentarem o problema, não uma amostra aleatória do capítulo.

| Método | Erros de caracteres | CER | Exemplos completos corretos |
|---|---:|---:|---:|
| OCR Web anterior | 19 | 5,97% | 1/8 |
| Mesmas linhas, redimensionamento do upstream | 17 | 5,35% | 3/8 |
| Extração de linhas e OCR de referência Comic Translate | 31 | 9,75% | 1/8 |
| Juntar fragmentos pequenos às linhas | 9 | 2,83% | 1/8 |
| Fragmentos + margem maior em todas as linhas | 3 | 0,94% | 5/8 |
| Fragmentos + releitura seletiva | 4 | 1,26% | 4/8 |

O fluxo de referência melhorou algumas aspas, mas perdeu palavras em outros exemplos. Não o adotamos integralmente. A margem maior em todas as linhas também alterou espaçamento e pontuação em linhas anteriormente boas; escolhemos a variante seletiva.

## Alteração aplicada ao leitor

- Junta componentes pequenos à linha horizontal vizinha quando há alinhamento e proximidade geométrica; isso inclui aspas que antes viravam uma linha isolada com `1` ou `11`.
- Restringe o ajuste a regiões classificadas como texto de balão pelo detector.
- Relê linhas com sinais suspeitos usando uma margem horizontal de 20% da altura, limitada à caixa de texto.
- Só aceita a releitura quando mantém a sequência alfanumérica, reduz sinais suspeitos e não apresenta queda grande de confiança. Confiança do modelo não é uma probabilidade calibrada de acerto.
- Não substitui `1` por aspas através de uma regra textual nem acrescenta pontos à força.
- Mantém os mesmos modelos e atualiza o pipeline para `web-3-punctuation-context`, invalidando o cache antigo de OCR/tradução.

Na referência, as confusões de aspas com `1` e `11` foram resolvidas. Persistem quatro diferenças: um ponto ausente em três reticências e um ponto ausente após “VISHANTI”. Outras reticências fora da referência ainda podem falhar. A ampliação automática da renderização continua separada desse ajuste do OCR.

Os tempos de Python e navegador não são diretamente comparáveis: usam runtimes e caminhos de processamento diferentes. As medições também ocorreram em execuções distintas, com inicialização e carga variável. Não concluímos ganho de velocidade a partir desses números.

## Reprodução

Com Suwayomi em 4567 e WebUI modificada em 5173:

```powershell
node tools/chapter-ocr-diagnostics.cjs 67 sorcerer-supreme-1 http://127.0.0.1:5173/ocr-web/chapter.html
.venv-ocr/Scripts/python.exe -m pip install mahotas
.venv-ocr/Scripts/python.exe tools/sorcerer-comic-translate-compare.py
node tools/sorcerer-fragment-check.cjs
node tools/sorcerer-fragment-check.cjs 0.2
node tools/sorcerer-fragment-check.cjs targeted
.venv-ocr/Scripts/python.exe tools/sorcerer-punctuation-metrics.py
node tools/sorcerer-fragments-unit-check.mjs
node tools/batman-regression-check.mjs
```

O diagnóstico acima força o pipeline anterior para manter o baseline. Resultados e imagens ficam em `ocr-runs/sorcerer-supreme-1`, ignorado pelo Git. Referências humanas estão em `tools/fixtures/sorcerer-punctuation-reference.json`. O código upstream e hashes dos arquivos usados são registrados junto dos resultados.

Fontes: [extração de linhas](https://github.com/ogkalu2/comic-translate/blob/8977b91a4f7a40c3917c5a268e9e7d78e1d818da/modules/detection/ppocr_lines.py), [pré-processamento](https://github.com/ogkalu2/comic-translate/blob/8977b91a4f7a40c3917c5a268e9e7d78e1d818da/modules/ocr/ppocr/preprocessing.py), [decodificação](https://github.com/ogkalu2/comic-translate/blob/8977b91a4f7a40c3917c5a268e9e7d78e1d818da/modules/ocr/ppocr/postprocessing.py).
