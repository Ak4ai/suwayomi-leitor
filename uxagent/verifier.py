"""Verificador EXTERNO de sucesso (Atividade 2.4).

Lê o gabarito privado somente depois do término e olha SÓ o estado final da interface.
A afirmação do próprio agente sobre ter acertado nunca é considerada.
"""
import hashlib
import json
from pathlib import Path

GABARITO = Path(__file__).with_name("gabarito_private.json")


def verify(task_id: str, final_state: dict, executed: int, technical_failure: bool, timed_out: bool,
           stalled: bool = False) -> dict:
    """technical_failure = falha de infraestrutura (fora do denominador de S).
    stalled = o agente insistiu em propostas inválidas (falha de decisão: conta como não-sucesso)."""
    gab = json.loads(GABARITO.read_text(encoding="utf-8"))[task_id]
    if technical_failure:
        status = "technical_failure"
    elif stalled:
        status = "stalled"
    elif final_state.get("quit"):
        status = "quit"
    elif timed_out or final_state.get("submitted") is None:
        status = "timeout"
    else:
        status = "correct" if final_state["submitted"] == gab["correct"] else "incorrect"
    result = {
        "status": status,
        "valid_run": status != "technical_failure",
        "correct": status == "correct",
        "executed_actions": executed,
        "excess_actions": max(0, executed - gab["min_actions"]),
    }
    result["hash"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()[:16]
    return result
