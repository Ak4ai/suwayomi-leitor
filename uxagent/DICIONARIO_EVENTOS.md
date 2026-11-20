# Dicionário de campos dos eventos (esquema v1)

Cada execução gera um arquivo `<politica>_<tarefa>_s<semente>.jsonl`, uma linha JSON por evento.

## Campos comuns

| Campo | Tipo | Significado |
|---|---|---|
| `schema` | string | Versão do esquema (`v1`). |
| `run_id` | string | `<politica>_<tarefa>_s<semente>`. Identifica a execução. |
| `task` | string | Tarefa de **calibração**: `C1` ou `C2`. V1/V2 não existem neste código. |
| `seed` | int | Semente da execução: fixa persona, deslizes motores e (com `seed` na API) a geração. |
| `seq` | int | Número sequencial do evento na execução. |
| `t` | float | Segundos desde o início da execução (tempo computacional, **não** tempo humano). |
| `origin` | string | Quem originou: `system`, `agent`, `persona`, `verifier`. |
| `type` | string | Tipo do evento (tabela abaixo). |
| `data` | objeto | Carga do evento (depende do tipo). |
| `state_before`, `state_after` | objeto/null | Estado da interface (`scene`, `focus`, `page_original`, `selected`, `submitted`, `quit`, `versions`). |

## Tipos de evento

| `type` | `origin` | Campos em `data` | Quando ocorre |
|---|---|---|---|
| `task_start` | system | `policy`, `max_actions` | Início da execução. |
| `parameter_sampled` | persona | `seed`, `c`, `k`, `u`, `v`, `d` | Parâmetros da persona sorteados fora do prompt. |
| `observation` | system | `text`, `audit` | Observação textual `o_t` enviada ao agente. `audit` (analista): painéis visíveis, incerteza do quadro em foco, elegibilidade de ajuda, porta do painel. |
| `llm_request` | system | `messages` | Mensagens **exatamente** enviadas ao LLM (system + user). Só nas políticas com LLM. |
| `llm_response` | agent | `raw`, `proposal`, `meta` | Resposta crua do LLM e ação proposta extraída. `meta` traz modelo e uso de tokens (Groq). |
| `action_rejected` | system | `proposal`, `reason` | Proposta fora das ações habilitadas. Não altera a cena e **não** conta como ação executada. |
| `action_executed` | agent | `requested`, `executed`, `support` | Ação aplicada. `executed` difere de `requested` se houve deslize motor. |
| `motor_slip` | persona | `intended`, `executed` | Deslize motor (mecanismo `d`): a alternativa executada foi a vizinha. |
| `help_requested` | agent | — | O agente executou `pedir_ajuda`. |
| `help_delivered` | system | `type` | Conteúdo de ajuda mostrado (`ajuda_navegacao`, `ajuda_traducao`, `ajuda_tarefa`). Só após `help_requested`. |
| `technical_failure` | system | `error` | Erro de infraestrutura (GPU, API). Sai do denominador de S. |
| `verification` | verifier | `status`, `valid_run`, `correct`, `executed_actions`, `excess_actions`, `hash` | Resultado do verificador externo, lido do estado final. |

## Parâmetros da persona (hipóteses de modelagem, não medições)

| Parâmetro | Distribuição | Efeito (fora do prompt) |
|---|---|---|
| `c` cobertura lexical | U(0,75; 0,90) | Palavras inglesas fora da cobertura aparecem como `[?]`. |
| `k` janela de leitura | {2, 3, 4} | Só `k` quadros ficam visíveis ao mesmo tempo. |
| `u` limiar de apoio | U(0,15; 0,30) | `pedir_ajuda` só é habilitada se a fração de palavras mascaradas no quadro em foco for maior que `u`. |
| `v` estratégia | Bernoulli(0,70) | Com `v`, `abrir_painel` só é habilitada depois de checar a fonte (balão ou página original). |
| `d` precisão motora | U(0,95; 1,00) | Com probabilidade `1 - d`, `selecionar_x` executa a alternativa vizinha. |

## Estados e ações (MoLIC)

| Cena | Ações habilitadas (falas u:) |
|---|---|
| `leitura` | `ler_proximo`, `ler_anterior`, `alternar_balao`, `mostrar_original`, `abrir_painel`*, `pedir_ajuda`*, `selecionar_<x>`, `desistir` |
| `painel` | `fechar_painel`, `alternar_balao`, `pedir_ajuda`*, `selecionar_<x>` |
| `ajuda` | `ajuda_navegacao`, `ajuda_traducao`, `ajuda_tarefa` (exceto o tipo já exibido), `fechar_ajuda` |
| `resposta_selecionada` | `enviar`, `selecionar_<x>` (exceto a já marcada), `voltar_leitura`, `desistir` |
| `fim` | terminal |

\* sujeita aos mecanismos da persona. Ações de suporte: `alternar_balao`, `mostrar_original`, `abrir_painel`, `pedir_ajuda`.

## Estados finais (verificador)

`correct`, `incorrect`, `quit` (desistência), `timeout` (40 ações sem resposta), `stalled` (3 propostas inválidas seguidas; **falha de decisão do agente**, conta como não-sucesso), `technical_failure` (infraestrutura; fora do denominador).

## Métricas (`analyze.py`)

- **S** = corretas / válidas, com válidas = iniciadas − falhas técnicas.
- **U** = execuções válidas com pelo menos um apoio / válidas.
- **A** = ações executadas; **A_x** = A − caminho mínimo da HTA (excesso, nunca negativo).
- **Re** = (propostas rejeitadas + deslizes motores + resposta incorreta) / propostas do agente.
- **Rupturas (MAC)**, só por assinatura no log: `acao_inexistente` (`action_rejected`), `onde_estou` / `o_que_posso_fazer` / `ajuda_tarefa` (tipo de ajuda entregue), `alternancia_repetida` (3 `alternar_balao` seguidos), `desisto`, `travamento`, `resposta_sem_inspecao` (fala destacada visível e envio sem apoio), `atalho_menos_acoes_que_o_minimo`.
- **KLM**: operadores K = 0,20 s, P = 1,10 s, M = 1,35 s (Card, Moran e Newell, 1980); R = 0,30 s é suposição do projeto. Cada ação custa P+K; `selecionar_*` soma M; ajuda soma R; M inicial por tarefa. O tempo do agente é **equivalente KLM**, não tempo humano observado.
