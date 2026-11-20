"""Testa as sessões da interface web sem rede e sem LLM: humano completo e agente aleatório."""
import json
import time
from pathlib import Path

import web_ui
from web_ui import Session, OUT_DIR


def read(run_id):
    return [json.loads(l) for l in (OUT_DIR / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]


def test_human_session():
    s = Session("C1", 1, "humano", "random")
    v = s.view()
    assert v["mode"] == "humano" and not v["done"] and any(a["id"] == "ler_proximo" for a in v["allowed"])
    s.act("enviar")  # não habilitada: deve ser rejeitada e não alterar a cena
    assert s.env.state == "leitura" and s.rejected == 1
    for a in ("ler_proximo", "selecionar_b", "enviar"):
        s.act(a)
    assert s.done and s.result["status"] == "correct", s.result
    ev = read(s.run_id)
    assert {"task_start", "parameter_sampled", "action_rejected", "action_executed", "verification"} <= {e["type"] for e in ev}
    assert any(e["origin"] == "human" for e in ev)
    print("ok: sessão humana completa, evento action_rejected e verificação externa")


def test_agent_session_random():
    web_ui.AGENT_DELAY = 0.01
    s = Session("C2", 3, "agente", "random")
    for _ in range(300):
        if s.done:
            break
        time.sleep(0.05)
    assert s.done and s.result["status"] in ("correct", "incorrect", "quit", "timeout", "stalled")
    ev = read(s.run_id)
    assert any(e["type"] == "observation" for e in ev) and any(e["type"] == "llm_response" for e in ev)
    print("ok: sessão do agente (aleatório) completa:", s.result["status"])


if __name__ == "__main__":
    test_human_session()
    test_agent_session_random()
    print("todos os testes da interface web passaram")
