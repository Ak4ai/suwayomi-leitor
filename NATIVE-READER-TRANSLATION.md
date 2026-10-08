# Tradução no leitor do Suwayomi

A primeira integração usa a WebUI modificada do projeto, sem abrir o protótipo `chapter.html`.

O módulo em `public/ocr-web` é carregado pelo navegador com uma entrada `<script type="module">` e entrega sua API à interface por um evento. Isso evita o erro do Vite ao importar recursos de `public` a partir de `src`. A API também permanece disponível para recarregamento dos componentes durante desenvolvimento.

## Abrir

Na pasta do projeto:

```powershell
npm run suwayomi:start
corepack pnpm install --frozen-lockfile
corepack pnpm reader:dev
```

Abra http://127.0.0.1:5173/library e abra um capítulo normalmente. A WebUI original instalada no servidor continua em 4567; as alterações desta implementação estão na WebUI de desenvolvimento em 5173.

No menu lateral do leitor, há **Traduzir automaticamente** e **Mostrar informações da tradução**. Os mesmos controles aparecem no diálogo de configurações, acessível também no celular. Em **Configurar tradução**, selecione Google sem chave, MyMemory ou Gemini, com chave e seleção de modelo. A chave só é persistida com a opção de lembrar ativada; fica em texto simples no armazenamento local. Preferências do protótipo em 3003 não migram automaticamente para 5173: são origens diferentes.

## Fluxo e painel

- Prioriza a página atual e prepara as duas seguintes em uma fila serial.
- Mantém o original até gerar o PNG traduzido; desligar a opção restaura o original.
- Reutiliza OCR, tradução, fontes, máscara e ampliação automática já existentes.
- Cancela processamento ao sair ou mudar de capítulo e libera URLs de imagens renderizadas.
- Mantém uma janela de imagens renderizadas em memória; OCR e tradução ficam no cache IndexedDB.
- O painel de status é fixo na margem esquerda, com altura limitada e rolagem interna. Não entra no fluxo abaixo da página.
- Quando a margem lateral não comporta o painel, usa um indicador recolhível sobre a área de leitura. Não há espaço garantido em páginas largas, leitura dupla ou celulares.
- Mostra falas, erros e motivos de traduções mantidas apenas nas informações. Permite tentar novamente a página em caso de falha.

## Recursos e limites

### Tradutores sem chave e bloqueio de CORS

No leitor local, Google/MyMemory agora usam um encaminhamento no próprio servidor Vite (5173), ou no servidor do protótipo. Isso resolve a impossibilidade de o navegador ler algumas respostas sem cabeçalho CORS e permite mostrar o status HTTP real. Os destinos são fixos, o texto é limitado a 500 bytes e chaves/API URLs arbitrárias não são aceitas. HTTPS e certificados continuam sendo validados.

No caso da página 3, reproduzimos o bloqueio de CORS na terceira fala. Pelo encaminhamento, o Google retornou HTTP 429. Portanto, o encaminhamento não elimina os limites do Google; após uma resposta 429 há uma pausa local mínima de 60 segundos (ou o Retry-After do serviço). MyMemory respondeu com sucesso numa frase curta pelo encaminhamento, mas suas correspondências parciais e cotas continuam sendo limitações.

Em hospedagem somente estática, o encaminhamento não existe e o cliente tenta a chamada direta. O texto passa pelo servidor local antes do tradutor quando o encaminhamento está disponível, conforme indicado nas configurações. O servidor não registra o texto nessa rota. Após instalar a alteração, reinicie `corepack pnpm reader:dev` caso o Vite não reinicie automaticamente e recarregue a página.

O seletor **Limpeza do texto original** oferece Leve (padrão) e LaMa com IA (experimental), independentemente de SVG/Canvas. O modelo opcional é carregado no navegador, com cache e progresso; veja `AI-INPAINT.md` para os resultados e limites medidos.

Em **Configurar tradução → Desenho do texto**, Canvas e SVG experimental podem ser comparados. SVG incorpora o fundo limpo como PNG e as letras como texto vetorial com fontes embutidas. Veja `SVG-READER.md` para as verificações executadas e a limitação da validação visual neste ambiente.

`reader:prepare` copia os modelos e o runtime locais para `public/ocr-web/models` e `vendor`, ignorados pelo Git. Para distribuir uma build, prepare esses recursos antes de empacotá-la e configure HTTPS/localhost com COOP/COEP no host. A configuração Vite de desenvolvimento fornece os cabeçalhos necessários. O navegador precisa poder acessar as imagens do servidor com CORS.

A tradução automática é assíncrona: a primeira página exige carregar os modelos e executar OCR. Google sem chave permanece experimental. Gemini depende de cota e modelo disponível. O bloqueio de miniaturas permanece ativo e o upscale da renderização não recupera as regiões vazias do OCR.

Não foram adicionados nem executados testes nesta integração. Precisamos conferir visualmente o leitor normal, páginas duplas, mudanças de capítulo e telas estreitas antes de considerar a integração validada.
