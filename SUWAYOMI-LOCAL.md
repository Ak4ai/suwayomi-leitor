# Suwayomi Server local

Configurado em 06/10/2026 para substituir o Fly.io nos testes. Servidor oficial estável **v2.4.2366**, executado com o Java 21 já instalado no notebook.

## Acessar

- Biblioteca do Suwayomi: **http://127.0.0.1:4567/library**.
- Protótipo com OCR/tradução: **http://127.0.0.1:3003/chapter.html**.
- Página de referência: **http://127.0.0.1:4567/manga/1/chapter/1**.
- Amostra Spider-Man: **http://127.0.0.1:4567/manga/2/chapter/2**.

No protótipo, clique em **Abrir este link**, escolha Google experimental ou Gemini e depois **Começar / continuar**. O campo Servidor já aponta para `http://127.0.0.1:4567`. Preferências antigas do endereço Fly.io são migradas para o servidor local, preservando modelo/chave e as demais opções.

O servidor local entrega imagens e mantém a biblioteca. OCR continua no navegador. Google/Gemini/MyMemory continuam dependendo de internet; a instalação do servidor não torna esses tradutores offline.

## Ligar, parar e reiniciar

Na pasta `suwayomi-leitor`:

```powershell
npm run suwayomi:start
npm run suwayomi:status
npm run suwayomi:stop
npm run suwayomi:restart
```

Para iniciar também o protótipo de OCR, se estiver parado:

```powershell
npm run ocr:web
```

Os processos são iniciados sem abrir janelas de terminal ou navegador. O comando `suwayomi:start` aguarda a API responder e evita iniciar uma segunda instância. O PID é conferido junto ao caminho do JAR e dos dados antes de encerrar o processo. O launcher usa o executável real do JDK, evitando deixar a JVM filha aberta pelo atalho Oracle `javapath`.

## Dados persistentes

Tudo fica em **`.local-server/data`**, dentro deste projeto:

- `database.mv.db`: banco H2 da biblioteca.
- `server.conf`: configuração.
- `local`: imagens das amostras e novas HQs locais.
- `downloads`, `backups`, `extensions`, `settings` e `webUI`: dados do Suwayomi.

Binário em `.local-server/bin`; logs de inicialização em `.local-server/logs`. Essa pasta é ignorada pelo Git. Não é recriada nem apagada ao iniciar/parar o servidor. Apagar `.local-server/data` remove a biblioteca local; para transportar a instalação, copie os dados com o servidor parado.

O servidor escuta somente em `127.0.0.1:4567`. O perfil inicial desativa ícone de bandeja, abertura automática do navegador e download do WebView KCEF, e desativa a busca periódica por atualização da WebUI. A WebUI oficial foi instalada e verificada no navegador.

## Amostras disponíveis

1. **Amostra IHC - OCR ingles:** uma página, a `7.jpg` usada nos testes de fidelidade.
2. **Ultimate Spider-Man - amostra salva:** nove imagens salvas durante o teste anterior, com os números originais preservados nos nomes. **É uma amostra parcial do #133, não a edição completa.**

A API do Fly.io foi consultada e respondeu com biblioteca vazia, portanto não foi possível recuperar dali o capítulo completo ou migrar seus registros. As amostras usam a fonte local integrada ao Suwayomi e não requerem instalar HQNow.

Para importar um capítulo completo, coloque as imagens em:

```text
.local-server/data/local/
  Titulo da HQ/
    Capitulo 001/
      001.jpg
      002.jpg
      003.jpg
```

CBZ também é aceito como arquivo dentro da pasta da HQ. Abra **Browse → Local source** no Suwayomi, adicione a obra à biblioteca e atualize os capítulos. Depois cole o link do capítulo no protótipo. Para ler diretamente de extensões como HQNow, configure o repositório/extensão na interface normal do Suwayomi.

## Reproduzir a instalação

```powershell
npm run suwayomi:setup
npm run suwayomi:start
npm run suwayomi:seed
```

`setup` baixa o JAR oficial e valida SHA-256:

```text
af9feb20af9d7ebe9e30769e6c6ebc7fc7ab1c447388d42e0280b1da5fe07bfd
```

Requer Python com `httpx` para os scripts de download/registro e Java 21 ou superior para o servidor. O registro das amostras afeta somente as duas obras de teste no endereço local. Executar novamente preserva os dados existentes e não substitui imagens/configuração já presentes.

Origem: [release oficial v2.4.2366](https://github.com/Suwayomi/Suwayomi-Server/releases/tag/v2.4.2366). Referências: [configuração do servidor](https://github.com/Suwayomi/Suwayomi-Server/wiki/Configuring-Suwayomi%E2%80%90Server), [fonte local](https://github.com/Suwayomi/Suwayomi-Server/wiki/Local-Source).

## Verificações realizadas

- Checksum do JAR oficial e versão da API conferidos.
- Duas obras/chapítulos adicionados à biblioteca local.
- Servidor encerrado e reiniciado de verdade; banco, IDs e biblioteca preservados.
- WebUI oficial exibiu as duas capas na biblioteca.
- Protótipo consultou biblioteca, capítulos e imagens locais através do navegador.
- OCR real e Google experimental na página de referência: 14 trechos traduzidos, 11 balões aplicados; preparação em aproximadamente 19 s nessa execução com download/inicialização e tradução.
- Navegação pela amostra local de nove páginas, sem erros JavaScript.

Para repetir o teste de navegador: `node tools/suwayomi-local-check.cjs`. Ele faz traduções reais pelo Google experimental e depende de internet. Resultados e capturas em `ocr-runs/suwayomi-local-check.json`, `local-chapter-reader.png` e `local-suwayomi-library.png`, ignorados pelo Git.
