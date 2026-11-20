"""Testes de fronteira: a observação e o prompt não vazam gabarito, HTA ou parâmetros da persona,
ações fora do estado são recusadas e V1/V2 não existem."""
import json
from pathlib import Path

from env import Environment, LEITURA, PAINEL, RESPOSTA, FIM
from persona import sample_persona
from policies import SYSTEM_PROMPT
from scenes import SCENES
from verifier import verify

PROIBIDO = ["gabarito", "HTA", "CTT", "KLM", '"correct"', "min_actions", "caminho mínimo",
            "cobertura", "limiar", "precisão motora", "estratégia compensatória", "seed"]


def test_no_leak():
    for task in SCENES:
        for seed in range(1, 11):
            env = Environment(SCENES[task], sample_persona(seed))
            texts = [SYSTEM_PROMPT]
            for _ in range(6):
                texts.append(env.observe())
                ids = [a for a, _ in env.allowed()]
                env.apply(ids[0])
                if env.terminal:
                    break
            blob = "\n".join(texts).lower()
            for w in PROIBIDO:
                assert w.lower() not in blob, f"vazamento de '{w}' ({task}, seed {seed})"
    print("ok: sem vazamento de gabarito/HTA/parâmetros na observação nem no system prompt")


def test_enabled_actions_follow_state():
    env = Environment(SCENES["C1"], sample_persona(3))
    ids = [a for a, _ in env.allowed()]
    assert "enviar" not in ids and "fechar_painel" not in ids and "ajuda_tarefa" not in ids
    env.apply("selecionar_a")
    assert env.state == RESPOSTA and "enviar" in [a for a, _ in env.allowed()]
    env.apply("enviar")
    assert env.state == FIM and env.terminal
    print("ok: ações habilitadas dependem do estado (MoLIC)")


def test_panel_gate_strategy():
    # com estratégia compensatória (v=True), o painel só abre depois de checar a fonte
    seed = next(s for s in range(1, 200) if sample_persona(s).v)
    env = Environment(SCENES["C1"], sample_persona(seed))
    assert "abrir_painel" not in [a for a, _ in env.allowed()]
    env.apply("alternar_balao")
    assert "abrir_painel" in [a for a, _ in env.allowed()]
    seed2 = next(s for s in range(1, 200) if not sample_persona(s).v)
    env2 = Environment(SCENES["C1"], sample_persona(seed2))
    assert "abrir_painel" in [a for a, _ in env2.allowed()]
    print("ok: mecanismo v altera o espaço de ações fora do prompt")


def test_window_hides_old_panels():
    seed = next(s for s in range(1, 200) if sample_persona(s).k == 2)
    p = sample_persona(seed)
    env = Environment(SCENES["C1"], p)
    for _ in range(3):
        env.apply("ler_proximo")
    obs = env.observe()
    assert "fora da janela de leitura" in obs
    print(f"ok: janela k={p.k} oculta quadros antigos")


def test_verifier_is_external():
    env = Environment(SCENES["C1"], sample_persona(2))
    env.apply("selecionar_b")
    env.apply("enviar")
    r = verify("C1", env.snapshot(), env.executed, False, False)
    assert r["correct"] is True
    env = Environment(SCENES["C1"], sample_persona(2))
    env.apply("selecionar_a")
    env.apply("enviar")
    assert verify("C1", env.snapshot(), env.executed, False, False)["status"] == "incorrect"
    print("ok: verificador externo compara o estado final com o gabarito privado")


def test_no_validation_tasks():
    assert set(SCENES) == {"C1", "C2"}
    src = "".join(p.read_text(encoding="utf-8") for p in Path(__file__).parent.glob("*.py") if p.name != "test_boundaries.py")
    assert '"V1"' not in src and '"V2"' not in src
    print("ok: V1 e V2 não existem no código")


if __name__ == "__main__":
    test_no_leak()
    test_enabled_actions_follow_state()
    test_panel_gate_strategy()
    test_window_hides_old_panels()
    test_verifier_is_external()
    test_no_validation_tasks()
    print("todos os testes passaram")
