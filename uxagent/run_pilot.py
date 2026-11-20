"""Executa as tarefas de CALIBRAÇÃO (C1, C2) e grava logs JSON por execução.

Uso (a partir da pasta uxagent):
  python run_pilot.py --policy random --n-seeds 20 --out data/random
  python run_pilot.py --policy qwen   --n-seeds 5  --out data/qwen

V1 e V2 não existem neste código: não podem ser usadas para ajuste.
"""
import argparse
import json
import time
from pathlib import Path

from env import Environment, SUPPORT_ACTIONS
from persona import sample_persona
from scenes import SCENES
from verifier import verify

MAX_ACTIONS = 40
MAX_CONSECUTIVE_REJECTS = 3
DEFAULT_MODEL = (r"D:\ai_detector\hf_cache\hub\models--Qwen--Qwen2.5-1.5B-Instruct"
                 r"\snapshots\989aa7980e4cf806f80c7fef2b1adb7bc71aa306")


def run_one(task_id, seed, policy, out_dir: Path):
    persona = sample_persona(seed)
    env = Environment(SCENES[task_id], persona)
    run_id = f"{policy.name}_{task_id}_s{seed}"
    t0 = time.time()
    events = []

    def log(origin, type_, data, before=None, after=None):
        events.append({"schema": "v1", "run_id": run_id, "task": task_id, "seed": seed,
                       "seq": len(events), "t": round(time.time() - t0, 4), "origin": origin,
                       "type": type_, "data": data, "state_before": before, "state_after": after})

    log("system", "task_start", {"policy": policy.name, "max_actions": MAX_ACTIONS})
    log("persona", "parameter_sampled", persona.params())
    consecutive = rejected = loops = 0
    technical = timed_out = stalled = False
    while not env.terminal:
        if env.executed >= MAX_ACTIONS:
            timed_out = True
            break
        loops += 1
        if loops > MAX_ACTIONS * 3:
            stalled = True
            break
        obs, ids = env.observe(), [a for a, _ in env.allowed()]
        log("system", "observation", {"text": obs, "audit": env.observation_audit()})
        try:
            res = policy.propose(obs, ids, seed, loops)
        except Exception as exc:  # falha de infraestrutura (GPU, API...), não decisão do agente
            log("system", "technical_failure", {"error": repr(exc)})
            technical = True
            break
        if res["request"] is not None:
            log("system", "llm_request", {"messages": res["request"]})
        log("agent", "llm_response", {"raw": res["raw"], "proposal": res["action"],
                                      **({"meta": res["meta"]} if "meta" in res else {})})
        if res["action"] not in ids:
            rejected += 1
            consecutive += 1
            log("system", "action_rejected", {"proposal": res["action"], "reason": "not_enabled"},
                after=env.snapshot())
            if consecutive >= MAX_CONSECUTIVE_REJECTS:
                stalled = True
                break
            continue
        consecutive = 0
        if res["action"] == "pedir_ajuda":
            log("agent", "help_requested", {})
        meta = env.apply(res["action"])
        log("agent", "action_executed",
            {"requested": meta["requested"], "executed": meta["executed_action"], "support": meta["support"]},
            meta["state_before"], meta["state_after"])
        if "motor_slip" in meta:
            log("persona", "motor_slip", meta["motor_slip"])
        if res["action"].startswith("ajuda_"):
            log("system", "help_delivered", {"type": res["action"]})
    result = verify(task_id, env.snapshot(), env.executed, technical, timed_out, stalled)
    log("verifier", "verification", result, after=env.snapshot())
    (out_dir / f"{run_id}.jsonl").write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n", encoding="utf-8")
    return {"run_id": run_id, "task": task_id, "seed": seed, "persona": persona.params(),
            "status": result["status"], "valid_run": result["valid_run"], "correct": result["correct"],
            "executed": env.executed, "excess": result["excess_actions"], "rejected": rejected,
            "support_used": len(env.supports_used) > 0, "seconds": round(time.time() - t0, 2)}


def aggregate(runs):
    out = {}
    for task in sorted({r["task"] for r in runs}):
        rs = [r for r in runs if r["task"] == task]
        valid = [r for r in rs if r["valid_run"]]
        n_v = len(valid)
        out[task] = {
            "iniciadas": len(rs), "validas": n_v,
            "falhas_tecnicas": len(rs) - n_v,
            "S": round(sum(r["correct"] for r in valid) / n_v, 3) if n_v else None,
            "U": round(sum(r["support_used"] for r in valid) / n_v, 3) if n_v else None,
            "acoes_executadas_media": round(sum(r["executed"] for r in valid) / n_v, 2) if n_v else None,
            "excesso_medio": round(sum(r["excess"] for r in valid) / n_v, 2) if n_v else None,
            "propostas_rejeitadas": sum(r["rejected"] for r in rs),
            "status": {s: sum(1 for r in rs if r["status"] == s) for s in sorted({r["status"] for r in rs})},
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", choices=["random", "qwen", "groq"], required=True)
    ap.add_argument("--groq-model", default="openai/gpt-oss-120b")
    ap.add_argument("--tasks", default="C1,C2")
    ap.add_argument("--n-seeds", type=int, default=5)
    ap.add_argument("--seed0", type=int, default=1)
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--model-path", default=DEFAULT_MODEL)
    ap.add_argument("--offload", action="store_true", help="divide o modelo entre GPU e CPU")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    tasks = [t.strip() for t in a.tasks.split(",")]
    assert all(t in ("C1", "C2") for t in tasks), "Somente tarefas de calibração (C1, C2)."
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if a.policy == "qwen":
        from policies import QwenPolicy
        policy = QwenPolicy(a.model_path, a.temperature, offload=a.offload)
    elif a.policy == "groq":
        from policies import GroqPolicy
        policy = GroqPolicy(a.groq_model, a.temperature)
    else:
        from policies import RandomPolicy
        policy = RandomPolicy()
    (out_dir / "config.json").write_text(json.dumps(
        {"policy": policy.name, "tasks": tasks, "seeds": list(range(a.seed0, a.seed0 + a.n_seeds)),
         "model_path": a.model_path if a.policy == "qwen" else None,
         "model": a.groq_model if a.policy == "groq" else None,
         "date": time.strftime("%Y-%m-%d"), "temperature": a.temperature,
         "max_actions": MAX_ACTIONS}, indent=2, ensure_ascii=False), encoding="utf-8")
    runs = []
    for task in tasks:
        for seed in range(a.seed0, a.seed0 + a.n_seeds):
            r = run_one(task, seed, policy, out_dir)
            runs.append(r)
            print(f"{r['run_id']:>18} {r['status']:<18} acoes={r['executed']:>2} rejeitadas={r['rejected']} "
                  f"{r['seconds']}s", flush=True)
    summary = {"por_tarefa": aggregate(runs), "execucoes": runs}
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary["por_tarefa"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
