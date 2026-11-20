# UX-Agent para leitura de quadrinhos traduzidos (calibração C1 e C2)

Agente proxy baseado em LLM que opera uma interface experimental no lugar da persona e gera logs JSON auditáveis.
Interface sintética inspirada no leitor web `suwayomi-leitor` (tradução reversível por balão, painel de inspeção).

## Estrutura

| Arquivo | Papel |
|---|---|
| `scenes.py` | Cenas públicas C1 e C2 (o que o leitor humano e o agente podem perceber). |
| `env.py` | Interface instrumentada, máquina de estados MoLIC e observação textual `o_t`. |
| `persona.py` | Amostrador e mecanismos de persona **fora do prompt** (`c, k, u, v, d`). |
| `policies.py` | Políticas: `random` (comparador neutro), `qwen` (local), `groq` (API). |
| `verifier.py` + `gabarito_private.json` | Verificador externo. O gabarito só é lido aqui, depois do término. |
| `run_pilot.py` | Executa C1 e C2 e grava um `.jsonl` por execução, `config.json` e `summary.json`. |
| `web_ui.py` | Interface web: tela do leitor humano + modo agente ao vivo (mostra a tela, o `o_t` enviado ao agente, a resposta do LLM e os eventos). |
| `analyze.py` | Análise do analista: S, U, A, A_x, Re, rupturas por assinatura no log, KLM. |
| `test_boundaries.py` | Testes de fronteira (sem vazamento de gabarito/HTA/parâmetros; ações por estado; V1/V2 ausentes). |
| `DICIONARIO_EVENTOS.md` | Dicionário de campos, eventos, estados e métricas. |

## Instalação

Python 3.12. O agente `random` não precisa de nada além da biblioteca padrão.

```powershell
pip install torch transformers accelerate   # só para o agente local (qwen); torch com CUDA para usar a GPU
```

## Execução

```powershell
python test_boundaries.py                                       # testes de fronteira

# Agente neutro de comparação (sem LLM): sorteia entre as ações habilitadas
python run_pilot.py --policy random --n-seeds 30 --out data\random

# Agente LLM via Groq (chave SOMENTE em variável de ambiente)
$env:GROQ_API_KEY = "<sua chave>"
python run_pilot.py --policy groq --groq-model openai/gpt-oss-120b --temperature 0.3 --n-seeds 30 --out data\groq_pilot

# Agente LLM local (Qwen); --offload divide o modelo entre GPU e CPU se ele não couber na GPU
python run_pilot.py --policy qwen --model-path <pasta do modelo> --n-seeds 10 --out data\qwen

python analyze.py data\groq_pilot                               # gera analysis.json e analysis.md

# Interface web (humano usa pelos botões; ou assista ao agente operar; base da demonstração em vídeo)
$env:GROQ_API_KEY = "<sua chave>"      # só se for usar o agente Groq
python web_ui.py                        # abra http://127.0.0.1:8765
```

Sessões da interface web gravam `data\web_sessions\<run_id>.jsonl` (mesmo esquema v1; ações da pessoa têm `origin=human`).
No modo humano a persona é neutra (`c=1`: sem máscara; `k=4`: janela cheia; `v=false`; `d=1`; `u=-1`: a ajuda está sempre disponível). O modo agente usa a persona sorteada pela semente, como no piloto. Sem `GROQ_API_KEY`, o agente Groq falha com `technical_failure` e a página mostra o erro.

## Parâmetros e sementes

- Sementes: `--seed0` (padrão 1) e `--n-seeds`. A semente fixa a persona, os deslizes motores e a semente enviada à API.
- Parâmetros da persona, distribuições e efeitos: ver `DICIONARIO_EVENTOS.md`. São hipóteses de modelagem, não medições.
- `--temperature`: 0 (guloso) por padrão. Modelo, data e temperatura ficam gravados em `config.json`.
- Limite por execução: 40 ações executadas; 3 propostas inválidas seguidas encerram a execução como `stalled`.

## Regras de fronteira (verificadas em `test_boundaries.py`)

- O prompt tem só a metamensagem ao agente, o formato da resposta e a observação. Sem HTA, CTT, KLM, gabarito, critério de sucesso ou parâmetros da persona.
- Só C1 e C2 (calibração). V1 e V2 não existem no código.
- O sucesso vem do verificador externo, nunca do que o agente afirma.
- Ajuda só é entregue após `pedir_ajuda` registrado.

## Limitações conhecidas

- Cenas sintéticas e curtas; a interface foi ajustada usando C1 e C2 (calibração), inclusive os sinais "ainda não lido" e "botão Enviar".
- Com temperatura 0, as execuções variam pouco; o efeito da persona sobre o agente é pequeno quando ele não usa o texto original.
- Os tempos KLM do agente são equivalentes, não observados em humanos.
- Qwen2.5-1.5B e 3B locais não completam C1 de forma confiável (ver relatório).
