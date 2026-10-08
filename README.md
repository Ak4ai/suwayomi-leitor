# Suwayomi Leitor: tradução de quadrinhos

Protótipo da disciplina de Interação Humano-Computador (IHC), desenvolvido como fork do [Suwayomi-WebUI](https://github.com/Suwayomi/Suwayomi-WebUI). Reconhece texto em inglês e desenha a tradução em português sobre as páginas do leitor.

O projeto busca facilitar o acesso de quem não conhece o idioma original, incluindo pessoas que precisam de apoio para leitura. A implementação atual cobre OCR, tradução e redesenho; narração e outros recursos de acessibilidade fazem parte da proposta e ainda precisam ser desenvolvidos.

## Recursos implementados

- Tradução automática no menu do leitor nativo e informações no painel lateral direito.
- OCR local com detector de texto/balões e PaddleOCR; opções WASM e WebGPU com fallback.
- Gemini com chave do usuário, Google experimental sem chave, MyMemory e OPUS-MT local experimental.
- OPUS-MT compacto (~122 MB) ou maior (~519 MB), com normalização de maiúsculas opcional.
- Limpeza leve, LaMa e modo híbrido: leve para fundos uniformes, IA para os difíceis, com agrupamento de recortes.
- Renderização Canvas ou SVG, encaixe das falas, fontes locais e ampliação automática quando necessária.
- Processamento antecipado do capítulo inteiro, uma página por vez, priorizando a leitura atual; cache no IndexedDB.

## Executar no Windows

Requisitos: Git, Node.js com Corepack/pnpm, Python e Java 21 para o servidor local. O desenvolvimento atual usa PowerShell.

```powershell
git clone https://github.com/Ak4ai/suwayomi-leitor.git
cd suwayomi-leitor
corepack pnpm install --frozen-lockfile
Copy-Item .env.template .env
```

No `.env`, configure `PORT = 5173` e `VITE_SERVER_URL_DEFAULT = http://127.0.0.1:4567`.

### Servidor local

```powershell
npm run suwayomi:setup
npm run suwayomi:start
```

A instalação e a biblioteca ficam em `.local-server/`, ignorada pelo Git. Os scripts de instalação estão versionados; o servidor, banco, downloads e extensões não estão. Veja [SUWAYOMI-LOCAL.md](SUWAYOMI-LOCAL.md).

### Preparar OCR

```powershell
python -m venv .venv-ocr
.venv-ocr/Scripts/python.exe -m pip install -r tools/ocr_compare/requirements.txt
.venv-ocr/Scripts/python.exe tools/ocr_compare/prepare.py
npm ci --prefix tools/ocr-web-runtime
npm run reader:dev
```

Abra **http://127.0.0.1:5173**, adicione uma obra à biblioteca, abra o capítulo e ative **Traduzir automaticamente** no menu do leitor. O manifesto OCR já está versionado; não é necessário regenerá-lo para executar o leitor.

### Recursos opcionais

```powershell
# Limpeza com IA (~62 MB)
npm run inpaint:setup
# Tradutor local compacto e runtime
npm run translation:setup
# Tradutor local maior
npm run translation:setup:big
```

Escolha o tradutor, o método de limpeza e o renderizador em **Configurar tradução**. Os modelos são baixados separadamente; não estão no repositório. O protótipo separado pode ser aberto com `npm run ocr:web`, em **http://127.0.0.1:3003/chapter.html**.

## Estado e limitações

Este é um protótipo em desenvolvimento. OCR pode perder falas e a limpeza depende da qualidade da máscara; alguns textos ficam apenas no painel. OPUS-MT pode errar contexto e nomes, mesmo com normalização. Serviços externos estão sujeitos a quotas e indisponibilidade; Google sem chave utiliza endpoint experimental. Erros pausam a fila e permitem tentativa manual. Modelos locais exigem memória, armazenamento e download inicial.

OCR e inferência são executados no navegador. Google/MyMemory utilizam um relay local quando disponível; Gemini depende da API externa. OPUS-MT funciona localmente depois que os arquivos do modelo estiverem disponíveis. O acesso remoto ao OCR requer HTTPS; localhost é adequado no PC.

As avaliações documentadas foram feitas principalmente no PC. A integração mais recente do OPUS e da fila completa ainda precisa de teste de execução. Não há garantia de desempenho no S23 ou em todos os navegadores.

## Documentação

- [Plano do projeto](docs/ihc/plan.md) e [proposta em LaTeX](docs/ihc/main.tex).
- [Integração no leitor](NATIVE-READER-TRANSLATION.md).
- [OCR no navegador](OCR-WEB.md) e [comparação de OCR](OCR-COMPARISON.md).
- [Limpeza com IA e modo híbrido](AI-INPAINT.md), [renderização SVG](SVG-READER.md) e [OPUS-MT](OPUS-MT-TEST.md).
- [README original do Suwayomi](README-UPSTREAM.md).

Os relatórios descrevem experiências em momentos diferentes do desenvolvimento. Imagens de HQs, resultados locais e bibliotecas utilizadas nos testes não acompanham o repositório; ferramentas de diagnóstico podem exigir esses arquivos locais.

## Origem, licenças e créditos

Fork acadêmico independente do Suwayomi-WebUI; preserva a [licença do projeto original](LICENSE). Detector do ecossistema Comic Translate, reconhecimento PaddleOCR/RapidOCR, ONNX Runtime e Transformers.js; os manifestos dos modelos registram suas origens. Modelos possuem licenças próprias: consulte os manifestos e relatórios antes de redistribuir pesos. O modelo OPUS maior é de Helsinki-NLP, exportado por Douglasrambo, sob CC BY 4.0. As fontes Comic Neue e Bangers incluem os textos de licença OFL em `public/ocr-web/`.
